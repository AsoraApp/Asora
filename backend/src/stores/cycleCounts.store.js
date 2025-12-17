// backend/src/stores/cycleCounts.store.js
//
// B4 Cycle Counts — persistence/store layer
// - Tenant-scoped only
// - Fail-closed on ambiguity
// - Enforces DRAFT-only line edits
// - Enforces (hubId, binId, skuId) uniqueness per cycle count
// - Enforces compare-and-swap status transitions
// - Enforces post idempotency lock (no double-post)
//
// NOTE: This store is intentionally self-contained (in-memory) to match early-phase repo patterns.
// If you already have a durable store helper in /src/stores, refactor this to use it AFTER B4 is working.

const crypto = require("crypto");
const AppError = require("../errors/AppError");

// ------------------------
// Constants / helpers
// ------------------------

const STATUS = Object.freeze({
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  POSTED: "POSTED",
});

function nowUtcIso() {
  return new Date().toISOString();
}

function uuid() {
  // Prefer crypto.randomUUID when available (Node 16+ supports it).
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function badRequest(reasonCode, message, facts) {
  return new AppError(message || reasonCode, 400, reasonCode, facts);
}

function notFound(reasonCode, message, facts) {
  return new AppError(message || reasonCode, 404, reasonCode, facts);
}

function conflict(reasonCode, message, facts) {
  return new AppError(message || reasonCode, 409, reasonCode, facts);
}

function requireTenant(tenantId) {
  if (!tenantId) throw conflict("TENANT_UNRESOLVED", "Tenant unresolved (fail-closed).");
}

function requireActor(actorUserId) {
  if (!actorUserId) throw conflict("ACTOR_UNRESOLVED", "Actor unresolved (fail-closed).");
}

function requireCycleCountId(cycleCountId) {
  if (!cycleCountId) throw badRequest("CYCLE_COUNT_ID_REQUIRED", "cycleCountId is required.");
}

function requireLineIds(hubId, binId, skuId) {
  if (!hubId || !binId || !skuId) {
    throw badRequest("LINE_KEYS_REQUIRED", "hubId, binId, skuId are required.", {
      hubId,
      binId,
      skuId,
    });
  }
}

function requireFiniteNumber(n, code) {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw badRequest(code || "INVALID_NUMBER", "Value must be a finite number.", { value: n });
  }
}

function lineKey({ hubId, binId, skuId }) {
  return `${hubId}::${binId}::${skuId}`;
}

function stableSortLines(lines) {
  return [...lines].sort((a, b) => {
    const A = `${a.hubId}\u0000${a.binId}\u0000${a.skuId}\u0000${a.cycleCountLineId}`;
    const B = `${b.hubId}\u0000${b.binId}\u0000${b.skuId}\u0000${b.cycleCountLineId}`;
    return A.localeCompare(B);
  });
}

// ------------------------
// In-memory backing store
// ------------------------
//
// tenantId -> Map(cycleCountId -> cycleCountRecord)
//
// cycleCountRecord:
// {
//   header: {...},
//   lines: [...],
//   lineIndexByKey: Map(key -> cycleCountLineId),
// }
const DB = new Map();

function tenantMap(tenantId) {
  requireTenant(tenantId);
  if (!DB.has(tenantId)) DB.set(tenantId, new Map());
  return DB.get(tenantId);
}

function mustGetRecord(tenantId, cycleCountId) {
  requireTenant(tenantId);
  requireCycleCountId(cycleCountId);

  const t = tenantMap(tenantId);
  const rec = t.get(cycleCountId);
  if (!rec) throw notFound("CYCLE_COUNT_NOT_FOUND", "Cycle count not found.", { cycleCountId });
  return rec;
}

function mustBeDraft(header) {
  if (header.status !== STATUS.DRAFT) {
    throw conflict("CYCLE_COUNT_LOCKED", "Cycle count is locked (not DRAFT).", {
      status: header.status,
    });
  }
}

// ------------------------
// API (exports)
// ------------------------

/**
 * createDraft({ tenantId, actorUserId, notes }) -> header
 */
