// backend/src/storage/idempotency.js
const crypto = require("crypto");
const { getById, upsertById } = require("./jsonStore");

/**
 * Idempotency records are tenant-scoped and keyed by:
 *   scopeKey = `${tenantId}::${namespace}::${idemKey}`
 */
function hashPayload(payload) {
  const json = JSON.stringify(payload === undefined ? null : payload);
  return crypto.createHash("sha256").update(json).digest("hex");
}

function scopeKey(tenantId, namespace, idemKey) {
  return `${tenantId}::${namespace}::${idemKey}`;
}

function getIdempotency(tenantId, namespace, idemKey) {
  return getById(tenantId, "idempotency", "scopeKey", scopeKey(tenantId, namespace, idemKey));
}

function putIdempotency(tenantId, namespace, idemKey, requestFingerprint, responseObj) {
  const record = {
    scopeKey: scopeKey(tenantId, namespace, idemKey),
    tenantId,
    namespace,
    idemKey,
    requestFingerprint,
    responseObj,
    createdAtUtc: new Date().toISOString(),
  };
  return upsertById(tenantId, "idempotency", "scopeKey", record);
}

/**
 * Enforce deterministic replay:
 * - if record exists and fingerprint matches => return saved response
 * - if record exists and fingerprint differs => conflict
 * - else => no record
 */
function checkIdempotency({ tenantId, namespace, idemKey, requestBody }) {
  const fp = hashPayload(requestBody);
  const existing = getIdempotency(tenantId, namespace, idemKey);
  if (!existing) return { hit: false, fingerprint: fp, response: null };

  if (existing.requestFingerprint !== fp) {
    const err = new Error("Idempotency replay fingerprint mismatch");
    err.code = "IDEMPOTENCY_REPLAY_MISMATCH";
    err.details = { namespace };
    throw err;
  }
  return { hit: true, fingerprint: fp, response: existing.responseObj };
}

module.exports = { checkIdempotency, putIdempotency };
