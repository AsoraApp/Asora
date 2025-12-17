// backend/src/controllers/cycleCounts/cycleCounts.submit.js
//
// POST /api/cycle-counts/:cycleCountId/submit
// - DRAFT -> SUBMITTED
// - Captures freezeAtUtc + freezeLedgerCursor
// - Persists per-line snapshot: systemQtyAtFreeze + deltaPlanned
// - Fail-closed on wrong state, missing tenant, missing lines

const AppError = require("../../errors/AppError");
const cycleCountsStore = require("../../stores/cycleCounts.store");
const { computeFreezeSnapshot } = require("../../domain/cycleCounts/posting");

// Audit emitter (B1/B3 pattern)
// EXPECTED export: emitAudit({ tenantId, eventType, objectType, objectId, decision, reasonCode, actorUserId, facts })
const { emitAudit } = require("../../observability/audit");

function conflict(reasonCode, message, facts) {
  return new AppError(message || reasonCode, 409, reasonCode, facts);
}

function badRequest(reasonCode, message, facts) {
  return new AppError(message || reasonCode, 400, reasonCode, facts);
}

function getCtx(req) {
  // Accept either convention; fail-closed if neither exists.
  return req.context || req.requestContext || null;
}

function getTenantId(req) {
  const ctx = getCtx(req);
  return ctx?.tenantId || ctx?.tenant?.tenantId || null;
}

function getActorUserId(req) {
  const ctx = getCtx(req);
  return ctx?.userId || ctx?.user?.userId || null;
}

async function submitCycleCount(req, res) {
  const tenantId = getTenantId(req);
  const actorUserId = getActorUserId(req);

  if (!tenantId) throw conflict("TENANT_UNRESOLVED", "Tenant unresolved (fail-closed).");
  if (!actorUserId) throw conflict("ACTOR_UNRESOLVED", "Actor unresolved (fail-closed).");

  const cycleCountId = req.params.cycleCountId;
  if (!cycleCountId) throw badRequest("CYCLE_COUNT_ID_REQUIRED", "cycleCountId is required.");

  const { header, lines } = cycleCountsStore.getById({ tenantId, cycleCountId });

  if (header.status !== cycleCountsStore.STATUS.DRAFT) {
    await emitAudit({
      tenantId,
      eventType: "CYCLE_COUNT_SUBMIT_DENIED_WRONG_STATE",
      objectType: "cycle_count",
      objectId: cycleCountId,
      decision: "DENY",
      reasonCode: "SUBMIT_INVALID_STATE",
      actorUserId,
      facts: { status: header.status },
    });
    throw conflict("SUBMIT_INVALID_STATE", "Submit allowed only from DRAFT.", {
      status: header.status,
    });
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    await emitAudit({
      tenantId,
      eventType: "CYCLE_COUNT_SUBMIT_DENIED_NO_LINES",
      objectType: "cycle_count",
      objectId: cycleCountId,
      decision: "DENY",
      reasonCode: "SUBMIT_REQUIRES_LINES",
      actorUserId,
      facts: { lineCount: Array.isArray(lines) ? lines.length : null },
    });
    throw badRequest("SUBMIT_REQUIRES_LINES", "At least one line is required to submit.");
  }

  // Compute freeze snapshot deterministically from ledger as-of cursor
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

  await emitAudit({
    tenantId,
    eventType: "CYCLE_COUNT_SUBMITTED",
    objectType: "cycle_count",
    objectId: cycleCountId,
    decision: "ALLOW",
    reasonCode: "OK",
    actorUserId,
    facts: {
      freezeAtUtc: snapshot.freezeAtUtc,
      freezeLedgerCursor: snapshot.freezeLedgerCursor,
      lineCount: lines.length,
    },
  });

  const result = cycleCountsStore.getById({ tenantId, cycleCountId });
  res.status(200).json(result);
}

module.exports = {
  submitCycleCount,
};