function createDraft({ tenantId, actorUserId, notes }) {
  requireTenant(tenantId);
  requireActor(actorUserId);

  const cycleCountId = uuid();
  const createdAtUtc = nowUtcIso();

  const header = {
    cycleCountId,
    tenantId,
    status: STATUS.DRAFT,

    notes: typeof notes === "string" ? notes : null,

    createdAtUtc,
    createdByUserId: actorUserId,
    updatedAtUtc: createdAtUtc,
    updatedByUserId: actorUserId,

    // lifecycle timestamps (null until set)
    submittedAtUtc: null,
    submittedByUserId: null,
    freezeAtUtc: null,
    freezeLedgerCursor: null,
    freezeDerivationRule: null,

    approvedAtUtc: null,
    approvedByUserId: null,

    rejectedAtUtc: null,
    rejectedByUserId: null,
    rejectionReason: null,

    cancelledAtUtc: null,
    cancelledByUserId: null,

    postAttemptedAtUtc: null,
    postedAtUtc: null,
    postedByUserId: null,

    // idempotency + linkage
    postIdempotencyKey: null,
    postLedgerBatchId: null,
    postLockClaimedAtUtc: null,
  };

  const record = {
    header,
    lines: [],
    lineIndexByKey: new Map(),
  };

  tenantMap(tenantId).set(cycleCountId, record);
  return { ...header };
}

/**
 * listByTenant({ tenantId }) -> headers[]
 * Minimal list (no lines).
 */
function listByTenant({ tenantId }) {
  requireTenant(tenantId);
  const t = tenantMap(tenantId);

  const headers = [];
  for (const [, rec] of t.entries()) headers.push(rec.header);

  // Stable ordering: newest first (createdAtUtc desc); deterministic on ties by id.
  headers.sort((a, b) => {
    const d = (b.createdAtUtc || "").localeCompare(a.createdAtUtc || "");
    if (d !== 0) return d;
    return (a.cycleCountId || "").localeCompare(b.cycleCountId || "");
  });

  return headers.map((h) => ({ ...h }));
}

/**
 * getById({ tenantId, cycleCountId }) -> { header, lines[] }
 */
function getById({ tenantId, cycleCountId }) {
  const rec = mustGetRecord(tenantId, cycleCountId);
  return {
    header: { ...rec.header },
    lines: stableSortLines(rec.lines).map((l) => ({ ...l })),
  };
}

/**
 * addLine({ tenantId, cycleCountId, line }) -> createdLine
 * Enforces DRAFT-only and unique (hubId, binId, skuId).
 */
function addLine({ tenantId, cycleCountId, line }) {
  requireTenant(tenantId);
  requireCycleCountId(cycleCountId);

  const rec = mustGetRecord(tenantId, cycleCountId);
  mustBeDraft(rec.header);

  if (!line || typeof line !== "object") {
    throw badRequest("LINE_REQUIRED", "line body is required.");
  }

  const { hubId, binId, skuId } = line;
  requireLineIds(hubId, binId, skuId);

  const countedQty = line.countedQty;
  requireFiniteNumber(countedQty, "COUNTED_QTY_INVALID");
  if (countedQty < 0) {
    throw badRequest("COUNTED_QTY_NEGATIVE", "countedQty cannot be negative in MVP.", {
      countedQty,
    });
  }

  const key = lineKey({ hubId, binId, skuId });
  if (rec.lineIndexByKey.has(key)) {
    throw conflict("DUPLICATE_LINE_KEY", "Duplicate (hubId, binId, skuId) line.", {
      hubId,
      binId,
      skuId,
    });
  }

  const now = nowUtcIso();
  const createdLine = {
    cycleCountLineId: uuid(),
    cycleCountId,
    tenantId,

    hubId,
    binId,
    skuId,

    countedQty,
    note: typeof line.note === "string" ? line.note : null,

    createdAtUtc: now,
    createdByUserId: line.actorUserId || null, // controller should fill actor; store stays agnostic
    updatedAtUtc: now,
    updatedByUserId: line.actorUserId || null,

    // freeze snapshot fields (null until submit)
    systemQtyAtFreeze: null,
    systemQtyDerivationCursor: null,
    deltaPlanned: null,
  };

  rec.lines.push(createdLine);
  rec.lineIndexByKey.set(key, createdLine.cycleCountLineId);

  rec.header.updatedAtUtc = now;
  rec.header.updatedByUserId = line.actorUserId || rec.header.updatedByUserId;

  return { ...createdLine };
}

/**
 * updateLine({ tenantId, cycleCountId, lineId, patch }) -> updatedLine
 * DRAFT-only. Only countedQty and note are patchable (no hub/bin/sku in-place).
 */
