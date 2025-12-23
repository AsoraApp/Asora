// backend/src/worker/auth.worker.mjs

import { signSessionToken, nowUtcSeconds } from "../auth/token.worker.mjs";
import { makeSetCookie, parseCookieHeader, expireCookie } from "../auth/cookies.worker.mjs";
import { oidcLoginFetch, oidcCallbackFetch } from "../auth/oidc.worker.mjs";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function ttlSecFromEnv(env, key, fallback) {
  const v = Number(env?.[key]);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.floor(v);
}

function randomTokenB64url(lenBytes = 32) {
  const b = new Uint8Array(lenBytes);
  crypto.getRandomValues(b);
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function callRegistry(env, name, payload) {
  const id = env.SESSION_REGISTRY.idFromName(String(name));
  const stub = env.SESSION_REGISTRY.get(id);
  const res = await stub.fetch("https://do.internal/" + payload.path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Asora-Internal": String(env?.AUTH_SECRET || ""),
    },
    body: JSON.stringify(payload.body || {}),
  });
  return res.json();
}

/**
 * GET /api/auth/me
 */
export function authMeFetch(ctx, baseHeaders) {
  const s = ctx?.session || null;

  return json(
    200,
    {
      ok: true,
      tenantId: ctx?.tenantId ?? null,
      actorId: s?.actorId ?? null,
      authLevel: s?.authLevel ?? null,
      deprecated: s?.deprecated === true,
      deprecatedReason: s?.deprecatedReason ?? null,
      requestId: ctx?.requestId ?? null,
    },
    baseHeaders
  );
}

/**
 * GET /api/auth/login
 * - redirects to IdP authorize URL
 */
export async function authLoginFetch(request, env, baseHeaders) {
  return oidcLoginFetch(request, env, baseHeaders);
}

/**
 * GET /api/auth/callback
 * - handles IdP redirect
 */
export async function authCallbackFetch(request, env, baseHeaders) {
  return oidcCallbackFetch(request, env, baseHeaders);
}

/**
 * POST /api/auth/refresh
 * - Uses either:
 *   A) existing refresh cookie (__asora_rt) -> rotate + mint new access token
 *   B) bootstrap cookie (__asora_boot) set by OIDC callback -> issue first refresh token
 *
 * Returns:
 *  { ok:true, accessToken, expiresAtUtcSec, tenantId, actorId, authLevel }
 */
