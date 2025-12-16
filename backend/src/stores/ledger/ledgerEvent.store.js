/**
 * Append-only placeholder store for B3.
 * Deterministic, in-memory per process.
 * Replace with DB later, preserving semantics.
 */

const _events = []; // append-only
const _idempotencyIndex = new Map(); // key: tenantId|idempotencyKey → event

function makeKey(tenantId, idempotencyKey) {
  return `${tenantId}::${idempotencyKey}`;
}

export function getByIdempotencyKey(tenantId, idempotencyKey) {
  const k = makeKey(tenantId, idempotencyKey);
  return _idempotencyIndex.get(k) || null;
}

export function appendEvent(event) {
  // Enforce append-only at API boundary
  _events.push(event);

  const k = makeKey(event.tenantId, event.idempotencyKey);
  _idempotencyIndex.set(k, event);

  return event;
}

// Optional read for verification only (do not expose via API)
export function _debugAllEvents() {
  return _events.slice();
}