function updateLine({ tenantId, cycleCountId, lineId, patch }) {
  requireTenant(tenantId);
  requireCycleCountId(cycleCountId);
  if (!lineId) throw badRequest("LINE_ID_REQUIRED", "cycleCountLineId is required.");

  const rec = mustGetRecord(tenantId, cycleCountId);
  mustBeDraft(rec.header);

  const idx = rec.lines.findIndex((l) => l.cycleCountLineId === lineId);
  if (idx < 0) throw notFound("CYCLE_COUNT_LINE_NOT_FOUND", "Line not found.", { lineId });

  if (!patch || typeof patch !== "object") {
    throw badRequest("PATCH_REQUIRED", "patch body is required.");
  }

  if ("hubId" in patch || "binId" in patch || "skuId" in patch) {
    throw conflict(
      "LINE_KEYS_IMMUTABLE",
      "hubId/binId/skuId cannot be changed; delete+add a new line.",
      { lineId }
    );
  }

  const now = nowUtcIso();
  const line = rec.lines[idx];

  if ("countedQty" in patch) {
    requireFiniteNumber(patch.countedQty, "COUNTED_QTY_INVALID");
    if (patch.countedQty < 0) {
      throw badRequest("COUNTED_QTY_NEGATIVE", "countedQty cannot be negative in MVP.", {
        countedQty: patch.countedQty,
      });
    }
    line.countedQty = patch.countedQty;
  }

  if ("note" in patch) {
    line.note = typeof patch.note === "string" ? patch.note : null;
  }

  line.updatedAtUtc = now;
  line.updatedByUserId = patch.actorUserId || line.updatedByUserId;

  rec.header.updatedAtUtc = now;
  rec.header.updatedByUserId = patch.actorUserId || rec.header.updatedByUserId;

  return { ...line };
}

/**
 * deleteLine({ tenantId, cycleCountId, lineId }) -> { ok: true }
 * DRAFT-only.
 */
function deleteLine({ tenantId, cycleCountId, lineId, actorUserId }) {
  requireTenant(tenantId);
  requireCycleCountId(cycleCountId);
  if (!lineId) throw badRequest("LINE_ID_REQUIRED", "cycleCountLineId is required.");

  const rec = mustGetRecord(tenantId, cycleCountId);
  mustBeDraft(rec.header);

  const idx = rec.lines.findIndex((l) => l.cycleCountLineId === lineId);
  if (idx < 0) throw notFound("CYCLE_COUNT_LINE_NOT_FOUND", "Line not found.", { lineId });

  const [removed] = rec.lines.splice(idx, 1);
  rec.lineIndexByKey.delete(lineKey(removed));

  const now = nowUtcIso();
  rec.header.updatedAtUtc = now;
  if (actorUserId) rec.header.updatedByUserId = actorUserId;

  return { ok: true };
}

/**
 * transitionStatus({ tenantId, cycleCountId, from, to, patch }) -> updatedHeader
 * Compare-and-swap state transition. Fail-closed if current !== from.
 */
function transitionStatus({ tenantId, cycleCountId, from, to, patch }) {
  requireTenant(tenantId);
  requireCycleCountId(cycleCountId);
  if (!from || !to) throw badRequest("STATUS_REQUIRED", "from/to are required.");

  const rec = mustGetRecord(tenantId, cycleCountId);
  const current = rec.header.status;

  if (current !== from) {
    throw conflict("STATE_CONFLICT", "Invalid state transition (fail-closed).", {
      expected: from,
      actual: current,
      to,
    });
  }

  const now = nowUtcIso();
  rec.header.status = to;
  rec.header.updatedAtUtc = now;

  if (patch && typeof patch === "object") {
    for (const [k, v] of Object.entries(patch)) {
      // Prevent tenant/cycleCountId mutation
      if (k === "tenantId" || k === "cycleCountId") continue;
      rec.header[k] = v;
    }
    if (patch.actorUserId) rec.header.updatedByUserId = patch.actorUserId;
  }

  return { ...rec.header };
}

/**
 * persistFreezeSnapshot({
 *   tenantId, cycleCountId, freezeAtUtc, freezeLedgerCursor, linesSnapshot
 * }) -> { header, lines[] }
 *
 * Called during SUBMIT to persist reproducible snapshot fields.
 * Does NOT transition status by itself (use transitionStatus separately).
 */
