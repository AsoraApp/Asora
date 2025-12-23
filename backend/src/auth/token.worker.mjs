// backend/src/auth/token.worker.mjs
// U10: Minimal cryptographically verifiable session tokens (HMAC-SHA256).
// Token format: asora.<payload_b64url>.<sig_b64url>
//
// U13: Deterministic verification + fail-closed validation.
// U20: Adds access-token helpers (short-lived) while preserving existing exports.

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
  return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
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

export function nowUtcSeconds(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000);
}

function isSafeTenantId(v) {
  return typeof v === "string" && v.length > 0 && /^[a-zA-Z0-9._-]+$/.test(v);
}

function isSafeActorId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= 200;
}

function isSafeAuthLevel(v) {
  return typeof v === "string" && v.length > 0 && v.length <= 50;
}

function isSafeTokenType(v) {
  return v === "access" || v === "refresh" || v === "oidc_state";
}

function randomB64url(nBytes = 32) {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return b64urlEncode(b);
}

/**
 * Base token signer (asora.<payload>.<sig>)
 */
async function signAsoraToken(env, payload) {
  const secret = env?.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET_MISSING");

  const body = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(utf8(body));
  const msg = `asora.${payloadB64}`;
  const sigB64 = await hmacSignB64url(secret, msg);
  return `${msg}.${sigB64}`;
}

async function verifyAsoraToken(env, token) {
  const secret = env?.AUTH_SECRET;
  if (!secret) return { ok: false, code: "AUTH_SECRET_MISSING", details: null };

  const t = String(token || "");
  const parts = t.split(".");
  if (parts.length !== 3 || parts[0] !== "asora") {
    return { ok: false, code: "AUTH_TOKEN_FORMAT", details: null };
  }

  const payloadB64 = parts[1];
  const sigB64 = parts[2];

  if (!payloadB64 || !sigB64) {
    return { ok: false, code: "AUTH_TOKEN_FORMAT", details: null };
  }

  const msg = `asora.${payloadB64}`;

  let sigOk = false;
  try {
    sigOk = await hmacVerify(secret, msg, sigB64);
  } catch {
    return { ok: false, code: "AUTH_TOKEN_VERIFY_ERROR", details: null };
  }
  if (!sigOk) return { ok: false, code: "AUTH_TOKEN_INVALID_SIGNATURE", details: null };

  let payload;
  try {
    const bytes = b64urlDecodeToBytes(payloadB64);
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, code: "AUTH_TOKEN_BAD_PAYLOAD", details: null };
  }

  if (!payload || typeof payload !== "object") return { ok: false, code: "AUTH_TOKEN_BAD_PAYLOAD", details: null };

  return { ok: true, payload };
}

/**
 * U10 legacy payload shape verifier (kept).
 */
function validateLegacySessionPayload(payload) {
  if (payload.v !== 1) return { ok: false, code: "AUTH_TOKEN_BAD_VERSION" };

  const tenantId = payload.tenantId;
  const actorId = payload.actorId;
  const authLevel = payload.authLevel;
  const iat = payload.iat;
  const exp = payload.exp;

  if (!isSafeTenantId(tenantId)) return { ok: false, code: "AUTH_TOKEN_MISSING_TENANT" };
  if (!isSafeActorId(actorId)) return { ok: false, code: "AUTH_TOKEN_MISSING_ACTOR" };
  if (!isSafeAuthLevel(authLevel)) return { ok: false, code: "AUTH_TOKEN_MISSING_AUTHLEVEL" };
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return { ok: false, code: "AUTH_TOKEN_MISSING_TIME" };

  const now = nowUtcSeconds();
  if (exp <= now) return { ok: false, code: "AUTH_TOKEN_EXPIRED", details: { exp, now } };

  return { ok: true };
}

/**
 * U20 access token payload shape:
 * {
 *   v: 2,
 *   typ: "access",
 *   tenantId: string,
 *   actorId: string,
 *   authLevel: string,
 *   iat: number,
 *   exp: number,
 *   jti: string
 * }
 */
