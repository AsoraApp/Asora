const url = require("url");

const { emitAudit } = require("../observability/audit");
const { loadTenantCollection, saveTenantCollection } = require("../storage/jsonStore");
const { isVendorEligible } = require("../domain/vendors/eligibility");

function send(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
function badRequest(res, code, details) {
  return send(res, 400, { error: "BAD_REQUEST", code, details: details || null });
}
function forbidden(res, code, details) {
  return send(res, 403, { error: "FORBIDDEN", code, details: details || null });
}
function notFound(res, code) {
  return send(res, 404, { error: "NOT_FOUND", code });
}
function conflict(res, code, details) {
  return send(res, 409, { error: "CONFLICT", code, details: details || null });
}

function parsePath(pathname) {
  return String(pathname || "").split("/").filter(Boolean);
}

function requireTenant(ctx, res) {
  if (!ctx || !ctx.tenantId) {
    send(res, 403, { error: "FORBIDDEN", code: "TENANT_NOT_RESOLVED" });
    return false;
  }
  return true;
}

function numericOrMax(n) {
  return Number.isFinite(n) ? Number(n) : Number.MAX_SAFE_INTEGER;
}

/**
 * Tie-breaks (explicit, deterministic):
 * 1) lowest grandTotalCost
 * 2) lowest maxLeadTimeDays across lines
 * 3) vendorId (lex asc)
 * 4) quoteId (lex asc)
 */
function rankKey(quoteSummary) {
  const t = Number(quoteSummary.grandTotalCost);
  const lead = numericOrMax(quoteSummary.maxLeadTimeDays);
  const vendorId = String(quoteSummary.vendorId || "");
  const quoteId = String(quoteSummary.quoteId || "");
  const tKey = String(Math.round(t * 100)).padStart(20, "0"); // cents-ish stable key
  const lKey = String(lead).padStart(10, "0");
  return `${tKey}::${lKey}::${vendorId}::${quoteId}`;
}

/**
 * MVP unit normalization stance: REJECT mismatched UOM.
 * Comparison payload includes uom per RFQ line; any quote with mismatch is excluded and reported.
 */
function rfqComparisonAndSelectionRouter(ctx, req, res) {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname || "/";
  const method = (req.method || "GET").toUpperCase();

  if (!path.startsWith("/api/rfqs/")) return false;
  if (!requireTenant(ctx, res)) return true;

  const parts = parsePath(path);
  if (parts.length < 4) return false;

  const rfqId = parts[2];

  // Load RFQ
  const rfqs = loadTenantCollection(ctx.tenantId, "rfqs.json", []);
  const rfqIdx = (rfqs || []).findIndex((r) => String(r.rfqId) === String(rfqId));
  if (rfqIdx < 0) return notFound(res, "RFQ_NOT_FOUND");
  const rfq = rfqs[rfqIdx];

  // GET /api/rfqs/:rfqId/comparison
  if (parts.length === 4 && parts[3] === "comparison" && method === "GET") {
    const quotes = loadTenantCollection(ctx.tenantId, "vendor_quotes.json", []);
    const submitted = (quotes || []).filter(
      (q) => String(q.rfqId) === String(rfqId) && String(q.status) === "SUBMITTED"
    );

    const rfqLineMap = new Map();
    for (const ln of rfq.lines || []) {
      rfqLineMap.set(String(ln.rfqLineId), ln);
    }

    const invalidQuotes = [];
    const quoteSummaries = [];

    for (const q of submitted) {
      // Eligibility enforced even for comparison payload (fail-closed per vendor)
      if (!isVendorEligible(ctx.tenantId, q.vendorId)) {
        invalidQuotes.push({ quoteId: q.quoteId, vendorId: q.vendorId, reason: "VENDOR_INELIGIBLE" });
        continue;
      }

      let ok = true;
      let grandTotal = 0;
      let maxLead = 0;

      // Fail-closed: must cover all RFQ lines exactly
      const rfqLineIds = (rfq.lines || []).map((l) => String(l.rfqLineId)).sort();
      const quoteLineIds = (q.lines || []).map((l) => String(l.rfqLineId)).sort();
      if (rfqLineIds.length !== quoteLineIds.length) ok = false;
      for (let i = 0; ok && i < rfqLineIds.length; i++) {
        if (rfqLineIds[i] !== quoteLineIds[i]) ok = false;
      }
      if (!ok) {
        invalidQuotes.push({ quoteId: q.quoteId, vendorId: q.vendorId, reason: "LINE_COVERAGE_MISMATCH" });
        continue;
      }

      for (const ql of q.lines || []) {
        const rfqLn = rfqLineMap.get(String(ql.rfqLineId));
        if (!rfqLn) {
          ok = false;
          break;
        }

        // UOM mismatch rejected
        if (String(ql.uom) !== String(rfqLn.uom)) {
          ok = false;
          invalidQuotes.push({
            quoteId: q.quoteId,
            vendorId: q.vendorId,
            reason: "UOM_MISMATCH_REJECTED",
            rfqLineId: ql.rfqLineId,
            expectedUom: rfqLn.uom,
            quoteUom: ql.uom,
          });
          break;
        }

        const unitPrice = Number(ql.unitPrice);
        const qty = Number(rfqLn.quantity);
        if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(qty) || qty <= 0) {
          ok = false;
          break;
        }

        const lineTotal = unitPrice * qty;
        grandTotal += lineTotal;

        const lead = Number(ql.leadTimeDays);
        if (Number.isFinite(lead) && lead > maxLead) maxLead = lead;
      }

      if (!ok) {
        invalidQuotes.push({ quoteId: q.quoteId, vendorId: q.vendorId, reason: "INVALID_QUOTE" });
        continue;
      }

      quoteSummaries.push({
        quoteId: q.quoteId,
        vendorId: q.vendorId,
        grandTotalCost: Number(grandTotal.toFixed(2)),
        maxLeadTimeDays: Number(maxLead),
        submittedAtUtc: q.submittedAtUtc || null,
        expiresAtUtc: q.expiresAtUtc || null,
      });
    }

    const orderedSummaries = quoteSummaries
      .map((s) => ({ s, k: rankKey(s) }))
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
      .map((x) => x.s);

    const bestSuggestion = orderedSummaries.length > 0 ? orderedSummaries[0] : null;

    // Side-by-side lines matrix (deterministic order)
    const rfqLinesOrdered = (rfq.lines || []).slice().sort((a, b) => (a.lineNumber || 0) - (b.lineNumber || 0));

    const submittedQuotesById = new Map(submitted.map((q) => [String(q.quoteId), q]));
    const matrix = rfqLinesOrdered.map((ln) => {
      const entries = orderedSummaries.map((qs) => {
        const q = submittedQuotesById.get(String(qs.quoteId));
        const ql = (q && q.lines ? q.lines : []).find((x) => String(x.rfqLineId) === String(ln.rfqLineId));
        return {
          quoteId: qs.quoteId,
          vendorId: qs.vendorId,
          unitPrice: ql ? Number(ql.unitPrice) : null,
          leadTimeDays: ql ? Number(ql.leadTimeDays) : null,
          uom: ln.uom,
          lineTotalCost: ql ? Number((Number(ql.unitPrice) * Number(ln.quantity)).toFixed(2)) : null,
        };
      });

      return {
        rfqLineId: ln.rfqLineId,
        lineNumber: ln.lineNumber,
        itemId: ln.itemId,
        quantity: ln.quantity,
        uom: ln.uom,
        description: ln.description || null,
        quotes: entries,
      };
    });

    return send(res, 200, {
      rfq: {
        rfqId: rfq.rfqId,
        status: rfq.status,
        invitedVendorIds: rfq.invitedVendorIds || [],
        selectedQuoteId: rfq.selectedQuoteId || null,
      },
      comparison: {
        stance: { uomNormalization: "REJECT_MISMATCHED_UOM" },
        tieBreaks: ["LOWEST_GRAND_TOTAL_COST", "LOWEST_MAX_LEAD_TIME_DAYS", "VENDOR_ID_ASC", "QUOTE_ID_ASC"],
        bestSuggestion,
        quoteSummaries: orderedSummaries,
        invalidQuotes: invalidQuotes.sort((a, b) => {
          const ka = `${a.vendorId || ""}::${a.quoteId || ""}::${a.reason || ""}`;
          const kb = `${b.vendorId || ""}::${b.quoteId || ""}::${b.reason || ""}`;
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        }),
        lines: matrix,
      },
    });
  }

  // POST /api/rfqs/:rfqId/select-quote/:quoteId
  if (parts.length === 5 && parts[3] === "select-quote" && method === "POST") {
    const quoteId = parts[4];

    // Explicit stance: selection allowed only when RFQ is ISSUED (hard-fail otherwise)
    if (rfq.status !== "ISSUED") return conflict(res, "RFQ_NOT_ISSUED_FOR_SELECTION", { rfqStatus: rfq.status });

    const quotes = loadTenantCollection(ctx.tenantId, "vendor_quotes.json", []);
    const quote = (quotes || []).find((q) => String(q.quoteId) === String(quoteId)) || null;
    if (!quote) return notFound(res, "QUOTE_NOT_FOUND");

    if (String(quote.rfqId) !== String(rfqId)) return badRequest(res, "QUOTE_RFQ_MISMATCH");
    if (quote.status !== "SUBMITTED") return conflict(res, "QUOTE_NOT_SUBMITTED", { quoteStatus: quote.status });

    // Vendor eligibility gate required to select
    if (!isVendorEligible(ctx.tenantId, quote.vendorId)) {
      return forbidden(res, "VENDOR_INELIGIBLE_SELECT", { vendorId: quote.vendorId });
    }

    // Idempotent selection
    if (rfq.selectedQuoteId && String(rfq.selectedQuoteId) === String(quoteId)) {
      return send(res, 200, { rfq, selected: { quoteId }, idempotent: true });
    }
    if (rfq.selectedQuoteId && String(rfq.selectedQuoteId) !== String(quoteId)) {
      return conflict(res, "RFQ_ALREADY_HAS_SELECTED_QUOTE", { selectedQuoteId: rfq.selectedQuoteId });
    }

    rfq.selectedQuoteId = String(quoteId);
    rfq.updatedAtUtc = String(ctx.nowUtc);

    rfqs[rfqIdx] = rfq;
    saveTenantCollection(ctx.tenantId, "rfqs.json", rfqs);

    emitAudit(ctx, {
      eventCategory: "PROCUREMENT",
      eventType: "RFQ_QUOTE_SELECTED",
      objectType: "rfq",
      objectId: rfqId,
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { selectedQuoteId: quoteId, vendorId: quote.vendorId },
    });

    return send(res, 200, { rfq, selected: { quoteId } });
  }

  return false;
}

module.exports = rfqComparisonAndSelectionRouter;