function persistFreezeSnapshot({
  tenantId,
  cycleCountId,
  freezeAtUtc,
  freezeLedgerCursor,
  linesSnapshot,
  actorUserId,
}) {
  requireTenant(tenantId);
  requireCycleCountId(cycleCountId);

  const rec = mustGetRecord(tenantId, cycleCountId);

  // Must still be DRAFT at the moment of snapshot write (submit controller controls transition order).
  if (rec.header.status !== STATUS.DRAFT) {
    throw conflict("SUBMIT_INVALID_STATE", "Submit snapshot requires DRAFT status.", {
      status: rec.header.status,
    });
  }

  if (!freezeAtUtc || !freezeLedgerCursor) {
    throw conflict("FREEZE_SNAPSHOT_MISSING", "freezeAtUtc and freezeLedgerCursor are required.", {
      freezeAtUtc,
      freezeLedgerCursor,
    });
  }

  if (!Array.isArray(linesSnapshot) || linesSnapshot.length !== rec.lines.length) {
    throw conflict(
      "FREEZE_SNAPSHOT_LINE_MISMATCH",
      "linesSnapshot must align to existing lines (same count).",
      {
        expectedLineCount: rec.lines.length,
        actualLineCount: Array.isArray(linesSnapshot) ? linesSnapshot.length : null,
      }
    );
  }

  // Header freeze fields
  rec.header.freezeAtUtc = freezeAtUtc;
  rec.header.freezeLedgerCursor = freezeLedgerCursor;
  rec.header.freezeDerivationRule = "LEDGER_AS_OF_CURSOR";

  rec.header.submittedAtUtc = freezeAtUtc;
  rec.header.submittedByUserId = actorUserId || rec.header.submittedByUserId;

  // Apply snapshot onto lines (by cycleCountLineId match)
  const byId = new Map(rec.lines.map((l) => [l.cycleCountLineId, l]));
  for (const snap of linesSnapshot) {
    const line = byId.get(snap.cycleCountLineId);
    if (!line) {
      throw conflict("FREEZE_SNAPSHOT_UNKNOWN_LINE", "Snapshot references unknown lineId.", {
        cycleCountLineId: snap.cycleCountLineId,
      });
    }

    requireFiniteNumber(snap.systemQtyAtFreeze, "SYSTEM_QTY_INVALID");
    requireFiniteNumber(snap.deltaPlanned, "DELTA_PLANNED_INVALID");

    line.systemQtyAtFreeze = snap.systemQtyAtFreeze;
    line.systemQtyDerivationCursor = freezeLedgerCursor;
    line.deltaPlanned = snap.deltaPlanned;
  }

  const now = nowUtcIso();
  rec.header.updatedAtUtc = now;
  if (actorUserId) rec.header.updatedByUserId = actorUserId;

  return {
    header: { ...rec.header },
    lines: stableSortLines(rec.lines).map((l) => ({ ...l })),
  };
}

/**
 * claimPostLock({ tenantId, cycleCountId, idempotencyKey }) -> { claimed: true } or { claimed: false, reason }
 * Atomic lock: once claimed, cannot be claimed again.
 */
function claimPostLock({ tenantId, cycleCountId, idempotencyKey, actorUserId }) {
  requireTenant(tenantId);
  requireCycleCountId(cycleCountId);
  if (!idempotencyKey) throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required.");

  const rec = mustGetRecord(tenantId, cycleCountId);

  // If already posted, treat as collision
  if (rec.header.status === STATUS.POSTED) {
    return { claimed: false, reason: "POST_ALREADY_COMPLETED" };
  }

  if (rec.header.postIdempotencyKey) {
    return { claimed: false, reason: "POST_IDEMPOTENCY_COLLISION" };
  }

  // Claim lock
  const now = nowUtcIso();
  rec.header.postIdempotencyKey = idempotencyKey;
  rec.header.postLockClaimedAtUtc = now;
  rec.header.postAttemptedAtUtc = now;
  if (actorUserId) rec.header.updatedByUserId = actorUserId;
  rec.header.updatedAtUtc = now;

  return { claimed: true };
}

/**
 * markPosted({ tenantId, cycleCountId, postLedgerBatchId, actorUserId }) -> updatedHeader
 * Requires lock already claimed; sets POSTED fields.
 */
function markPosted({ tenantId, cycleCountId, postLedgerBatchId, actorUserId }) {
  requireTenant(tenantId);
  requireCycleCountId(cycleCountId);
  requireActor(actorUserId);
  if (!postLedgerBatchId) {
    throw badRequest("POST_LEDGER_BATCH_ID_REQUIRED", "postLedgerBatchId is required.");
  }

  const rec = mustGetRecord(tenantId, cycleCountId);

  if (rec.header.status === STATUS.POSTED) {
    throw conflict("POST_ALREADY_COMPLETED", "Cycle count already posted.", { cycleCountId });
  }

  if (!rec.header.postIdempotencyKey) {
    throw conflict("POST_LOCK_REQUIRED", "Post lock not claimed (fail-closed).", { cycleCountId });
  }

  const now = nowUtcIso();
  rec.header.status = STATUS.POSTED;
  rec.header.postedAtUtc = now;
  rec.header.postedByUserId = actorUserId;
  rec.header.postLedgerBatchId = postLedgerBatchId;

  rec.header.updatedAtUtc = now;
  rec.header.updatedByUserId = actorUserId;

  return { ...rec.header };
}

module.exports = {
  STATUS,

  createDraft,
  listByTenant,
  getById,

  addLine,
  updateLine,
  deleteLine,

  transitionStatus,
  persistFreezeSnapshot,

  claimPostLock,
  markPosted,
};

