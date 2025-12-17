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
  const parts = String(pathname || "").split("/").filter(Boolean);
  return parts;
}

function stableSortBy(arr, keyFn) {
  return arr
    .map((v, idx) => ({ v, idx, k: keyFn(v) }))
    .sort((a, b) => {
      if (a.k < b.k) return -1;
      if (a.k > b.k) return 1;
      return a.idx - b.idx;
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

function validateRfqLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1) {
    return { ok: false, code: "RFQ_LINES_REQUIRED" };
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln || typeof ln !== "object") return { ok: false, code: "RFQ_LINE_INVALID" };
    const itemId = ln.itemId;
    const quantity = ln.quantity;
    const uom = ln.uom;

    if (!itemId || typeof itemId !== "string") return { ok: false, code: "RFQ_LINE_ITEMID_REQUIRED" };
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, code: "RFQ_LINE_QUANTITY_INVALID" };
    if (!uom || typeof uom !== "string") return { ok: false, code: "RFQ_LINE_UOM_REQUIRED" };
  }

  return { ok: true };
}

function rfqRouter(ctx, req, res) {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname || "/";
  const method = (req.method || "GET").toUpperCase();

  if (!path.startsWith("/api/rfqs")) return false;
  if (!requireTenant(ctx, res)) return true;

  const parts = parsePath(path);

  // /api/rfqs
  if (parts.length === 2) {
    if (method === "GET") {
      const rfqs = loadTenantCollection(ctx.tenantId, "rfqs.json", []);
      const list = stableSortBy(rfqs || [], (r) => `${r.createdAtUtc || ""}::${r.rfqId || ""}`);
      return send(res, 200, { rfqs: list });
    }

    if (method === "POST") {
      const body = ctx.body || {};
      const title = typeof body.title === "string" ? body.title : null;
      const notes = typeof body.notes === "string" ? body.notes : null;
      const lines = body.lines;

      const vLines = validateRfqLines(lines);
      if (!vLines.ok) return badRequest(res, vLines.code);

      const rfqs = loadTenantCollection(ctx.tenantId, "rfqs.json", []);
      const rfqId = crypto.randomUUID();

      const rfq = {
        rfqId,
        tenantId: String(ctx.tenantId),
        status: "DRAFT",
        title,
        notes,
        createdAtUtc: nowUtc(ctx),
        updatedAtUtc: nowUtc(ctx),
        issuedAtUtc: null,
        closedAtUtc: null,
        cancelledAtUtc: null,
        invitedVendorIds: [],
        selectedQuoteId: null,
        poId: null,
        lines: lines.map((ln, idx) => ({
          rfqLineId: crypto.randomUUID(),
          lineNumber: idx + 1,
          itemId: String(ln.itemId),
          quantity: Number(ln.quantity),
          uom: String(ln.uom),
          description: typeof ln.description === "string" ? ln.description : null,
        })),
      };

      rfqs.push(rfq);
      saveTenantCollection(ctx.tenantId, "rfqs.json", rfqs);

      emitAudit(ctx, {
        eventCategory: "PROCUREMENT",
        eventType: "RFQ_CREATED",
        objectType: "rfq",
        objectId: rfqId,
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: { status: "DRAFT" },
      });

      return send(res, 201, { rfq });
    }

    return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
  }

  // /api/rfqs/:rfqId and actions
  if (parts.length >= 3) {
    const rfqId = parts[2];
    const rfqs = loadTenantCollection(ctx.tenantId, "rfqs.json", []);
    const idx = (rfqs || []).findIndex((r) => String(r.rfqId) === String(rfqId));
    if (idx < 0) return notFound(res, "RFQ_NOT_FOUND");
    const rfq = rfqs[idx];

    // GET /api/rfqs/:rfqId
    if (parts.length === 3 && method === "GET") {
      return send(res, 200, { rfq });
    }

    // PUT /api/rfqs/:rfqId (DRAFT only)
    if (parts.length === 3 && method === "PUT") {
      if (rfq.status !== "DRAFT") return conflict(res, "RFQ_NOT_EDITABLE", { status: rfq.status });

      const body = ctx.body || {};
      const title = Object.prototype.hasOwnProperty.call(body, "title") ? body.title : rfq.title;
      const notes = Object.prototype.hasOwnProperty.call(body, "notes") ? body.notes : rfq.notes;
      const lines = Object.prototype.hasOwnProperty.call(body, "lines") ? body.lines : rfq.lines.map((x) => ({
        itemId: x.itemId,
        quantity: x.quantity,
        uom: x.uom,
        description: x.description,
      }));

      const vLines = validateRfqLines(lines);
      if (!vLines.ok) return badRequest(res, vLines.code);

      rfq.title = typeof title === "string" ? title : null;
      rfq.notes = typeof notes === "string" ? notes : null;
      rfq.lines = lines.map((ln, i) => ({
        rfqLineId: crypto.randomUUID(),
        lineNumber: i + 1,
        itemId: String(ln.itemId),
        quantity: Number(ln.quantity),
        uom: String(ln.uom),
        description: typeof ln.description === "string" ? ln.description : null,
      }));
      rfq.updatedAtUtc = nowUtc(ctx);

      rfqs[idx] = rfq;
      saveTenantCollection(ctx.tenantId, "rfqs.json", rfqs);

      emitAudit(ctx, {
        eventCategory: "PROCUREMENT",
        eventType: "RFQ_UPDATED",
        objectType: "rfq",
        objectId: rfqId,
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: { status: rfq.status },
      });

      return send(res, 200, { rfq });
    }

    // POST /api/rfqs/:rfqId/issue (idempotent)
    if (parts.length === 4 && parts[3] === "issue" && method === "POST") {
      if (rfq.status === "ISSUED") return send(res, 200, { rfq, idempotent: true });
      if (rfq.status !== "DRAFT") return conflict(res, "RFQ_CANNOT_ISSUE", { status: rfq.status });

      rfq.status = "ISSUED";
      rfq.issuedAtUtc = nowUtc(ctx);
      rfq.updatedAtUtc = nowUtc(ctx);

      rfqs[idx] = rfq;
      saveTenantCollection(ctx.tenantId, "rfqs.json", rfqs);

      emitAudit(ctx, {
        eventCategory: "PROCUREMENT",
        eventType: "RFQ_ISSUED",
        objectType: "rfq",
        objectId: rfqId,
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: { status: "ISSUED" },
      });

      return send(res, 200, { rfq });
    }

    // POST /api/rfqs/:rfqId/cancel (idempotent)
    if (parts.length === 4 && parts[3] === "cancel" && method === "POST") {
      if (rfq.status === "CANCELLED") return send(res, 200, { rfq, idempotent: true });
      if (rfq.status === "CLOSED") return conflict(res, "RFQ_ALREADY_CLOSED");
      if (rfq.status !== "DRAFT" && rfq.status !== "ISSUED") return conflict(res, "RFQ_CANNOT_CANCEL", { status: rfq.status });

      rfq.status = "CANCELLED";
      rfq.cancelledAtUtc = nowUtc(ctx);
      rfq.updatedAtUtc = nowUtc(ctx);

      rfqs[idx] = rfq;
      saveTenantCollection(ctx.tenantId, "rfqs.json", rfqs);

      emitAudit(ctx, {
        eventCategory: "PROCUREMENT",
        eventType: "RFQ_CANCELLED",
        objectType: "rfq",
        objectId: rfqId,
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: { status: "CANCELLED" },
      });

      return send(res, 200, { rfq });
    }

    // POST /api/rfqs/:rfqId/close (idempotent)
    if (parts.length === 4 && parts[3] === "close" && method === "POST") {
      if (rfq.status === "CLOSED") return send(res, 200, { rfq, idempotent: true });
      if (rfq.status === "CANCELLED") return conflict(res, "RFQ_ALREADY_CANCELLED");
      if (rfq.status !== "ISSUED") return conflict(res, "RFQ_CANNOT_CLOSE", { status: rfq.status });

      rfq.status = "CLOSED";
      rfq.closedAtUtc = nowUtc(ctx);
      rfq.updatedAtUtc = nowUtc(ctx);

      rfqs[idx] = rfq;
      saveTenantCollection(ctx.tenantId, "rfqs.json", rfqs);

      emitAudit(ctx, {
        eventCategory: "PROCUREMENT",
        eventType: "RFQ_CLOSED",
        objectType: "rfq",
        objectId: rfqId,
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: { status: "CLOSED" },
      });

      return send(res, 200, { rfq });
    }

    // POST /api/rfqs/:rfqId/invite-vendors
    // Explicit stance: deterministic REPLACE (set exact list) with stable sorted storage.
    if (parts.length === 4 && parts[3] === "invite-vendors" && method === "POST") {
      if (rfq.status !== "DRAFT" && rfq.status !== "ISSUED") {
        return conflict(res, "RFQ_CANNOT_INVITE", { status: rfq.status });
      }

      const body = ctx.body || {};
      const vendorIds = body.vendorIds;

      if (!Array.isArray(vendorIds)) return badRequest(res, "VENDOR_IDS_REQUIRED");
      const normalized = vendorIds.map((v) => String(v)).filter((v) => v && v !== "null" && v !== "undefined");

      // Eligibility gate for being invited (fail-closed)
      for (const vid of normalized) {
        if (!isVendorEligible(ctx.tenantId, vid)) {
          return forbidden(res, "VENDOR_INELIGIBLE_INVITE", { vendorId: vid });
        }
      }

      const dedup = Array.from(new Set(normalized)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      rfq.invitedVendorIds = dedup;
      rfq.updatedAtUtc = nowUtc(ctx);

      rfqs[idx] = rfq;
      saveTenantCollection(ctx.tenantId, "rfqs.json", rfqs);

      emitAudit(ctx, {
        eventCategory: "PROCUREMENT",
        eventType: "RFQ_VENDORS_INVITED_REPLACED",
        objectType: "rfq",
        objectId: rfqId,
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: { invitedVendorIds: dedup },
      });

      return send(res, 200, { rfq });
    }

    return notFound(res, "RFQ_ROUTE_NOT_FOUND");
  }

  return false;
}

module.exports = rfqRouter;
