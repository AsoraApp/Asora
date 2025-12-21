// backend/src/observability/requestId.worker.mjs
// U13: Request ID handling (audit-grade, safe, deterministic propagation).
// - If caller supplies X-Request-Id, accept only if it is safe + bounded.
// - Otherwise generate a new UUID per request (handler-scope; allowed).
// - Never throw.

const MAX_LEN = 128;

// Conservative allow-list (covers UUIDs + common trace IDs)
const SAFE_RE = /^[a-zA-Z0-9._:@-]+$/;

function sanitizeRequestId(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.length > MAX_LEN) return null;
  if (!SAFE_RE.test(s)) return null;
  return s;
}

function safeRandomUuid() {
  try {
    if (globalThis.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // ignore
  }
  // Deterministic fallback is not required here; if UUID API is unavailable,
  // return a stable placeholder rather than throwing.
  return "reqid_unavailable";
}

export function getOrCreateRequestIdFromHeaders(headers) {
  try {
    const existing = headers?.get?.("x-request-id") || headers?.get?.("X-Request-Id") || null;
    const clean = sanitizeRequestId(existing);
    if (clean) return clean;
    return safeRandomUuid();
  } catch {
    return safeRandomUuid();
  }
}