function validateAccessPayload(payload) {
  if (payload.v !== 2) return { ok: false, code: "AUTH_ACCESS_BAD_VERSION" };
  if (payload.typ !== "access") return { ok: false, code: "AUTH_ACCESS_BAD_TYPE" };

  const tenantId = payload.tenantId;
  const actorId = payload.actorId;
  const authLevel = payload.authLevel;
  const iat = payload.iat;
  const exp = payload.exp;
  const jti = payload.jti;

  if (!isSafeTenantId(tenantId)) return { ok: false, code: "AUTH_ACCESS_MISSING_TENANT" };
  if (!isSafeActorId(actorId)) return { ok: false, code: "AUTH_ACCESS_MISSING_ACTOR" };
  if (!isSafeAuthLevel(authLevel)) return { ok: false, code: "AUTH_ACCESS_MISSING_AUTHLEVEL" };
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return { ok: false, code: "AUTH_ACCESS_MISSING_TIME" };
  if (typeof jti !== "string" || jti.length < 10) return { ok: false, code: "AUTH_ACCESS_MISSING_JTI" };

  const now = nowUtcSeconds();
  if (exp <= now) return { ok: false, code: "AUTH_ACCESS_EXPIRED", details: { exp, now } };

  return { ok: true };
}

/**
 * U20 signed cookie payload shape for OIDC state:
 * {
 *   v: 2,
 *   typ: "oidc_state",
 *   iat: number,
 *   exp: number,
 *   state: string,
 *   verifier: string
 * }
 */
function validateOidcStatePayload(payload) {
  if (payload.v !== 2) return { ok: false, code: "OIDC_STATE_BAD_VERSION" };
  if (payload.typ !== "oidc_state") return { ok: false, code: "OIDC_STATE_BAD_TYPE" };

  const iat = payload.iat;
  const exp = payload.exp;
  const state = payload.state;
  const verifier = payload.verifier;

  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return { ok: false, code: "OIDC_STATE_MISSING_TIME" };
  if (typeof state !== "string" || state.length < 10) return { ok: false, code: "OIDC_STATE_MISSING_STATE" };
  if (typeof verifier !== "string" || verifier.length < 20) return { ok: false, code: "OIDC_STATE_MISSING_VERIFIER" };

  const now = nowUtcSeconds();
  if (exp <= now) return { ok: false, code: "OIDC_STATE_EXPIRED", details: { exp, now } };

  return { ok: true };
}

/**
 * U10 exports (unchanged signatures)
 */
export async function signSessionToken(env, payload) {
  return signAsoraToken(env, payload);
}

export async function verifySessionToken(env, token) {
  const vr = await verifyAsoraToken(env, token);
  if (!vr.ok) return vr;

  const payload = vr.payload;
  const v = validateLegacySessionPayload(payload);
  if (!v.ok) return { ok: false, code: v.code, details: v.details || null };

  return { ok: true, session: payload };
}

/**
 * U20: access token helpers
 */
export async function mintAccessToken(env, { tenantId, actorId, authLevel }, ttlSeconds = 600) {
  const now = nowUtcSeconds();
  const payload = {
    v: 2,
    typ: "access",
    tenantId,
    actorId,
    authLevel,
    iat: now,
    exp: now + Math.max(60, Number(ttlSeconds) || 600),
    jti: randomB64url(24),
  };
  return signAsoraToken(env, payload);
}

export async function verifyAccessToken(env, token) {
  const vr = await verifyAsoraToken(env, token);
  if (!vr.ok) return vr;

  const payload = vr.payload;
  const v = validateAccessPayload(payload);
  if (!v.ok) return { ok: false, code: v.code, details: v.details || null };

  return { ok: true, session: payload };
}

/**
 * U20: signed OIDC-state cookie helpers
 */
export async function mintOidcStateCookieValue(env, { state, verifier }, ttlSeconds = 600) {
  const now = nowUtcSeconds();
  const payload = {
    v: 2,
    typ: "oidc_state",
    iat: now,
    exp: now + Math.max(120, Number(ttlSeconds) || 600),
    state,
    verifier,
  };
  return signAsoraToken(env, payload);
}

export async function verifyOidcStateCookieValue(env, value) {
  const vr = await verifyAsoraToken(env, value);
  if (!vr.ok) return vr;

  const payload = vr.payload;
  const v = validateOidcStatePayload(payload);
  if (!v.ok) return { ok: false, code: v.code, details: v.details || null };

  return { ok: true, state: payload };
}

export async function sha256Hex(s) {
  const bytes = utf8(String(s || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const b = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
  return out;
}

export async function pkceChallengeS256(verifier) {
  const bytes = utf8(String(verifier || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return b64urlEncode(new Uint8Array(digest));
}

export function randomUrlSafeString(nBytes = 32) {
  return randomB64url(nBytes);
}

export function isProdEnv(env) {
  const v = String(env?.ENV || "").toLowerCase();
  return v === "prod" || v === "production";
}
