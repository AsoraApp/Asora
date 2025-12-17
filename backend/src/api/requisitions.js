// backend/src/api/requisitions.js
const crypto = require("crypto");
const { ok, created } = require("./http");
const { fail, assert } = require("./errors");
const { getById, list, upsertById } = require("../storage/jsonStore");
const { checkIdempotency, putIdempotency } = require("../storage/idempotency");

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
  const parts = pathname.split("/").filter(Boolean);
  return parts; // e.g. ["api","requisitions",":id","submit"]
}

function sanitizeLines(lines) {
  assert(Array.isArray(lines), "INVALID_REQUEST", "lines must be an array");
  lines.forEach((ln, i) => {
    assert(ln && typeof ln === "object", "INVALID_REQUEST", "line must be an object", { index: i });
    assert(ln.lineId, "INVALID_REQUEST", "lineId is required (deterministic)", { index: i });
    assert(ln.skuId, "INVALID_REQUEST", "skuId is required", { index: i });
    assert(
      Number.isFinite(Number(ln.quantityRequested)) && Number(ln.quantityRequested) > 0,
      "INVALID_REQUEST",
      "quantityRequested must be a positive number",
      { index: i }
    );
  });
  return lines.map((ln) => ({
    lineId: String(ln.lineId),
    skuId: String(ln.skuId),
    quantityRequested: Number(ln.quantityRequested),
    notes: ln.notes ? String(ln.notes) : null,
  }));
}

function canUpdate(reqObj) {
  return reqObj.status === "DRAFT";
}

function transitionGuard(current, next) {
  const allowed = {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
    APPROVED: ["CONVERTED", "CANCELLED"],
    CONVERTED: [],
    REJECTED: [],
    CANCELLED: [],
  };
  return (allowed[current] || []).includes(next);
}

