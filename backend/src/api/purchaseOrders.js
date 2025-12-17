// backend/src/api/purchaseOrders.js
const crypto = require("crypto");
const { ok, created } = require("./http");
const { fail, assert } = require("./errors");
const { getById, list, upsertById } = require("../storage/jsonStore");
const { checkIdempotency, putIdempotency } = require("../storage/idempotency");
const { vendorEligibilityGate } = require("../domain/vendorEligibilityGate");

function nowUtc() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

function getIdemKey(req) {
  return req.headers["idempotency-key"] || req.headers["Idempotency-Key"] || null;
}

function parsePath(pathname) {
  return pathname.split("/").filter(Boolean);
}

function poTransitionGuard(current, next) {
  const allowed = {
    DRAFT: ["ISSUED", "CANCELLED"],
    ISSUED: ["PARTIALLY_RECEIVED", "CLOSED", "CANCELLED"],
    PARTIALLY_RECEIVED: ["CLOSED", "CANCELLED"],
    CLOSED: [],
    CANCELLED: [],
  };
  return (allowed[current] || []).includes(next);
}

function sumReceived(lines) {
  return lines.reduce((acc, ln) => acc + Number(ln.quantityReceivedToDate || 0), 0);
}

async function purchaseOrdersRouter(req, res, ctx) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const parts = parsePath(path);

  if (parts[0] !== "api") return false;

  try {
    // POST /api/purchase-orders/from-requisition/:reqId
    if (req.method === "POST" && parts[1] === "purchase-orders" && parts[2] === "from-requisition" && parts[3]) {
      const reqId = String(parts[3]);

      const idemKey = getIdemKey(req);
      if (!idemKey) return fail(res, "INVALID_REQUEST", "Missing Idempotency-Key header");

      const requisition = getById(ctx.tenantId, "requisitions", "reqId", reqId);
      if (!requisition) return fail(res, "NOT_FOUND", "Requisition not found");
      if (requisition.status !== "APPROVED") return fail(res, "STATE_CONFLICT", "Requisition must be APPROVED");

      const body = ctx.body || {};
      assert(body && typeof body === "object", "INVALID_REQUEST", "Body must be an object");
      assert(body.vendorId, "INVALID_REQUEST", "vendorId is required");

      // Enforce vendor eligibility at selection point (B5)
      vendorEligibilityGate(ctx, String(body.vendorId));

      const idem = checkIdempotency({
        tenantId: ctx.tenantId,
        namespace: `po.fromReq.${reqId}`,
        idemKey: String(idemKey),
        requestBody: { reqId, vendorId: String(body.vendorId) },
      });

      if (idem.hit) return ok(res, idem.response);

      // Fail-closed if already converted (deterministic one-way conversion)
      if (requisition.status === "CONVERTED") return fail(res, "STATE_CONFLICT", "Requisition already converted");

      const poId = newId();
      const createdAtUtc = nowUtc();

      const poLines = (requisition.lines || []).map((ln) => ({
        lineId: String(ln.lineId),
        skuId: String(ln.skuId),
        quantityOrdered: Number(ln.quantityRequested),
        quantityReceivedToDate: 0,
        notes: ln.notes ? String(ln.notes) : null,
      }));

      assert(poLines.length > 0, "INVALID_REQUEST", "Requisition has no lines");

      const purchaseOrder = {
        poId,
        tenantId: ctx.tenantId,
        status: "DRAFT",
        vendorId: String(body.vendorId),
        sourceReqId: String(reqId),
        createdAtUtc,
        updatedAtUtc: createdAtUtc,
        issuedAtUtc: null,
        cancelledAtUtc: null,
        closedAtUtc: null,
        lines: poLines,
        totals: {
          lines: poLines.length,
          quantityOrdered: poLines.reduce((a, x) => a + Number(x.quantityOrdered), 0),
          quantityReceivedToDate: 0,
        },
      };

      // Persist PO
      upsertById(ctx.tenantId, "purchase_orders", "poId", purchaseOrder);

      // Mark requisition as CONVERTED (deterministic)
      const reqNext = {
        ...requisition,
        status: "CONVERTED",
        convertedAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
        convertedToPoId: poId,
      };
      upsertById(ctx.tenantId, "requisitions", "reqId", reqNext);

      const response = { purchaseOrder };
      putIdempotency(ctx.tenantId, `po.fromReq.${reqId}`, String(idemKey), idem.fingerprint, response);
      return created(res, response);
    }

    // GET /api/purchase-orders
    if (req.method === "GET" && parts[1] === "purchase-orders" && parts.length === 2) {
      const items = list(ctx.tenantId, "purchase_orders");
      return ok(res, { purchaseOrders: items });
    }

    // GET /api/purchase-orders/:poId
    if (req.method === "GET" && parts[1] === "purchase-orders" && parts[2] && parts.length === 3) {
      const poId = String(parts[2]);
      const po = getById(ctx.tenantId, "purchase_orders", "poId", poId);
      if (!po) return fail(res, "NOT_FOUND", "Purchase order not found");
      return ok(res, { purchaseOrder: po });
    }

    // POST /api/purchase-orders/:poId/issue
    if (req.method === "POST" && parts[1] === "purchase-orders" && parts[2] && parts[3] === "issue") {
      const poId = String(parts[2]);
      const po = getById(ctx.tenantId, "purchase_orders", "poId", poId);
      if (!po) return fail(res, "NOT_FOUND", "Purchase order not found");

      // Enforce eligibility at issue time (fail-closed)
      vendorEligibilityGate(ctx, String(po.vendorId));

      if (!poTransitionGuard(po.status, "ISSUED")) return fail(res, "STATE_CONFLICT", "Invalid state transition");

      const next = {
        ...po,
        status: "ISSUED",
        issuedAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
      };
      upsertById(ctx.tenantId, "purchase_orders", "poId", next);
      return ok(res, { purchaseOrder: next });
    }

    // POST /api/purchase-orders/:poId/cancel
    if (req.method === "POST" && parts[1] === "purchase-orders" && parts[2] && parts[3] === "cancel") {
      const poId = String(parts[2]);
      const po = getById(ctx.tenantId, "purchase_orders", "poId", poId);
      if (!po) return fail(res, "NOT_FOUND", "Purchase order not found");

      if (!poTransitionGuard(po.status, "CANCELLED")) return fail(res, "STATE_CONFLICT", "Invalid state transition");

      const next = {
        ...po,
        status: "CANCELLED",
        cancelledAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
      };
      upsertById(ctx.tenantId, "purchase_orders", "poId", next);
      return ok(res, { purchaseOrder: next });
    }

    // POST /api/purchase-orders/:poId/close
    if (req.method === "POST" && parts[1] === "purchase-orders" && parts[2] && parts[3] === "close") {
      const poId = String(parts[2]);
      const po = getById(ctx.tenantId, "purchase_orders", "poId", poId);
      if (!po) return fail(res, "NOT_FOUND", "Purchase order not found");

      if (!poTransitionGuard(po.status, "CLOSED")) return fail(res, "STATE_CONFLICT", "Invalid state transition");

      const next = {
        ...po,
        status: "CLOSED",
        closedAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
      };
      upsertById(ctx.tenantId, "purchase_orders", "poId", next);
      return ok(res, { purchaseOrder: next });
    }

    return false;
  } catch (e) {
    return fail(res, e.code || "INVALID_REQUEST", e.message, e.details);
  }
}

module.exports = purchaseOrdersRouter;
