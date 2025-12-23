// backend/src/auth/oidc.worker.mjs
// U20: OIDC Authorization Code + PKCE (OIDC-first).
// - Discovers endpoints from issuer (.well-known/openid-configuration)
// - Generates state + verifier
// - Stores signed state/verifier in HttpOnly cookie
// - Exchanges code for tokens at token endpoint
// - Derives actorId from id_token claims (sub) deterministically
//
// NOTE: tenant mapping is placeholder: we bind all OIDC logins to tenant "demo" unless mapping exists.
// In U20-B we replace this with org provisioning / tenant mapping rules.

import { mintOidcStateCookieValue, verifyOidcStateCookieValue, pkceChallengeS256, randomUrlSafeString } from "./token.worker.mjs";
import { issueInitialSession } from "./refresh.worker.mjs";

const OIDC_COOKIE = "asora_oidc";
const DEFAULT_TENANT = "demo";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function parseCookies(request) {
  const raw = request?.headers?.get?.("Cookie") || request?.headers?.get?.("cookie") || "";
  const out = {};
  const parts = String(raw).split(";");
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    const idx = s.indexOf("=");
    if (idx <= 0) continue;
    const k = s.slice(0, idx).trim();
    const v = s.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

function setCookie(headers, { name, value, maxAgeSec }) {
  const parts = [];
  parts.push(`${name}=${value}`);
  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push("Secure");
  parts.push("SameSite=Strict");
  if (Number.isFinite(maxAgeSec)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`);
  headers.append("Set-Cookie", parts.join("; "));
}

function clearCookie(headers, name) {
  const parts = [];
  parts.push(`${name}=`);
  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push("Secure");
  parts.push("SameSite=Strict");
  parts.push("Max-Age=0");
  headers.append("Set-Cookie", parts.join("; "));
}

let __DISCOVERY = null;
let __DISCOVERY_AT_MS = 0;

async function discover(env) {
  const issuer = String(env?.OIDC_ISSUER || "").replace(/\/+$/g, "");
  if (!issuer) return { ok: false, code: "OIDC_ISSUER_MISSING" };

  const now = Date.now();
  if (__DISCOVERY && now - __DISCOVERY_AT_MS < 10 * 60 * 1000) {
    return { ok: true, config: __DISCOVERY };
  }

  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) return { ok: false, code: "OIDC_DISCOVERY_FAILED" };

  const cfg = await res.json();
  if (!cfg?.authorization_endpoint || !cfg?.token_endpoint) return { ok: false, code: "OIDC_DISCOVERY_BAD" };

  __DISCOVERY = cfg;
  __DISCOVERY_AT_MS = now;
  return { ok: true, config: cfg };
}

function b64urlJsonDecode(part) {
  // JWT part is base64url
  const s = String(part).replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = s + "=".repeat(padLen);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const txt = new TextDecoder().decode(bytes);
  return JSON.parse(txt);
}

function decodeJwtPayload(jwt) {
  const parts = String(jwt || "").split(".");
  if (parts.length < 2) return null;
  try {
    return b64urlJsonDecode(parts[1]);
  } catch {
    return null;
  }
}

export async function oidcStart(env, request, baseHeaders) {
  const dr = await discover(env);
  if (!dr.ok) return json(503, { error: "SERVICE_UNAVAILABLE", code: dr.code, details: null }, baseHeaders);

  const clientId = String(env?.OIDC_CLIENT_ID || "");
  const redirectUri = String(env?.OIDC_REDIRECT_URI || "");
  const scopes = String(env?.OIDC_SCOPES || "openid profile email");

  if (!clientId) return json(503, { error: "SERVICE_UNAVAILABLE", code: "OIDC_CLIENT_ID_MISSING", details: null }, baseHeaders);
  if (!redirectUri) return json(503, { error: "SERVICE_UNAVAILABLE", code: "OIDC_REDIRECT_URI_MISSING", details: null }, baseHeaders);

  const state = randomUrlSafeString(24);
  const verifier = randomUrlSafeString(48);
  const challenge = await pkceChallengeS256(verifier);

  const cookieVal = await mintOidcStateCookieValue(env, { state, verifier }, 600);

  const u = new URL(dr.config.authorization_endpoint);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scopes);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");

  const h = new Headers(baseHeaders || {});
  setCookie(h, { name: OIDC_COOKIE, value: cookieVal, maxAgeSec: 600 });

  // 302 redirect to IdP
  return new Response(null, {
    status: 302,
    headers: (() => {
      h.set("Location", u.toString());
      return h;
    })(),
  });
}

export async function oidcCallback(env, request, baseHeaders) {
  const dr = await discover(env);
  if (!dr.ok) return json(503, { error: "SERVICE_UNAVAILABLE", code: dr.code, details: null }, baseHeaders);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (!code || !returnedState) {
    return json(400, { error: "BAD_REQUEST", code: "OIDC_CALLBACK_MISSING", details: null }, baseHeaders);
  }

  const cookies = parseCookies(request);
  const rawCookie = cookies[OIDC_COOKIE] ? String(cookies[OIDC_COOKIE]) : "";
  if (!rawCookie) {
    return json(401, { error: "UNAUTHORIZED", code: "OIDC_STATE_REQUIRED", details: null }, baseHeaders);
  }

  const vr = await verifyOidcStateCookieValue(env, rawCookie);
  if (!vr.ok) {
    return json(401, { error: "UNAUTHORIZED", code: vr.code || "OIDC_STATE_INVALID", details: vr.details || null }, baseHeaders);
  }

  const { state, verifier } = vr.state;
  if (String(returnedState) !== String(state)) {
    return json(401, { error: "UNAUTHORIZED", code: "OIDC_STATE_MISMATCH", details: null }, baseHeaders);
  }

  const clientId = String(env?.OIDC_CLIENT_ID || "");
  const clientSecret = String(env?.OIDC_CLIENT_SECRET || "");
  const redirectUri = String(env?.OIDC_REDIRECT_URI || "");

  if (!clientId) return json(503, { error: "SERVICE_UNAVAILABLE", code: "OIDC_CLIENT_ID_MISSING", details: null }, baseHeaders);
  if (!clientSecret) return json(503, { error: "SERVICE_UNAVAILABLE", code: "OIDC_CLIENT_SECRET_MISSING", details: null }, baseHeaders);
  if (!redirectUri) return json(503, { error: "SERVICE_UNAVAILABLE", code: "OIDC_REDIRECT_URI_MISSING", details: null }, baseHeaders);

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", redirectUri);
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("code_verifier", verifier);

  const tokenRes = await fetch(dr.config.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!tokenRes.ok) {
    return json(401, { error: "UNAUTHORIZED", code: "OIDC_TOKEN_EXCHANGE_FAILED", details: null }, baseHeaders);
  }

  const tok = await tokenRes.json();
  const idToken = tok?.id_token ? String(tok.id_token) : "";
  if (!idToken) {
    return json(401, { error: "UNAUTHORIZED", code: "OIDC_ID_TOKEN_MISSING", details: null }, baseHeaders);
  }

  const claims = decodeJwtPayload(idToken);
  const sub = claims?.sub ? String(claims.sub) : "";
  if (!sub) {
    return json(401, { error: "UNAUTHORIZED", code: "OIDC_SUB_MISSING", details: null }, baseHeaders);
  }

  // U20-A tenant mapping placeholder: bind to demo tenant.
  // U20-B will implement enterprise mapping/provisioning.
  const tenantId = DEFAULT_TENANT;
  const actorId = `oidc:${sub}`;
  const authLevel = "user";

  const h = new Headers(baseHeaders || {});
  clearCookie(h, OIDC_COOKIE);

  // Issues refresh cookie + returns access token
  return issueInitialSession(env, tenantId, actorId, authLevel, h);
}
