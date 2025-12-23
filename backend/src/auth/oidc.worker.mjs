// backend/src/auth/oidc.worker.mjs
// OIDC Authorization Code + PKCE implementation (provider-agnostic).
// Supports Entra + Okta via resolveOidcConfig().
//
// Security goals:
// - Signed state (HMAC via AUTH_SECRET)
// - PKCE verifier stored HttpOnly cookie (short-lived)
// - No tokens exposed to JS except Asora-issued access token via /api/auth/refresh
//
// NOTE: We exchange code for IdP tokens only to validate identity;
// we then mint Asora session (refresh token cookie + short-lived access token).

import { makeSetCookie, parseCookieHeader, expireCookie } from "./cookies.worker.mjs";
import { resolveOidcConfig, getTenantClaim, getDefaultTenant } from "./tenantIdpConfig.worker.mjs";

function utf8(s) {
  return new TextEncoder().encode(String(s));
}

function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256b64url(str) {
  const digest = await crypto.subtle.digest("SHA-256", utf8(str));
  return b64url(new Uint8Array(digest));
}

function randomB64url(lenBytes = 32) {
  const b = new Uint8Array(lenBytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function hmacSign(secret, message) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, utf8(message));
  return b64url(new Uint8Array(sig));
}

async function hmacVerify(secret, message, sigB64) {
  const key = await hmacKey(secret);
  // decode b64url
  const s = String(sigB64).replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (s.length % 4)) % 4;
  const padded = s + "=".repeat(pad);
  const bin = atob(padded);
  const sig = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) sig[i] = bin.charCodeAt(i);
  return crypto.subtle.verify("HMAC", key, sig, utf8(message));
}

function json(status, body, headersObj) {
  const h = new Headers(headersObj || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: h });
}

function badRequest(code, details) {
  return json(400, { error: "BAD_REQUEST", code, details: details || null });
}

function unauthorized(code, details) {
  return json(401, { error: "UNAUTHORIZED", code, details: details || null });
}

function serverError(code, details) {
  return json(500, { error: "INTERNAL_ERROR", code, details: details || null });
}

async function fetchOidcMetadata(issuer) {
  const metaUrl = issuer.replace(/\/+$/g, "") + "/.well-known/openid-configuration";
  const res = await fetch(metaUrl, { method: "GET" });
  if (!res.ok) throw new Error("OIDC_METADATA_FETCH_FAILED");
  return res.json();
}

function buildAuthorizeUrl({ issuer, clientId, redirectUri, authorization_endpoint, state, codeChallenge }) {
  const u = new URL(authorization_endpoint);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function exchangeCode({ token_endpoint, clientId, clientSecret, redirectUri, code, codeVerifier }) {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("redirect_uri", redirectUri);
  body.set("code", code);
  body.set("code_verifier", codeVerifier);

  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    return { ok: false, status: res.status, body: parsed || { raw: text } };
  }
  return { ok: true, tokens: parsed };
}

function decodeJwtPayload(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return null;
  const b = parts[1];
  const s = String(b).replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (s.length % 4)) % 4;
  const padded = s + "=".repeat(pad);
  const jsonStr = atob(padded);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function pickTenantFromClaims(env, claims) {
  const claimName = getTenantClaim(env);
  const fallback = getDefaultTenant(env);

  const v = claims ? claims[claimName] : null;
  const tenantId = typeof v === "string" && v.trim() ? v.trim() : fallback;
  return tenantId || null;
}

export async function oidcLoginFetch(request, env, baseHeaders) {
  const cfg = resolveOidcConfig(env, request.url);
  if (!cfg || cfg.ok !== true) return serverError(cfg?.code || "OIDC_CONFIG_ERROR", cfg?.details || null);

  const secret = String(env?.AUTH_SECRET || "").trim();
  if (!secret) return serverError("AUTH_SECRET_MISSING", null);

  let meta;
  try {
    meta = await fetchOidcMetadata(cfg.issuer);
  } catch {
    return serverError("OIDC_METADATA_UNAVAILABLE", { issuer: cfg.issuer });
  }

  const authorization_endpoint = meta?.authorization_endpoint;
  const token_endpoint = meta?.token_endpoint;
  if (!authorization_endpoint || !token_endpoint) {
    return serverError("OIDC_METADATA_INCOMPLETE", { issuer: cfg.issuer });
  }

  // PKCE
  const codeVerifier = randomB64url(48);
  const codeChallenge = await sha256b64url(codeVerifier);

  // signed state payload
  const statePayload = {
    v: 1,
    provider: cfg.provider,
    issuer: cfg.issuer,
    // allow returnTo in future; for now always root
    returnTo: "/",
    iat: Date.now(),
  };
  const stateBody = JSON.stringify(statePayload);
  const stateSig = await hmacSign(secret, stateBody);
  const state = b64url(utf8(stateBody)) + "." + stateSig;

  // store verifier in HttpOnly cookie (short-lived)
  const pkceCookie = makeSetCookie({
    name: "__asora_pkce",
    value: codeVerifier,
    maxAgeSec: 600,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });

  const stateCookie = makeSetCookie({
    name: "__asora_state",
    value: state,
    maxAgeSec: 600,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });

  const authorizeUrl = buildAuthorizeUrl({
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    authorization_endpoint,
    state,
    codeChallenge,
  });

  const h = new Headers(baseHeaders || {});
  h.append("Set-Cookie", pkceCookie);
  h.append("Set-Cookie", stateCookie);

  return new Response(null, { status: 302, headers: { ...Object.fromEntries(h), Location: authorizeUrl } });
}