async function requisitionsRouter(req, res, ctx) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const parts = parsePath(path);

  if (parts[0] !== "api" || parts[1] !== "requisitions") return false;

  try {
    // GET /api/requisitions
    if (req.method === "GET" && parts.length === 2) {
      const items = list(ctx.tenantId, "requisitions");
      return ok(res, { requisitions: items });
    }

    // POST /api/requisitions (create DRAFT)
    if (req.method === "POST" && parts.length === 2) {
      const body = ctx.body || {};
      assert(body && typeof body === "object", "INVALID_REQUEST", "Body must be an object");

      const reqId = newId();
      const createdAtUtc = nowUtc();

      const lines = body.lines ? sanitizeLines(body.lines) : [];

      const requisition = {
        reqId,
        tenantId: ctx.tenantId,
        status: "DRAFT",
        title: body.title ? String(body.title) : null,
        notes: body.notes ? String(body.notes) : null,
        neededByUtc: body.neededByUtc ? String(body.neededByUtc) : null,
        createdAtUtc,
        updatedAtUtc: createdAtUtc,
        submittedAtUtc: null,
        approvedAtUtc: null,
        rejectedAtUtc: null,
        cancelledAtUtc: null,
        convertedAtUtc: null,
        lines,
      };

      upsertById(ctx.tenantId, "requisitions", "reqId", requisition);
      return created(res, { requisition });
    }

    // Routes with :reqId
    const reqId = parts[2] ? String(parts[2]) : null;

    // GET /api/requisitions/:reqId
    if (req.method === "GET" && parts.length === 3) {
      const existing = getById(ctx.tenantId, "requisitions", "reqId", reqId);
      if (!existing) return fail(res, "NOT_FOUND", "Requisition not found");
      return ok(res, { requisition: existing });
    }

    // PUT /api/requisitions/:reqId (DRAFT only)
    if (req.method === "PUT" && parts.length === 3) {
      const existing = getById(ctx.tenantId, "requisitions", "reqId", reqId);
      if (!existing) return fail(res, "NOT_FOUND", "Requisition not found");
      if (!canUpdate(existing)) return fail(res, "STATE_CONFLICT", "Requisition is not editable");

      const body = ctx.body || {};
      assert(body && typeof body === "object", "INVALID_REQUEST", "Body must be an object");

      const next = {
        ...existing,
        title: body.title !== undefined ? (body.title ? String(body.title) : null) : existing.title,
        notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : existing.notes,
        neededByUtc:
          body.neededByUtc !== undefined
            ? (body.neededByUtc ? String(body.neededByUtc) : null)
            : existing.neededByUtc,
        lines: body.lines !== undefined ? sanitizeLines(body.lines) : existing.lines,
        updatedAtUtc: nowUtc(),
      };

      upsertById(ctx.tenantId, "requisitions", "reqId", next);
      return ok(res, { requisition: next });
    }

    // POST /api/requisitions/:reqId/submit
    if (req.method === "POST" && parts.length === 4 && parts[3] === "submit") {
      const idemKey = getIdemKey(req);
      if (!idemKey) return fail(res, "INVALID_REQUEST", "Missing Idempotency-Key header");

      const existing = getById(ctx.tenantId, "requisitions", "reqId", reqId);
      if (!existing) return fail(res, "NOT_FOUND", "Requisition not found");

      const idem = checkIdempotency({
        tenantId: ctx.tenantId,
        namespace: `requisition.submit.${reqId}`,
        idemKey: String(idemKey),
        requestBody: { reqId },
      });

      if (idem.hit) return ok(res, idem.response);

      if (!transitionGuard(existing.status, "SUBMITTED")) {
        return fail(res, "STATE_CONFLICT", "Invalid state transition");
      }

      // Minimal validity: must have at least one line
      if (!Array.isArray(existing.lines) || existing.lines.length === 0) {
        return fail(res, "INVALID_REQUEST", "Requisition must include at least one line");
      }

      const next = {
        ...existing,
        status: "SUBMITTED",
        submittedAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
      };

      upsertById(ctx.tenantId, "requisitions", "reqId", next);
      const response = { requisition: next };
      putIdempotency(ctx.tenantId, `requisition.submit.${reqId}`, String(idemKey), idem.fingerprint, response);
      return ok(res, response);
    }

    // POST /api/requisitions/:reqId/approve
    if (req.method === "POST" && parts.length === 4 && parts[3] === "approve") {
      const idemKey = getIdemKey(req);
      if (!idemKey) return fail(res, "INVALID_REQUEST", "Missing Idempotency-Key header");

      const existing = getById(ctx.tenantId, "requisitions", "reqId", reqId);
      if (!existing) return fail(res, "NOT_FOUND", "Requisition not found");

      const idem = checkIdempotency({
        tenantId: ctx.tenantId,
        namespace: `requisition.approve.${reqId}`,
        idemKey: String(idemKey),
        requestBody: { reqId },
      });

      if (idem.hit) return ok(res, idem.response);

      if (!transitionGuard(existing.status, "APPROVED")) {
        return fail(res, "STATE_CONFLICT", "Invalid state transition");
      }

      const next = {
        ...existing,
        status: "APPROVED",
        approvedAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
      };

      upsertById(ctx.tenantId, "requisitions", "reqId", next);
      const response = { requisition: next };
      putIdempotency(ctx.tenantId, `requisition.approve.${reqId}`, String(idemKey), idem.fingerprint, response);
      return ok(res, response);
    }

    // POST /api/requisitions/:reqId/reject
    if (req.method === "POST" && parts.length === 4 && parts[3] === "reject") {
      const existing = getById(ctx.tenantId, "requisitions", "reqId", reqId);
      if (!existing) return fail(res, "NOT_FOUND", "Requisition not found");

      if (!transitionGuard(existing.status, "REJECTED")) {
        return fail(res, "STATE_CONFLICT", "Invalid state transition");
      }

      const next = {
        ...existing,
        status: "REJECTED",
        rejectedAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
      };

      upsertById(ctx.tenantId, "requisitions", "reqId", next);
      return ok(res, { requisition: next });
    }

    // POST /api/requisitions/:reqId/cancel
    if (req.method === "POST" && parts.length === 4 && parts[3] === "cancel") {
      const existing = getById(ctx.tenantId, "requisitions", "reqId", reqId);
      if (!existing) return fail(res, "NOT_FOUND", "Requisition not found");

      if (!transitionGuard(existing.status, "CANCELLED")) {
        return fail(res, "STATE_CONFLICT", "Invalid state transition");
      }

      const next = {
        ...existing,
        status: "CANCELLED",
        cancelledAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
      };

      upsertById(ctx.tenantId, "requisitions", "reqId", next);
      return ok(res, { requisition: next });
    }

    return fail(res, "NOT_FOUND", "Not found");
  } catch (e) {
    return fail(res, e.code || "INVALID_REQUEST", e.message, e.details);
  }
}

module.exports = requisitionsRouter;
