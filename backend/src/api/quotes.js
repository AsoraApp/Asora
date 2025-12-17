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

function stableSort(arr, cmp) {
  return arr
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const c = cmp(a.v, b.v);
      if (c !== 0) return c;
      return a.i - b.i;
    })
    .map((x) => x.v);
}

function nowUtc(ctx) {
  return String(ctx && ctx.nowUtc ? ctx.nowUtc : new Date().toISOString());
}

function requireTenant(ctx, res) {
  if (!ctx || !ctx.tenantId) {
    send(res, 403, { error: "FORBIDDEN", code: "TENANT_NOT_RESOLVED" });
    return false;
  }
  return true;
}

function getRfqOr404(tenantId, rfqId, res) {
  const rfqs = loadTenantCollection(tenantId, "rfqs.json", []);
  const rfq = (rfqs || []).find((r) => String(r.rfqId) === String(rfqId)) || null;
  if (!rfq) {
    notFound(res, "RFQ_NOT_FOUND");
    return null;
  }
  return rfq;
}

function validateQuoteLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1) return { ok: false, code: "QUOTE_LINES_REQUIRED" };

  for (const ln of lines) {
    if (!ln || typeof ln !== "object") return { ok: false, code: "QUOTE_LINE_INVALID" };
    if (!ln.rfqLineId || typeof ln.rfqLineId !== "string") return { ok: false, code: "QUOTE_LINE_RFQLINEID_REQUIRED" };
    if (!Number.isFinite(ln.unitPrice) || ln.unitPrice < 0) return { ok: false, code: "QUOTE_LINE_UNITPRICE_INVALID" };
    if (!ln.uom || typeof ln.uom !== "string") return { ok: false, code: "QUOTE_LINE_UOM_REQUIRED" };
    if (!Number.isFinite(ln.leadTimeDays) || ln.leadTimeDays < 0) return { ok: false, code: "QUOTE_LINE_LEADTIME_INVALID" };
  }

  return { ok: true };
}

/**
 * MVP stance: reject mismatched UOM (fail-closed).
 * Quote line UOM must equal RFQ line UOM.
 */
function ensureUomMatchesOr400(rfq, quoteLines, res) {
  const map = new Map();
  for (const ln of rfq.lines || []) map.set(String(ln.rfqLineId), String(ln.uom));

  for (const ql of quoteLines) {
    const expected = map.get(String(ql.rfqLineId));
    if (!expected) {
      badRequest(res, "QUOTE_LINE_RFQLINEID_UNKNOWN", { rfqLineId: ql.rfqLineId });
      return false;
    }
    if (String(ql.uom) !== String(expected)) {
      badRequest(res, "UOM_MISMATCH_REJECTED", { rfqLineId: ql.rfqLineId, expectedUom: expected, quoteUom: ql.uom });
      return false;
    }
  }
  return true;
}

