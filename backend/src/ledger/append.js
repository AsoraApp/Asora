// backend/src/ledger/append.js
const crypto = require("crypto");
const { upsertById, list } = require("../storage/jsonStore");
const { checkIdempotency, putIdempotency } = require("../storage/idempotency");

/**
 * Append-only ledger store (tenant-scoped).
 * Event shape (minimal):
 *   {
 *     ledgerEventId,
 *     tenantId,
 *     eventType,            // e.g., "RECEIPT"
 *     occurredAtUtc,
 *     postedAtUtc,
 *     idempotencyKey,
 *     objectType,
 *     objectId,
 *     lines: [{ skuId, quantity, hubId?, binId? }],
 *     facts: {}
 *   }
 */
function newId() {
  return crypto.randomUUID();
}

function appendLedgerEvent(ctx, { namespace, idempotencyKey, event }) {
  if (!idempotencyKey) {
    const err = new Error("Missing Idempotency-Key");
    err.code = "INVALID_REQUEST";
    err.details = { field: "Idempotency-Key" };
    throw err;
  }

  const idem = checkIdempotency({
    tenantId: ctx.tenantId,
    namespace,
    idemKey: idempotencyKey,
    requestBody: event,
  });

  if (idem.hit) return idem.response;

  const now = new Date().toISOString();
  const ledgerEvent = {
    ledgerEventId: newId(),
    tenantId: ctx.tenantId,
    eventType: String(event.eventType),
    occurredAtUtc: String(event.occurredAtUtc || now),
    postedAtUtc: now,
    idempotencyKey: String(idempotencyKey),
    objectType: String(event.objectType || "UNKNOWN"),
    objectId: String(event.objectId || "UNKNOWN"),
    lines: Array.isArray(event.lines) ? event.lines : [],
    facts: event.facts && typeof event.facts === "object" ? event.facts : {},
  };

  upsertById(ctx.tenantId, "ledger_events", "ledgerEventId", ledgerEvent);

  const response = { ledgerEvent };
  putIdempotency(ctx.tenantId, namespace, idempotencyKey, idem.fingerprint, response);
  return response;
}

function listLedgerEvents(ctx) {
  return list(ctx.tenantId, "ledger_events");
}

module.exports = { appendLedgerEvent, listLedgerEvents };
