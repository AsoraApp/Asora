// backend/src/auth/session.worker.mjs
// U10/U13/U16: Session resolution layer.
// - Primary (U20): Authorization: Bearer <access token v2 typ=access>
// - Transitional (deprecated): dev_token compatibility bridge (non-prod only)
// - U16 FIX: Also accept Authorization: Bearer tenant:<tenantId> as dev_token compat (non-prod only)
//
// FAIL-CLOSED:
// - No anonymous access.
// - Resolves exactly one tenantId, or returns a deterministic denial.
//
// IMPORTANT:
// - This function is async.
// - Call signature is: resolveSessionFromHeaders(request, env)

import { verifyAccessToken, verifySessionToken, isProdEnv } from "./token.worker.mjs";
import { devTokenToSession } from "./devTokenCompat.worker.mjs";

function getBearerToken(headers) {
  const h = headers?.get?.("Authorization") || headers?.get?.("authorization") || "";
  const s = String(h).trim();
  if (!s) return null;
  const m = s.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return m[1].trim();
}

function getDevTokenFromUrl(url) {
  try {
    const u = new URL(url);
    const v = u.searchParams.get("dev_token");
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

function isDevTokenLike(v) {
  if (!v || typeof v !== "string") return false;
  const s = v.trim();
  return /^tenant:[A-Za-z0-9._-]+$/.test(s);
}

function sanitizeSession(session) {
  if (!session || typeof session !== "object") return null;

  if (!session.tenantId || typeof session.tenantId !== "string") return null;
  if (!session.actorId || typeof session.actorId !== "string") return null;
  if (!session.authLevel || typeof session.authLevel !== "string") return null;

  return {
    isAuthenticated: true,
    token: null,
    tenantId: session.tenantId,
    actorId: session.actorId,
    authLevel: session.authLevel,
    deprecated: session.deprecated === true,
    deprecatedReason: session.deprecatedReason || null,
  };
}

export async function resolveSessionFromHeaders(request, env) {
  if (!request || !request.headers || typeof request.url !== "string") {
    return { ok: false, status: 401, error: "UNAUTHORIZED", code: "AUTH_REQUIRED", details: null };
  }

  const prod = isProdEnv(env);

  // 1) Primary: Bearer access token (v2 typ=access)
  const bearer = getBearerToken(request.headers);
  if (bearer) {
    // Non-prod only: allow Bearer tenant:<id> as dev compat
    if (!prod && isDevTokenLike(bearer)) {
      const compatPayload = devTokenToSession(bearer);
      const clean = sanitizeSession(compatPayload);
      if (!clean) {
        return { ok: false, status: 401, error: "UNAUTHORIZED", code: "AUTH_DEV_TOKEN_INVALID", details: null };
      }
      return {
        ok: true,
        session: { ...clean, deprecated: true, deprecatedReason: clean.deprecatedReason || "BEARER_DEV_TOKEN_COMPAT" },
      };
    }

    // Prefer v2 access tokens
    const vr2 = await verifyAccessToken(env, bearer);
    if (vr2.ok) {
      const clean = sanitizeSession({
        tenantId: vr2.session.tenantId,
        actorId: vr2.session.actorId,
        authLevel: vr2.session.authLevel,
      });
      if (!clean) {
        return { ok: false, status: 403, error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null };
      }
      return { ok: true, session: clean };
    }

    // Back-compat: allow legacy v1 session tokens (non-prod only)
    if (!prod) {
      const vr1 = await verifySessionToken(env, bearer);
      if (!vr1.ok) {
        return { ok: false, status: 401, error: "UNAUTHORIZED", code: vr1.code || "AUTH_INVALID", details: vr1.details || null };
      }
      const clean = sanitizeSession(vr1.session);
      if (!clean) {
        return { ok: false, status: 403, error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null };
      }
      return { ok: true, session: { ...clean, deprecated: true, deprecatedReason: "LEGACY_V1_TOKEN_NONPROD" } };
    }

    // Prod: fail-closed
    return { ok: false, status: 401, error: "UNAUTHORIZED", code: vr2.code || "AUTH_INVALID", details: vr2.details || null };
  }

  // 2) Transitional dev_token (non-prod only)
  const devToken = getDevTokenFromUrl(request.url);
  if (devToken) {
    if (prod) {
      return { ok: false, status: 401, error: "UNAUTHORIZED", code: "AUTH_REQUIRED", details: null };
    }
    const compatPayload = devTokenToSession(devToken);
    const clean = sanitizeSession(compatPayload);
    if (!clean) {
      return { ok: false, status: 401, error: "UNAUTHORIZED", code: "AUTH_DEV_TOKEN_INVALID", details: null };
    }
    return { ok: true, session: clean };
  }

  return { ok: false, status: 401, error: "UNAUTHORIZED", code: "AUTH_REQUIRED", details: null };
}