function quotesRouter(ctx, req, res) {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname || "/";
  const method = (req.method || "GET").toUpperCase();

  if (!path.startsWith("/api/")) return false;
  if (!requireTenant(ctx, res)) return true;

  const parts = parsePath(path);

  // GET /api/rfqs/:rfqId/quotes
  if (parts.length === 4 && parts[1] === "rfqs" && parts[3] === "quotes" && method === "GET") {
    const rfqId = parts[2];
    const rfq = getRfqOr404(ctx.tenantId, rfqId, res);
    if (!rfq) return true;

    const quotes = loadTenantCollection(ctx.tenantId, "vendor_quotes.json", []);
    const list = (quotes || []).filter((q) => String(q.rfqId) === String(rfqId));

    const ordered = stableSort(list, (a, b) => {
      const sa = String(a.createdAtUtc || "");
      const sb = String(b.createdAtUtc || "");
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      const va = String(a.vendorId || "");
      const vb = String(b.vendorId || "");
      if (va < vb) return -1;
      if (va > vb) return 1;
      const qa = String(a.quoteId || "");
      const qb = String(b.quoteId || "");
      return qa < qb ? -1 : qa > qb ? 1 : 0;
    });

    return send(res, 200, { rfqId, quotes: ordered });
  }

  // POST /api/rfqs/:rfqId/quotes (create DRAFT quote for a vendor; eligible vendor only)
  if (parts.length === 4 && parts[1] === "rfqs" && parts[3] === "quotes" && method === "POST") {
    const rfqId = parts[2];
    const rfq = getRfqOr404(ctx.tenantId, rfqId, res);
    if (!rfq) return true;

    const body = ctx.body || {};
    const vendorId = body.vendorId;

    if (!vendorId || typeof vendorId !== "string") return badRequest(res, "VENDOR_ID_REQUIRED");
    if (!isVendorEligible(ctx.tenantId, vendorId)) return forbidden(res, "VENDOR_INELIGIBLE_QUOTE_CREATE", { vendorId });

    // Optional invite-list enforcement: if RFQ has invitedVendorIds populated, vendor must be in list (fail-closed).
    if (Array.isArray(rfq.invitedVendorIds) && rfq.invitedVendorIds.length > 0) {
      const allowed = rfq.invitedVendorIds.some((v) => String(v) === String(vendorId));
      if (!allowed) return forbidden(res, "VENDOR_NOT_INVITED", { vendorId });
    }

    const quotes = loadTenantCollection(ctx.tenantId, "vendor_quotes.json", []);
    const quoteId = crypto.randomUUID();

    const quote = {
      quoteId,
      tenantId: String(ctx.tenantId),
      rfqId: String(rfqId),
      vendorId: String(vendorId),
      status: "DRAFT",
      createdAtUtc: nowUtc(ctx),
      updatedAtUtc: nowUtc(ctx),
      submittedAtUtc: null,
      withdrawnAtUtc: null,
      expiresAtUtc: typeof body.expiresAtUtc === "string" ? body.expiresAtUtc : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      lines: Array.isArray(body.lines)
        ? body.lines.map((ln) => ({
            quoteLineId: crypto.randomUUID(),
            rfqLineId: String(ln.rfqLineId),
            unitPrice: Number(ln.unitPrice),
            uom: String(ln.uom),
            leadTimeDays: Number(ln.leadTimeDays),
            vendorSku: typeof ln.vendorSku === "string" ? ln.vendorSku : null,
          }))
        : [],
    };

    // If lines provided at creation, validate; if not, allow empty draft and require before submit.
    if (quote.lines.length > 0) {
      const v = validateQuoteLines(quote.lines.map((x) => ({
        rfqLineId: x.rfqLineId,
        unitPrice: x.unitPrice,
        uom: x.uom,
        leadTimeDays: x.leadTimeDays,
      })));
      if (!v.ok) return badRequest(res, v.code);
      if (!ensureUomMatchesOr400(rfq, quote.lines, res)) return true;
    }

    quotes.push(quote);
    saveTenantCollection(ctx.tenantId, "vendor_quotes.json", quotes);

    emitAudit(ctx, {
      eventCategory: "PROCUREMENT",
      eventType: "VENDOR_QUOTE_CREATED",
      objectType: "vendor_quote",
      objectId: quoteId,
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { rfqId, vendorId, status: "DRAFT" },
    });

    return send(res, 201, { quote });
  }

  // GET /api/quotes/:quoteId
  if (parts.length === 3 && parts[1] === "quotes" && method === "GET") {
    const quoteId = parts[2];
    const quotes = loadTenantCollection(ctx.tenantId, "vendor_quotes.json", []);
    const quote = (quotes || []).find((q) => String(q.quoteId) === String(quoteId)) || null;
    if (!quote) return notFound(res, "QUOTE_NOT_FOUND");
    return send(res, 200, { quote });
  }

  // PUT /api/quotes/:quoteId (DRAFT only)
  if (parts.length === 3 && parts[1] === "quotes" && method === "PUT") {
    const quoteId = parts[2];
    const quotes = loadTenantCollection(ctx.tenantId, "vendor_quotes.json", []);
    const idx = (quotes || []).findIndex((q) => String(q.quoteId) === String(quoteId));
    if (idx < 0) return notFound(res, "QUOTE_NOT_FOUND");

    const quote = quotes[idx];
    if (quote.status !== "DRAFT") return conflict(res, "QUOTE_NOT_EDITABLE", { status: quote.status });

    // Eligibility gate remains required on edit (fail-closed)
    if (!isVendorEligible(ctx.tenantId, quote.vendorId)) {
      return forbidden(res, "VENDOR_INELIGIBLE_QUOTE_EDIT", { vendorId: quote.vendorId });
    }

    const rfq = getRfqOr404(ctx.tenantId, quote.rfqId, res);
    if (!rfq) return true;

    const body = ctx.body || {};
    if (Object.prototype.hasOwnProperty.call(body, "notes")) {
      quote.notes = typeof body.notes === "string" ? body.notes : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "expiresAtUtc")) {
      quote.expiresAtUtc = typeof body.expiresAtUtc === "string" ? body.expiresAtUtc : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "lines")) {
      const lines = body.lines;
      const v = validateQuoteLines(lines);
      if (!v.ok) return badRequest(res, v.code);

      const normalizedLines = lines.map((ln) => ({
        quoteLineId: crypto.randomUUID(),
        rfqLineId: String(ln.rfqLineId),
        unitPrice: Number(ln.unitPrice),
        uom: String(ln.uom),
        leadTimeDays: Number(ln.leadTimeDays),
        vendorSku: typeof ln.vendorSku === "string" ? ln.vendorSku : null,
      }));

      if (!ensureUomMatchesOr400(rfq, normalizedLines, res)) return true;

      quote.lines = normalizedLines;
    }

    quote.updatedAtUtc = nowUtc(ctx);
    quotes[idx] = quote;
    saveTenantCollection(ctx.tenantId, "vendor_quotes.json", quotes);

    emitAudit(ctx, {
      eventCategory: "PROCUREMENT",
      eventType: "VENDOR_QUOTE_UPDATED",
      objectType: "vendor_quote",
      objectId: quoteId,
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { status: "DRAFT" },
    });

    return send(res, 200, { quote });
  }

  // POST /api/quotes/:quoteId/submit (idempotent)
  if (parts.length === 4 && parts[1] === "quotes" && parts[3] === "submit" && method === "POST") {
    const quoteId = parts[2];
    const quotes = loadTenantCollection(ctx.tenantId, "vendor_quotes.json", []);
    const idx = (quotes || []).findIndex((q) => String(q.quoteId) === String(quoteId));
    if (idx < 0) return notFound(res, "QUOTE_NOT_FOUND");

    const quote = quotes[idx];

    if (quote.status === "SUBMITTED") return send(res, 200, { quote, idempotent: true });
    if (quote.status !== "DRAFT") return conflict(res, "QUOTE_CANNOT_SUBMIT", { status: quote.status });

    // Eligibility gate required to submit
    if (!isVendorEligible(ctx.tenantId, quote.vendorId)) {
      return forbidden(res, "VENDOR_INELIGIBLE_QUOTE_SUBMIT", { vendorId: quote.vendorId });
    }

    const rfq = getRfqOr404(ctx.tenantId, quote.rfqId, res);
    if (!rfq) return true;

    if (rfq.status !== "ISSUED") {
      return conflict(res, "RFQ_NOT_ISSUED", { rfqStatus: rfq.status });
    }

    // Must have at least one line and cover all RFQ lines (fail-closed)
    const rfqLineIds = (rfq.lines || []).map((l) => String(l.rfqLineId)).sort();
    const quoteLineIds = (quote.lines || []).map((l) => String(l.rfqLineId)).sort();
    if (quoteLineIds.length < 1) return badRequest(res, "QUOTE_LINES_REQUIRED_BEFORE_SUBMIT");

    // Must match exactly (no missing/extra)
    if (rfqLineIds.length !== quoteLineIds.length) {
      return badRequest(res, "QUOTE_MUST_COVER_ALL_RFQ_LINES", { rfqLineCount: rfqLineIds.length, quoteLineCount: quoteLineIds.length });
    }
    for (let i = 0; i < rfqLineIds.length; i++) {
      if (rfqLineIds[i] !== quoteLineIds[i]) {
        return badRequest(res, "QUOTE_MUST_COVER_ALL_RFQ_LINES", { mismatchAt: i, expected: rfqLineIds[i], got: quoteLineIds[i] });
      }
    }

    if (!ensureUomMatchesOr400(rfq, quote.lines, res)) return true;

    quote.status = "SUBMITTED";
    quote.submittedAtUtc = nowUtc(ctx);
    quote.updatedAtUtc = nowUtc(ctx);

    quotes[idx] = quote;
    saveTenantCollection(ctx.tenantId, "vendor_quotes.json", quotes);

    emitAudit(ctx, {
      eventCategory: "PROCUREMENT",
      eventType: "VENDOR_QUOTE_SUBMITTED",
      objectType: "vendor_quote",
      objectId: quoteId,
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { status: "SUBMITTED", rfqId: quote.rfqId, vendorId: quote.vendorId },
    });

    return send(res, 200, { quote });
  }

  // POST /api/quotes/:quoteId/withdraw (idempotent)
  if (parts.length === 4 && parts[1] === "quotes" && parts[3] === "withdraw" && method === "POST") {
    const quoteId = parts[2];
    const quotes = loadTenantCollection(ctx.tenantId, "vendor_quotes.json", []);
    const idx = (quotes || []).findIndex((q) => String(q.quoteId) === String(quoteId));
    if (idx < 0) return notFound(res, "QUOTE_NOT_FOUND");

    const quote = quotes[idx];

    if (quote.status === "WITHDRAWN") return send(res, 200, { quote, idempotent: true });
    if (quote.status !== "SUBMITTED" && quote.status !== "DRAFT") {
      return conflict(res, "QUOTE_CANNOT_WITHDRAW", { status: quote.status });
    }

    // Eligibility gate required to withdraw (still enforce fail-closed)
    if (!isVendorEligible(ctx.tenantId, quote.vendorId)) {
      return forbidden(res, "VENDOR_INELIGIBLE_QUOTE_WITHDRAW", { vendorId: quote.vendorId });
    }

    quote.status = "WITHDRAWN";
    quote.withdrawnAtUtc = nowUtc(ctx);
    quote.updatedAtUtc = nowUtc(ctx);

    quotes[idx] = quote;
    saveTenantCollection(ctx.tenantId, "vendor_quotes.json", quotes);

    emitAudit(ctx, {
      eventCategory: "PROCUREMENT",
      eventType: "VENDOR_QUOTE_WITHDRAWN",
      objectType: "vendor_quote",
      objectId: quoteId,
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { status: "WITHDRAWN", rfqId: quote.rfqId, vendorId: quote.vendorId },
    });

    return send(res, 200, { quote });
  }

  return false;
}

module.exports = quotesRouter;
