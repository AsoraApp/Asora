// backend/src/controllers/cycleCounts/cycleCounts.approveReject.js
//
// Raw HTTP handlers (no Express). Return boolean handled.
// Routes:
// - POST /api/cycle-counts/:cycleCountId/approve   (SUBMITTED -> APPROVED)
// - POST /api/cycle-counts/:cycleCountId/reject    (SUBMITTED -> REJECTED; requires reason)

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

function approveCycleCountHttp(req, res, requestId) {
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

    // CAS transition SUBMITTED -> APPROVED
    const header = cycleCountsStore.transitionStatus({
      tenantId,
      cycleCountId,
      from: cycleCountsStore.STATUS.SUBMITTED,
      to: cycleCountsStore.STATUS.APPROVED,
      patch: {
        actorUserId: userId,
        approvedAtUtc: new Date().toISOString(),
        approvedByUserId: userId,
      },
    });

    emitAudit({
      category: "INVENTORY",
      eventType: "CYCLE_COUNT.APPROVED",
      requestId,
      userId,
      tenantId,
      cycleCountId,
    });

    json(res, 200, { header, requestId });
    return true;
  } catch (err) {
    const m = mapErr(err);

    // Emit deny audit on wrong-state conflicts (optional but useful)
    if (m.status === 409) {
      emitAudit({
        category: "INVENTORY",
        eventType: "CYCLE_COUNT.APPROVE_DENIED",
        requestId,
        tenantId: req?.ctx?.tenantId,
        userId: req?.ctx?.userId,
        cycleCountId: req?.params?.cycleCountId,
        reasonCode: m.code,
      });
    }

    json(res, m.status, { error: { code: m.code, message: m.message }, requestId });
    return true;
  }
}

function rejectCycleCountHttp(req, res, requestId) {
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

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      json(res, 400, {
        error: { code: "REJECT_REASON_REQUIRED", message: "reason is required." },
        requestId,
      });
      return true;
    }

    // CAS transition SUBMITTED -> REJECTED
    const header = cycleCountsStore.transitionStatus({
      tenantId,
      cycleCountId,
      from: cycleCountsStore.STATUS.SUBMITTED,
      to: cycleCountsStore.STATUS.REJECTED,
      patch: {
        actorUserId: userId,
        rejectedAtUtc: new Date().toISOString(),
        rejectedByUserId: userId,
        rejectionReason: reason,
      },
    });

    emitAudit({
      category: "INVENTORY",
      eventType: "CYCLE_COUNT.REJECTED",
      requestId,
      userId,
      tenantId,
      cycleCountId,
      reason,
    });

    json(res, 200, { header, requestId });
    return true;
  } catch (err) {
    const m = mapErr(err);

    if (m.status === 409) {
      emitAudit({
        category: "INVENTORY",
        eventType: "CYCLE_COUNT.REJECT_DENIED",
        requestId,
        tenantId: req?.ctx?.tenantId,
        userId: req?.ctx?.userId,
        cycleCountId: req?.params?.cycleCountId,
        reasonCode: m.code,
      });
    }

    json(res, m.status, { error: { code: m.code, message: m.message }, requestId });
    return true;
  }
}

module.exports = {
  approveCycleCountHttp,
  rejectCycleCountHttp,
};

