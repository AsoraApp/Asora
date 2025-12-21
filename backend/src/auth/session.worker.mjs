// backend/src/auth/session.worker.mjs
// U10/U13: Session resolution layer.
// - Primary: Authorization: Bearer <signed token>
// - Transitional (deprecated): dev_token query param compatibility bridge
//
// FAIL-CLOSED:
// - No anonymous access.
// - Resolves exactly one tenantId, or returns a deterministic denial.
//
// IMPORTANT:
// - This function is async.
// - Call signature is: resolveSessionFromHeaders(request, env)

import { verifySessionToken } from "./token.worker.mjs";
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

function sanitizeSession(session) {
  if (!session || typeof session !== "object") return null;

  if (!session.tenantId || typeof session.tenantId !== "string") return null;
  if (!session.actorId || typeof session.actorId !== "string") return null;
  if (!session.authLevel || typeof session.authLevel !== "string") return null;

  // Stable shape expected by existing codepaths.
  // Keep token field present for backward compatibility (non-authoritative).
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

/**
 * Resolve session from request headers/url, using env for cryptographic verification.
 *
 * Returns:
 *  { ok: true, session }
 *  { ok: false, status, error, code, details }
 */
export async function resolveSessionFromHeaders(request, env) {
  // Defensive: fail-closed if request shape is not as expected.
  if (!request || !request.headers || typeof request.url !== "string") {
    return {
      ok: false,
      status: 401,
      error: "UNAUTHORIZED",
      code: "AUTH_REQUIRED",
      details: null,
    };
  }

  // 1) Primary: Bearer token
  const bearer = getBearerToken(request.headers);
  if (bearer) {
    const vr = await verifySessionToken(env, bearer);
    if (!vr.ok) {
      return {
        ok: false,
        status: 401,
        error: "UNAUTHORIZED",
        code: vr.code || "AUTH_INVALID",
        details: vr.details || null,
      };
    }

    const clean = sanitizeSession(vr.session);
    if (!clean) {
      return {
        ok: false,
        status: 403,
        error: "FORBIDDEN",
        code: "TENANT_REQUIRED",
        details: null,
      };
    }

    return { ok: true, session: clean };
  }

  // 2) Transitional: dev_token compatibility (deprecated; UI still relies on this)
  const devToken = getDevTokenFromUrl(request.url);
  if (devToken) {
    const compatPayload = devTokenToSession(devToken);
    const clean = sanitizeSession(compatPayload);
    if (!clean) {
      return {
        ok: false,
        status: 401,
        error: "UNAUTHORIZED",
        code: "AUTH_DEV_TOKEN_INVALID",
        details: null,
      };
    }
    return { ok: true, session: clean };
  }

  // 3) No anonymous access
  return {
    ok: false,
    status: 401,
    error: "UNAUTHORIZED",
    code: "AUTH_REQUIRED",
    details: null,
  };
}