export async function oidcCallbackFetch(request, env, baseHeaders) {
  const cfg = resolveOidcConfig(env, request.url);
  if (!cfg || cfg.ok !== true) return serverError(cfg?.code || "OIDC_CONFIG_ERROR", cfg?.details || null);

  const secret = String(env?.AUTH_SECRET || "").trim();
  if (!secret) return serverError("AUTH_SECRET_MISSING", null);

  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const returnedState = u.searchParams.get("state");
  if (!code || !returnedState) return badRequest("OIDC_CALLBACK_MISSING", { code: !!code, state: !!returnedState });

  const cookies = parseCookieHeader(request.headers.get("Cookie") || "");
  const pkce = cookies["__asora_pkce"] || null;
  const storedState = cookies["__asora_state"] || null;
  if (!pkce || !storedState) return unauthorized("OIDC_STATE_MISSING", null);

  // Must match the cookie state
  if (storedState !== returnedState) return unauthorized("OIDC_STATE_MISMATCH", null);

  // Verify HMAC signature
  const parts = String(returnedState).split(".");
  if (parts.length !== 2) return unauthorized("OIDC_STATE_FORMAT", null);

  let stateJson = null;
  try {
    const payloadB64 = parts[0];
    const sig = parts[1];
    // decode payloadB64 (b64url) -> bytes -> string
    const s = String(payloadB64).replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (s.length % 4)) % 4;
    const padded = s + "=".repeat(pad);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const body = new TextDecoder().decode(bytes);

    const ok = await hmacVerify(secret, body, sig);
    if (!ok) return unauthorized("OIDC_STATE_BAD_SIGNATURE", null);

    stateJson = JSON.parse(body);
  } catch {
    return unauthorized("OIDC_STATE_BAD_PAYLOAD", null);
  }

  // Fetch metadata + exchange code
  let meta;
  try {
    meta = await fetchOidcMetadata(cfg.issuer);
  } catch {
    return serverError("OIDC_METADATA_UNAVAILABLE", { issuer: cfg.issuer });
  }

  const token_endpoint = meta?.token_endpoint;
  if (!token_endpoint) return serverError("OIDC_METADATA_INCOMPLETE", { issuer: cfg.issuer });

  const xr = await exchangeCode({
    token_endpoint,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUri: cfg.redirectUri,
    code,
    codeVerifier: pkce,
  });

  if (!xr.ok) return unauthorized("OIDC_CODE_EXCHANGE_FAILED", { status: xr.status, body: xr.body });

  const idToken = xr.tokens?.id_token;
  if (!idToken) return unauthorized("OIDC_ID_TOKEN_MISSING", null);

  const claims = decodeJwtPayload(idToken);
  if (!claims) return unauthorized("OIDC_ID_TOKEN_DECODE_FAILED", null);

  // Minimal identity extraction
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  const email = typeof claims.email === "string" ? claims.email : null;
  const actorId = sub || email;
  if (!actorId) return unauthorized("OIDC_ACTOR_MISSING", null);

  const tenantId = pickTenantFromClaims(env, claims);
  if (!tenantId) return unauthorized("OIDC_TENANT_MISSING", null);

  // At this point: we do NOT give JS the IdP token.
  // We will set a refresh token cookie via /api/auth/refresh bootstrap flow.
  //
  // We store a short-lived bootstrap cookie with tenant+actor for one-time refresh issuance.
  const bootstrapPayload = JSON.stringify({ v: 1, tenantId, actorId, authLevel: "user", iat: Date.now() });
  const bootstrapSig = await hmacSign(secret, bootstrapPayload);
  const bootstrap = b64url(utf8(bootstrapPayload)) + "." + bootstrapSig;

  const bootCookie = makeSetCookie({
    name: "__asora_boot",
    value: bootstrap,
    maxAgeSec: 120,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });

  const h = new Headers(baseHeaders || {});
  h.append("Set-Cookie", expireCookie({ name: "__asora_pkce" }));
  h.append("Set-Cookie", expireCookie({ name: "__asora_state" }));
  h.append("Set-Cookie", bootCookie);

  // Redirect to UI callback page which will call /api/auth/refresh to mint session.
  return new Response(null, { status: 302, headers: { ...Object.fromEntries(h), Location: "/auth/callback" } });
}
