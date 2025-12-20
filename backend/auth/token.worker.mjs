// backend/auth/token.worker.mjs
// U10: Minimal cryptographically verifiable session tokens (HMAC-SHA256).
// Token format: asora.<payload_b64url>.<sig_b64url>

function utf8(s) {
  return new TextEncoder().encode(String(s));
}

function b64urlEncode(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecodeToBytes(b64url) {
  const s = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = s + "=".repeat(padLen);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret) {
  const keyBytes = utf8(secret);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function hmacSignB64url(secret, message) {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, utf8(message));
  return b64urlEncode(new Uint8Array(sig));
}

async function hmacVerify(secret, message, sigB64url) {
  const key = await importHmacKey(secret);
  const sigBytes = b64urlDecodeToBytes(sigB64url);
  return crypto.subtle.verify("HMAC", key, sigBytes, utf8(message));
}

export function normalizeNowUtcSeconds(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000);
}

/**
 * Payload shape (minimal, deterministic):
 * {
 *   v: 1,
 *   tenantId: string,
 *   actorId: string,
 *   authLevel: "user"|"service"|"system"|"dev",
 *   iat: number (unix seconds),
 *   exp: number (unix seconds)
 * }
 */

export async function signSessionToken(env, payload) {
  const secret = env?.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET_MISSING");

  const body = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(utf8(body));
  const msg = `asora.${payloadB64}`;
  const sigB64 = await hmacSignB64url(secret, msg);
  return `${msg}.${sigB64}`;
}

export async function verifySessionToken(env, token) {
  const secret = env?.AUTH_SECRET;
  if (!secret) return { ok: false, code: "AUTH_SECRET_MISSING", details: null };

  const t = String(token || "");
  const parts = t.split(".");
  // Expected: ["asora", "<payload>", "<sig>"]
  if (parts.length !== 3 || parts[0] !== "asora") {
    return { ok: false, code: "AUTH_TOKEN_FORMAT", details: null };
  }

  const payloadB64 = parts[1];
  const sigB64 = parts[2];
  const msg = `asora.${payloadB64}`;

  const sigOk = await hmacVerify(secret, msg, sigB64);
  if (!sigOk) return { ok: false, code: "AUTH_TOKEN_INVALID_SIGNATURE", details: null };

  let payload;
  try {
    const bytes = b64urlDecodeToBytes(payloadB64);
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, code: "AUTH_TOKEN_BAD_PAYLOAD", details: null };
  }

  // Fail-closed validation
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: "AUTH_TOKEN_BAD_PAYLOAD", details: null };
  }
  if (payload.v !== 1) return { ok: false, code: "AUTH_TOKEN_BAD_VERSION", details: null };

  const tenantId = payload.tenantId;
  const actorId = payload.actorId;
  const authLevel = payload.authLevel;
  const iat = payload.iat;
  const exp = payload.exp;

  if (!tenantId || typeof tenantId !== "string") return { ok: false, code: "AUTH_TOKEN_MISSING_TENANT", details: null };
  if (!actorId || typeof actorId !== "string") return { ok: false, code: "AUTH_TOKEN_MISSING_ACTOR", details: null };
  if (!authLevel || typeof authLevel !== "string") return { ok: false, code: "AUTH_TOKEN_MISSING_AUTHLEVEL", details: null };
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return { ok: false, code: "AUTH_TOKEN_MISSING_TIME", details: null };

  const now = normalizeNowUtcSeconds();
  // Expiration must be enforced (fail closed)
  if (exp <= now) return { ok: false, code: "AUTH_TOKEN_EXPIRED", details: { exp, now } };

  return { ok: true, session: payload };
}
