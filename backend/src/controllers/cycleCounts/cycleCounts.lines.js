// backend/src/controllers/cycleCounts/cycleCounts.lines.js
//
// Raw HTTP handlers (no Express). Return boolean handled.
// Routes:
// - POST   /api/cycle-counts/:cycleCountId/lines
// - PATCH  /api/cycle-counts/:cycleCountId/lines/:cycleCountLineId
// - DELETE /api/cycle-counts/:cycleCountId/lines/:cycleCountLineId
//
// Enforces: DRAFT-only mutations (store-level fail-closed)

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
  return {
    tenantId: req?.ctx?.tenantId || null,
    userId: req?.ctx?.userId || null,
  };
}

// ----------------------------
// POST line
// ----------------------------
function addCycleCountLineHttp(req, res, requestId) {
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

    const cycleCountId = req.params?.cycleCountId;
    if (!cycleCountId) {
      json(res, 400, {
        error: { code: "CYCLE_COUNT_ID_REQUIRED", message: "cycleCountId is required." },
        requestId,
      });
      return true;
    }

    const line = cycleCountsStore.addLine({
      tenantId,
      cycleCountId,
      line: {
        ...req.body,
        actorUserId: userId,
      },
    });

    emitAudit({
      category: "INVENTORY",
      eventType: "CYCLE_COUNT.LINE_ADDED",
      requestId,
      userId,
      tenantId,
      cycleCountId,
      cycleCountLineId: line.cycleCountLineId,
    });

    json(res, 201, { line, requestId });
    return true;
  } catch (err) {
    const m = mapErr(err);
    json(res, m.status, { error: { code: m.code, message: m.message }, requestId });
    return true;
  }
}

// ----------------------------
// PATCH line
// ----------------------------
function updateCycleCountLineHttp(req, res, requestId) {
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

    const { cycleCountId, cycleCountLineId } = req.params || {};
    if (!cycleCountId || !cycleCountLineId) {
      json(res, 400, {
        error: {
          code: "LINE_ID_REQUIRED",
          message: "cycleCountId and cycleCountLineId are required.",
        },
        requestId,
      });
      return true;
    }

    const line = cycleCountsStore.updateLine({
      tenantId,
      cycleCountId,
      lineId: cycleCountLineId,
      patch: {
        ...req.body,
        actorUserId: userId,
      },
    });

    emitAudit({
      category: "INVENTORY",
      eventType: "CYCLE_COUNT.LINE_UPDATED",
      requestId,
      userId,
      tenantId,
      cycleCountId,
      cycleCountLineId,
    });

    json(res, 200, { line, requestId });
    return true;
  } catch (err) {
    const m = mapErr(err);
    json(res, m.status, { error: { code: m.code, message: m.message }, requestId });
    return true;
  }
}

// ----------------------------
// DELETE line
// ----------------------------
function deleteCycleCountLineHttp(req, res, requestId) {
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

    const { cycleCountId, cycleCountLineId } = req.params || {};
    if (!cycleCountId || !cycleCountLineId) {
      json(res, 400, {
        error: {
          code: "LINE_ID_REQUIRED",
          message: "cycleCountId and cycleCountLineId are required.",
        },
        requestId,
      });
      return true;
    }

    cycleCountsStore.deleteLine({
      tenantId,
      cycleCountId,
      lineId: cycleCountLineId,
      actorUserId: userId,
    });

    emitAudit({
      category: "INVENTORY",
      eventType: "CYCLE_COUNT.LINE_DELETED",
      requestId,
      userId,
      tenantId,
      cycleCountId,
      cycleCountLineId,
    });

    json(res, 200, { ok: true, requestId });
    return true;
  } catch (err) {
    const m = mapErr(err);
    json(res, m.status, { error: { code: m.code, message: m.message }, requestId });
    return true;
  }
}

module.exports = {
  addCycleCountLineHttp,
  updateCycleCountLineHttp,
  deleteCycleCountLineHttp,
};

