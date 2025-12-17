// backend/src/controllers/cycleCounts/cycleCounts.post.js
//
// Raw HTTP handler (no Express). Returns boolean handled.
// Route: POST /api/cycle-counts/:cycleCountId/post
//
// Rules:
// - Only APPROVED can post
// - Idempotent: claim post lock; collisions return 409
// - Posts append-only ledger ADJUSTMENT events (one per non-zero delta line)
// - Uses freeze snapshot fields (systemQtyAtFreeze + deltaPlanned). No live qty at post time.
// - Marks cycle count POSTED only after ledger writes succeed.

const crypto = require("crypto");

const cycleCountsStore = require("../../stores/cycleCounts.store");
const { sortLinesDeterministically } = require("../../domain/cycleCounts/posting");
const { emitAudit } = require("../../observability/audit");

// Ledger modules (B3)
const ledgerStore = require("../../ledger/store");
const ledgerValidate = require("../../ledger/validate");

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

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function requireFunction(mod, names, moduleLabel) {
  for (const n of names) {
    if (typeof mod?.[n] === "function") return mod[n].bind(mod);
  }
  const err = new Error(`Required function missing in ${moduleLabel} (fail-closed).`);
  err.statusCode = 500;
  err.reasonCode = "INTERNAL_MISWIRE";
  throw err;
}