export async function authRefreshFetch(request, ctx, env, baseHeaders) {
  const cookies = parseCookieHeader(request.headers.get("Cookie") || "");

  const accessTtl = ttlSecFromEnv(env, "ACCESS_TOKEN_TTL_SEC", 600);
  const refreshTtl = ttlSecFromEnv(env, "REFRESH_TOKEN_TTL_SEC", 1209600);

  const existingRt = cookies["__asora_rt"] || null;
  const bootstrap = cookies["__asora_boot"] || null;

  // Case A: already have refresh token -> rotate
  if (existingRt) {
    const newRt = randomTokenB64url(48);

    const rotated = await callRegistry(env, "global", {
      path: "rotate",
      body: { oldToken: existingRt, newToken: newRt, ttlSec: refreshTtl },
    });

    if (!rotated || rotated.ok !== true) {
      const h = new Headers(baseHeaders || {});
      h.append("Set-Cookie", expireCookie({ name: "__asora_rt" }));
      return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED", code: rotated?.code || "REFRESH_INVALID", details: rotated || null }), {
        status: 401,
        headers: h,
      });
    }

    const now = nowUtcSeconds();
    const exp = now + accessTtl;

    const accessToken = await signSessionToken(env, {
      v: 1,
      tenantId: rotated.tenantId,
      actorId: rotated.actorId,
      authLevel: rotated.authLevel,
      iat: now,
      exp,
    });

    const rtCookie = makeSetCookie({
      name: "__asora_rt",
      value: newRt,
      maxAgeSec: refreshTtl,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });

    const h = new Headers(baseHeaders || {});
    h.append("Set-Cookie", rtCookie);

    return json(
      200,
      {
        ok: true,
        accessToken,
        expiresAtUtcSec: exp,
        tenantId: rotated.tenantId,
        actorId: rotated.actorId,
        authLevel: rotated.authLevel,
      },
      h
    );
  }

  // Case B: bootstrap cookie (one-time)
  if (bootstrap) {
    // verify bootstrap signature using AUTH_SECRET (same encoding as oidc.worker.mjs)
    const secret = String(env?.AUTH_SECRET || "").trim();
    if (!secret) return json(500, { ok: false, error: "INTERNAL_ERROR", code: "AUTH_SECRET_MISSING", details: null }, baseHeaders);

    const parts = String(bootstrap).split(".");
    if (parts.length !== 2) return json(401, { ok: false, error: "UNAUTHORIZED", code: "BOOTSTRAP_FORMAT", details: null }, baseHeaders);

    let payload = null;
    try {
      const payloadB64 = parts[0];
      const sig = parts[1];

      // decode payloadB64
      const s = String(payloadB64).replace(/-/g, "+").replace(/_/g, "/");
      const pad = (4 - (s.length % 4)) % 4;
      const padded = s + "=".repeat(pad);
      const bin = atob(padded);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const body = new TextDecoder().decode(bytes);

      // verify HMAC
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      const sigS = String(sig).replace(/-/g, "+").replace(/_/g, "/");
      const pad2 = (4 - (sigS.length % 4)) % 4;
      const padded2 = sigS + "=".repeat(pad2);
      const bin2 = atob(padded2);
      const sigBytes = new Uint8Array(bin2.length);
      for (let i = 0; i < bin2.length; i++) sigBytes[i] = bin2.charCodeAt(i);

      const ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(body));
      if (!ok) return json(401, { ok: false, error: "UNAUTHORIZED", code: "BOOTSTRAP_BAD_SIGNATURE", details: null }, baseHeaders);

      payload = JSON.parse(body);
    } catch {
      return json(401, { ok: false, error: "UNAUTHORIZED", code: "BOOTSTRAP_BAD_PAYLOAD", details: null }, baseHeaders);
    }

    const tenantId = String(payload?.tenantId || "").trim();
    const actorId = String(payload?.actorId || "").trim();
    const authLevel = String(payload?.authLevel || "user").trim();
    if (!tenantId || !actorId) return json(401, { ok: false, error: "UNAUTHORIZED", code: "BOOTSTRAP_MISSING_IDENTITY", details: null }, baseHeaders);

    const rt = randomTokenB64url(48);

    const issued = await callRegistry(env, "global", {
      path: "issue",
      body: { refreshToken: rt, tenantId, actorId, authLevel, ttlSec: refreshTtl },
    });

    if (!issued || issued.ok !== true) {
      return json(500, { ok: false, error: "INTERNAL_ERROR", code: "REGISTRY_ISSUE_FAILED", details: issued || null }, baseHeaders);
    }

    const now = nowUtcSeconds();
    const exp = now + accessTtl;

    const accessToken = await signSessionToken(env, { v: 1, tenantId, actorId, authLevel, iat: now, exp });

    const rtCookie = makeSetCookie({
      name: "__asora_rt",
      value: rt,
      maxAgeSec: refreshTtl,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });

    const h = new Headers(baseHeaders || {});
    h.append("Set-Cookie", rtCookie);
    h.append("Set-Cookie", expireCookie({ name: "__asora_boot" }));

    return json(200, { ok: true, accessToken, expiresAtUtcSec: exp, tenantId, actorId, authLevel }, h);
  }

  return json(401, { ok: false, error: "UNAUTHORIZED", code: "NO_REFRESH_CONTEXT", details: null }, baseHeaders);
}

/**
 * POST /api/auth/logout
 * - revokes refresh token (if present) and clears cookie
 */
export async function authLogoutFetch(request, env, baseHeaders) {
  const cookies = parseCookieHeader(request.headers.get("Cookie") || "");
  const rt = cookies["__asora_rt"] || null;

  if (rt) {
    await callRegistry(env, "global", { path: "revoke", body: { refreshToken: rt } });
  }

  const h = new Headers(baseHeaders || {});
  h.append("Set-Cookie", expireCookie({ name: "__asora_rt" }));
  h.append("Set-Cookie", expireCookie({ name: "__asora_boot" }));
  return json(200, { ok: true }, h);
}
