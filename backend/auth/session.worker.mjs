// backend/auth/session.worker.mjs
// U10: Session resolution layer. Tenant identity is session-derived only.
// - Primary: Authorization: Bearer <signed token>
// - Transitional (deprecated): dev_token compatibility bridge

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
  // Fail-closed sanity checks to avoid ambiguous tenant resolution.
  if (!session || typeof session !== "object") return null;
  if (!session.tenantId || typeof session.tenantId !== "string") return null;
  if (!session.actorId || typeof session.actorId !== "string") return null;
  if (!session.authLevel || typeof session.authLevel !== "string") return null;

  return {
    tenantId: session.tenantId,
    actorId: session.actorId,
    authLevel: session.authLevel,
    // optional metadata (non-authoritative):
    deprecated: session.deprecated === true,
    deprecatedReason: session.deprecatedReason || null,
  };
}

/**
 * Resolve exactly one tenantId from request headers.
 *
 * Returns:
 *  { ok: true, session }
 *  { ok: false, status, error, code, details }
 */
export async function resolveSessionFromHeaders(req, env) {
  // 1) Primary: Bearer token
  const bearer = getBearerToken(req.headers);
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

  // 2) Transitional: dev_token from query param
  // This keeps U9 UI working unchanged while U10 introduces real auth.
  const devToken = getDevTokenFromUrl(req.url);
  if (devToken) {
    const compat = devTokenToSession(devToken);
    const clean = sanitizeSession(compat);
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