function safeToNumber(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function buildAdjustmentEvent({
  tenantId,
  actorUserId,
  cycleCountId,
  line,
  deltaQty,
  freezeLedgerCursor,
  postLedgerBatchId,
}) {
  const occurredAtUtc = new Date().toISOString();

  // Canonical fields for this repo (B3-compatible naming)
  return {
    ledgerEventId: uuid(), // if B3 store assigns IDs, validate/store will ignore/overwrite; ok in MVP
    tenantId,

    eventType: "ADJUSTMENT",
    occurredAtUtc,

    hubId: line.hubId,
    binId: line.binId,
    skuId: line.skuId,

    deltaQty,

    // Attribution + traceability
    actorUserId,
    reasonCode: "CYCLE_COUNT",

    sourceType: "CYCLE_COUNT",
    sourceId: cycleCountId,
    sourceLineId: line.cycleCountLineId,

    // Determinism evidence
    freezeLedgerCursor,
    postLedgerBatchId,
  };
}

function validateEventOrFail(event) {
  // Prefer explicit validator names; fail-closed if none exist.
  const validateFn = requireFunction(
    ledgerValidate,
    ["validateLedgerEvent", "validateEvent", "assertValidLedgerEvent"],
    "ledger/validate"
  );
  // Some validators return {ok:false,error}, some throw. Support both deterministically.
  const out = validateFn(event);
  if (out && out.ok === false) {
    const err = new Error(out.error?.message || "Ledger event validation failed.");
    err.statusCode = out.status || 400;
    err.reasonCode = out.error?.code || "LEDGER_EVENT_INVALID";
    throw err;
  }
}

function appendEventOrFail(event) {
  // Prefer explicit append/write names; fail-closed if none exist.
  const appendFn = requireFunction(
    ledgerStore,
    ["appendEvent", "append", "writeEvent", "addEvent"],
    "ledger/store"
  );
  const out = appendFn(event);
  // If store returns {ok:false,...}, fail-closed.
  if (out && out.ok === false) {
    const err = new Error(out.error?.message || "Ledger append failed.");
    err.statusCode = out.status || 500;
    err.reasonCode = out.error?.code || "LEDGER_APPEND_FAILED";
    throw err;
  }
}

function postCycleCountHttp(req, res, requestId) {
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

    const { header, lines } = cycleCountsStore.getById({ tenantId, cycleCountId });

    // Must be APPROVED to post
    if (header.status !== cycleCountsStore.STATUS.APPROVED) {
      emitAudit({
        category: "INVENTORY",
        eventType: "CYCLE_COUNT.POST_DENIED_WRONG_STATE",
        requestId,
        userId,
        tenantId,
        cycleCountId,
        status: header.status,
      });

      json(res, 409, {
        error: { code: "POST_INVALID_STATE", message: "Post allowed only from APPROVED." },
        requestId,
      });
      return true;
    }

    // Freeze determinism required
    if (!header.freezeAtUtc || !header.freezeLedgerCursor) {
      emitAudit({
        category: "INVENTORY",
        eventType: "CYCLE_COUNT.POST_DENIED_NO_FREEZE",
        requestId,
        userId,
        tenantId,
        cycleCountId,
      });

      json(res, 409, {
        error: {
          code: "FREEZE_SNAPSHOT_MISSING",
          message: "Freeze snapshot missing (fail-closed).",
        },
        requestId,
      });
      return true;
    }

    // Idempotency claim
    const idempotencyKey = `cycle_count_post:${tenantId}:${cycleCountId}`;
    const claim = cycleCountsStore.claimPostLock({
      tenantId,
      cycleCountId,
      idempotencyKey,
      actorUserId: userId,
    });

    if (!claim.claimed) {
      emitAudit({
        category: "INVENTORY",
        eventType: "CYCLE_COUNT.POST_IDEMPOTENCY_COLLISION",
        requestId,
        userId,
        tenantId,
        cycleCountId,
        reason: claim.reason,
      });

      json(res, 409, {
        error: {
          code: claim.reason || "POST_IDEMPOTENCY_COLLISION",
          message: "Post already claimed/completed (idempotent).",
        },
        requestId,
      });
      return true;
    }

    // Deterministic line order
    const ordered = sortLinesDeterministically(Array.isArray(lines) ? lines : []);

    // Build events for non-zero deltas, using stored snapshot fields only
    const postLedgerBatchId = `cc_post_${uuid()}`;
    const eventsToWrite = [];

    for (const line of ordered) {
      const systemQtyAtFreeze = safeToNumber(line.systemQtyAtFreeze);
      const deltaPlanned = safeToNumber(line.deltaPlanned);
      const countedQty = safeToNumber(line.countedQty);

      if (systemQtyAtFreeze === null || deltaPlanned === null || countedQty === null) {
        emitAudit({
          category: "INVENTORY",
          eventType: "CYCLE_COUNT.POST_DENIED_SNAPSHOT_MISSING",
          requestId,
          userId,
          tenantId,
          cycleCountId,
          cycleCountLineId: line.cycleCountLineId,
        });

        json(res, 409, {
          error: {
            code: "FREEZE_SNAPSHOT_MISSING",
            message: "Line snapshot missing (fail-closed).",
          },
          requestId,
        });
        return true;
      }

      // Recompute delta and require it matches stored deltaPlanned (fail-closed)
      const recomputed = countedQty - systemQtyAtFreeze;
      if (recomputed !== deltaPlanned) {
        emitAudit({
          category: "INVENTORY",
          eventType: "CYCLE_COUNT.POST_DENIED_SNAPSHOT_MISMATCH",
          requestId,
          userId,
          tenantId,
          cycleCountId,
          cycleCountLineId: line.cycleCountLineId,
          recomputed,
          deltaPlanned,
        });

        json(res, 409, {
          error: {
            code: "SNAPSHOT_MISMATCH",
            message: "Snapshot mismatch (fail-closed).",
          },
          requestId,
        });
        return true;
      }

      if (deltaPlanned === 0) continue;

      const event = buildAdjustmentEvent({
        tenantId,
        actorUserId: userId,
        cycleCountId,
        line,
        deltaQty: deltaPlanned,
        freezeLedgerCursor: header.freezeLedgerCursor,
        postLedgerBatchId,
      });

      validateEventOrFail(event);
      eventsToWrite.push(event);
    }

    // Append events (append-only)
    for (const ev of eventsToWrite) appendEventOrFail(ev);

    // Mark POSTED (only after ledger writes succeeded)
    const postedHeader = cycleCountsStore.markPosted({
      tenantId,
      cycleCountId,
      postLedgerBatchId,
      actorUserId: userId,
    });

    emitAudit({
      category: "INVENTORY",
      eventType: "CYCLE_COUNT.POST_SUCCEEDED",
      requestId,
      userId,
      tenantId,
      cycleCountId,
      postLedgerBatchId,
      ledgerEventCount: eventsToWrite.length,
    });

    json(res, 200, {
      header: postedHeader,
      postedLedgerEventCount: eventsToWrite.length,
      postLedgerBatchId,
      requestId,
    });
    return true;
  } catch (err) {
    const m = mapErr(err);

    // Audit deny on 409 collisions/wrong-state is helpful
    if (m.status === 409) {
      emitAudit({
        category: "INVENTORY",
        eventType: "CYCLE_COUNT.POST_DENIED",
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
  postCycleCountHttp,
};

