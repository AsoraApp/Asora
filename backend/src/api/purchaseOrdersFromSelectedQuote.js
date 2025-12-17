const crypto = require("crypto");
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

function nowUtc(ctx) {
  return String(ctx && ctx.nowUtc ? ctx.nowUtc : new Date().toISOString());
}

/**
 * B7 endpoint:
 * POST /api/purchase-orders/from-selected-quote/:rfqId
 *
 * Idempotent: if RFQ already has poId, return existing PO.
 *
 * Reuse stance: Create a DRAFT PO record that B6 can later issue/receive against.
 * (No new purchasing behavior; no auto-issue; no auto-receive.)
 */
function poFromSelectedQuoteRouter(ctx, req, res) {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname || "/";
  const method = (req.method || "GET").toUpperCase();

  if (!path.startsWith("/api/purchase-orders/from-selected-quote/")) return false;
  if (!requireTenant(ctx, res)) return true;
  if (method !== "POST") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });

  const parts = parsePath(path);
  const rfqId = parts[3];
  if (!rfqId) return badRequest(res, "RFQ_ID_REQUIRED");

  const rfqs = loadTenantCollection(ctx.tenantId, "rfqs.json", []);
  const rfqIdx = (rfqs || []).findIndex((r) => String(r.rfqId) === String(rfqId));
  if (rfqIdx < 0) return notFound(res, "RFQ_NOT_FOUND");
  const rfq = rfqs[rfqIdx];

  if (!rfq.selectedQuoteId) return conflict(res, "RFQ_NO_SELECTED_QUOTE");

  // If already created, return idempotently
  if (rfq.poId) {
    const pos = loadTenantCollection(ctx.tenantId, "purchase_orders.json", []);
    const existing = (pos || []).find((p) => String(p.poId) === String(rfq.poId)) || null;
    if (!existing) {
      // Fail-closed: RFQ references missing PO
      return conflict(res, "RFQ_PO_REFERENCE_BROKEN", { poId: rfq.poId });
    }
    return send(res, 200, { purchaseOrder: existing, idempotent: true });
  }

  const quotes = loadTenantCollection(ctx.tenantId, "vendor_quotes.json", []);
  const quote = (quotes || []).find((q) => String(q.quoteId) === String(rfq.selectedQuoteId)) || null;
  if (!quote) return conflict(res, "SELECTED_QUOTE_NOT_FOUND", { quoteId: rfq.selectedQuoteId });
  if (String(quote.rfqId) !== String(rfqId)) return conflict(res, "SELECTED_QUOTE_RFQ_MISMATCH");
  if (quote.status !== "SUBMITTED") return conflict(res, "SELECTED_QUOTE_NOT_SUBMITTED", { quoteStatus: quote.status });

  // Vendor eligibility gate required to create PO from selection
  if (!isVendorEligible(ctx.tenantId, quote.vendorId)) {
    return forbidden(res, "VENDOR_INELIGIBLE_PO_FROM_QUOTE", { vendorId: quote.vendorId });
  }

  // Fail-closed UOM stance: quote lines must match RFQ line UOM exactly
  const rfqLineMap = new Map();
  for (const ln of rfq.lines || []) rfqLineMap.set(String(ln.rfqLineId), ln);

  for (const ql of quote.lines || []) {
    const rfqLn = rfqLineMap.get(String(ql.rfqLineId));
    if (!rfqLn) return badRequest(res, "QUOTE_LINE_RFQLINEID_UNKNOWN", { rfqLineId: ql.rfqLineId });
    if (String(ql.uom) !== String(rfqLn.uom)) {
      return badRequest(res, "UOM_MISMATCH_REJECTED", { rfqLineId: ql.rfqLineId, expectedUom: rfqLn.uom, quoteUom: ql.uom });
    }
  }

  const pos = loadTenantCollection(ctx.tenantId, "purchase_orders.json", []);
  const poId = crypto.randomUUID();

  // Minimal PO shape consistent with procurement lifecycle:
  // status starts DRAFT; later B6 controls issue/receive.
  const po = {
    poId,
    tenantId: String(ctx.tenantId),
    status: "DRAFT",
    createdAtUtc: nowUtc(ctx),
    updatedAtUtc: nowUtc(ctx),
    source: { type: "RFQ_SELECTED_QUOTE", rfqId: String(rfqId), quoteId: String(quote.quoteId) },
    vendorId: String(quote.vendorId),
    lines: (rfq.lines || [])
      .slice()
      .sort((a, b) => (a.lineNumber || 0) - (b.lineNumber || 0))
      .map((rfqLn, idx) => {
        const ql = (quote.lines || []).find((x) => String(x.rfqLineId) === String(rfqLn.rfqLineId));
        if (!ql) {
          // Fail-closed: must exist due to submit rules, but enforce anyway
          throw new Error("QUOTE_LINE_MISSING_FOR_RFQ_LINE");
        }
        return {
          poLineId: crypto.randomUUID(),
          lineNumber: idx + 1,
          itemId: String(rfqLn.itemId),
          quantity: Number(rfqLn.quantity),
          uom: String(rfqLn.uom),
          unitPrice: Number(ql.unitPrice),
          leadTimeDays: Number(ql.leadTimeDays),
          vendorSku: ql.vendorSku || null,
          rfqLineId: String(rfqLn.rfqLineId),
          quoteLineId: String(ql.quoteLineId || ""),
        };
      }),
  };

  pos.push(po);
  saveTenantCollection(ctx.tenantId, "purchase_orders.json", pos);

  // Link back to RFQ (idempotency anchor)
  rfq.poId = poId;
  rfq.updatedAtUtc = nowUtc(ctx);
  rfqs[rfqIdx] = rfq;
  saveTenantCollection(ctx.tenantId, "rfqs.json", rfqs);

  emitAudit(ctx, {
    eventCategory: "PROCUREMENT",
    eventType: "PO_CREATED_FROM_SELECTED_QUOTE",
    objectType: "purchase_order",
    objectId: poId,
    decision: "ALLOW",
    reasonCode: "OK",
    factsSnapshot: { rfqId: rfqId, quoteId: quote.quoteId, vendorId: quote.vendorId },
  });

  return send(res, 201, { purchaseOrder: po });
}

module.exports = poFromSelectedQuoteRouter;
