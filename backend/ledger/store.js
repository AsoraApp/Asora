// Append-only in-memory ledger store (B3 placeholder).
// Replace with DB later without changing semantics.

const _events = []; // append-only
const _idem = new Map(); // tenantId::idempotencyKey -> event

function makeKey(tenantId, idempotencyKey) {
  return `${tenantId}::${idempotencyKey}`;
}

function getByIdempotencyKey(tenantId, idempotencyKey) {
  return _idem.get(makeKey(tenantId, idempotencyKey)) || null;
}

function appendEvent(event) {
  _events.push(event);
  _idem.set(makeKey(event.tenantId, event.idempotencyKey), event);
  return event;
}

// Debug only (do not expose via API)
function _debugAllEvents() {
  return _events.slice();
}

module.exports = {
  getByIdempotencyKey,
  appendEvent,
  _debugAllEvents,
};
