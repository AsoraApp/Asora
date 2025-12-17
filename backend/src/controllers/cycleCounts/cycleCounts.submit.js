// backend/src/controllers/cycleCounts/cycleCounts.submit.js
//
// POST /api/cycle-counts/:cycleCountId/submit
// Raw HTTP handler. Returns boolean handled.
// Uses req.ctx (set by server.js).
//
// DRAFT -> SUBMITTED
// Captures freezeAtUtc + freezeLedgerCursor
// Persists per-line snapshot: systemQtyAtFreeze + deltaPlanned

const cycleCountsStore = require("../../stores/cycleCounts.store");
const { computeFreezeSnapshot } = require("../../domain/cycleCounts/posting");
const { emitAudit } = require("../../observability/audit");

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function errorOut(res, status, code, message, requestId, extra) {
  json(res, status, {
    error: { code, message, ...extra },
    requestId,
  });
}

function mapErr(err) {
  // AppError in your repo typically carries statusCode + reasonCode (or similar).
  // Fail closed: treat unknown as 500.
  const status = err?.statusCode || err?.status || 500;
  const code = err?.reasonCode || err?.code || "INTERNAL_ERROR";
  const message = err?.message || "Internal error";
  return { status, code, message };
}

async function submitCycleCountHttp(req, res, requestId) {
  try {
    const ctx = req.ctx;
    const tenantId = ctx?.tenantId;
    const actorUserId = ctx?.userId;

    if (!tenantId) {
      errorOut(res, 403, "TENANT_UNRESOLVED", "Tenant unresolved (fail-closed).", requestId);
      return true;
    }
    if (!actorUserId) {
      errorOut(res, 409, "ACTOR_UNRESOLVED", "Actor unresolved (fail-closed).", requestId);
      return true;
    }

    const cycleCountId = req.params?.cycleCountId;
    if (!cycleCountId) {
      errorOut(res, 400, "CYCLE_COUNT_ID_REQUIRED", "cycleCountId is required.", requestId);
      return true;
    }

    const { header, lines } = cycleCountsStore.getById({ tenantId, cycleCountId });

    if (header.status !== cycleCountsStore.STATUS.DRAFT) {
      emitAudit({
        category: "INVENTORY",
        eventType: "CYCLE_COUNT.SUBMIT_DENIED_WRONG_STATE",
        requestId,
        userId: actorUserId,
        tenantId,
        cycleCountId,
        status: header.status,
      });

      errorOut(res, 409, "SUBMIT_INVALID_STATE", "Submit allowed only from DRAFT.", requestId, {
        status: header.status,
      });
      return true;
    }

    if (!Array.isArray(lines) || lines.length === 0) {
      emitAudit({
        category: "INVENTORY",
        eventType: "CYCLE_COUNT.SUBMIT_DENIED_NO_LINES",
        requestId,
        userId: actorUserId,
        tenantId,
        cycleCountId,
      });

      errorOut(res, 400, "SUBMIT_REQUIRES_LINES", "At least one line is required to submit.", requestId);
      return true;
    }

    const snapshot = await computeFreezeSnapshot({ tenantId, lines });

    // Persist snapshot while still DRAFT
    cycleCountsStore.persistFreezeSnapshot({
      tenantId,
      cycleCountId,
      freezeAtUtc: snapshot.freezeAtUtc,
      freezeLedgerCursor: snapshot.freezeLedgerCursor,
      linesSnapshot: snapshot.linesSnapshot,
      actorUserId,
    });

    // Transition DRAFT -> SUBMITTED (CAS)
    cycleCountsStore.transitionStatus({
      tenantId,
      cycleCountId,
      from: cycleCountsStore.STATUS.DRAFT,
      to: cycleCountsStore.STATUS.SUBMITTED,
      patch: {
        actorUserId,
        submittedAtUtc: snapshot.freezeAtUtc,
        submittedByUserId: actorUserId,
        freezeAtUtc: snapshot.freezeAtUtc,
        freezeLedgerCursor: snapshot.freezeLedgerCursor,
        freezeDerivationRule: snapshot.freezeDerivationRule,
      },
    });

    emitAudit({
      category: "INVENTORY",
      eventType: "CYCLE_COUNT.SUBMITTED",
      requestId,
      userId: actorUserId,
      tenantId,
      cycleCountId,
      freezeAtUtc: snapshot.freezeAtUtc,
      freezeLedgerCursor: snapshot.freezeLedgerCursor,
      lineCount: lines.length,
    });

    const result = cycleCountsStore.getById({ tenantId, cycleCountId });
    json(res, 200, { ...result, requestId });
    return true;
  } catch (err) {
    const mapped = mapErr(err);
    errorOut(res, mapped.status, mapped.code, mapped.message, requestId);
    return true;
  }
}

module.exports = {
  submitCycleCountHttp,
};
