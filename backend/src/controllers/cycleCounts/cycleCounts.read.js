// backend/src/controllers/cycleCounts/cycleCounts.read.js
//
// Raw HTTP handlers (no Express). Return boolean handled.
// Routes (wired by backend/src/api/cycleCounts.js):
// - POST   /api/cycle-counts                 -> createCycleCountDraftHttp
// - GET    /api/cycle-counts                 -> listCycleCountsHttp
// - GET    /api/cycle-counts/:cycleCountId   -> getCycleCountHttp

const cycleCountsStore = require("../../stores/cycleCounts.store");
const { emitAudit } = require("../../observability/audit");

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function mapErr(err) {
  const status = err?.statusCode || err?.status || 500;
  const code = err?.reasonCode || err?.code || "INTERNAL_ERROR";
  const message = err?.message || "Internal error";
  return { status, code, message };
}

function requireCtx(req) {
  const tenantId = req?.ctx?.tenantId || null;
  const userId = req?.ctx?.userId || null;
  return { tenantId, userId };
}

function createCycleCountDraftHttp(req, res, requestId) {
  try {
    const { tenantId, userId } = requireCtx(req);
    if (!tenantId) {
      json(res, 403, {
        error: { code: "TENANT_UNRESOLVED", message: "Tenant unresolved (fail-closed)." },
        requestId,
      });
      return true;
    }
    if (!userId) {
      json(res, 409, {
        error: { code: "ACTOR_UNRESOLVED", message: "Actor unresolved (fail-closed)." },
        requestId,
      });
      return true;
    }

    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;

    const header = cycleCountsStore.createDraft({
      tenantId,
      actorUserId: userId,
      notes,
    });

    emitAudit({
      category: "INVENTORY",
      eventType: "CYCLE_COUNT.DRAFT_CREATED",
      requestId,
      userId,
      tenantId,
      cycleCountId: header.cycleCountId,
    });

    json(res, 201, { header, requestId });
    return true;
  } catch (err) {
    const m = mapErr(err);
    json(res, m.status, { error: { code: m.code, message: m.message }, requestId });
    return true;
  }
}

function listCycleCountsHttp(req, res, requestId) {
  try {
    const { tenantId, userId } = requireCtx(req);
    if (!tenantId) {
      json(res, 403, {
        error: { code: "TENANT_UNRESOLVED", message: "Tenant unresolved (fail-closed)." },
        requestId,
      });
      return true;
    }
    if (!userId) {
      json(res, 409, {
        error: { code: "ACTOR_UNRESOLVED", message: "Actor unresolved (fail-closed)." },
        requestId,
      });
      return true;
    }

    const headers = cycleCountsStore.listByTenant({ tenantId });

    json(res, 200, { headers, requestId });
    return true;
  } catch (err) {
    const m = mapErr(err);
    json(res, m.status, { error: { code: m.code, message: m.message }, requestId });
    return true;
  }
}

function getCycleCountHttp(req, res, requestId) {
  try {
    const { tenantId, userId } = requireCtx(req);
    if (!tenantId) {
      json(res, 403, {
        error: { code: "TENANT_UNRESOLVED", message: "Tenant unresolved (fail-closed)." },
        requestId,
      });
      return true;
    }
    if (!userId) {
      json(res, 409, {
        error: { code: "ACTOR_UNRESOLVED", message: "Actor unresolved (fail-closed)." },
        requestId,
      });
      return true;
    }

    const cycleCountId = req.params?.cycleCountId || null;
    if (!cycleCountId) {
      json(res, 400, {
        error: { code: "CYCLE_COUNT_ID_REQUIRED", message: "cycleCountId is required." },
        requestId,
      });
      return true;
    }

    const result = cycleCountsStore.getById({ tenantId, cycleCountId });

    json(res, 200, { ...result, requestId });
    return true;
  } catch (err) {
    const m = mapErr(err);
    json(res, m.status, { error: { code: m.code, message: m.message }, requestId });
    return true;
  }
}

module.exports = {
  createCycleCountDraftHttp,
  listCycleCountsHttp,
  getCycleCountHttp,
};

