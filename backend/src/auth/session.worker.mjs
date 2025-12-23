// backend/src/auth/session.worker.mjs
// U10/U13/U16/U20: Session resolution layer.
// - Primary: Authorization: Bearer <signed token>
// - Transitional (deprecated): dev_token compatibility bridge (U20: gated by ALLOW_DEV_TOKEN)
//
// FAIL-CLOSED:
// - No anonymous access.
// - Resolves exactly one tenantId, or returns a deterministic denial.

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

// Current known dev token format: "tenant:<tenantId>"
function isDevTokenLike(v) {
  if (!v || typeof v !== "string") return false;
  const s = v.trim();
  return /^tenant:[A-Za-z0-9._-]+$/.test(s);
}

function allowDevToken(env) {
  const v = String(env?.ALLOW_DEV_TOKEN || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
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

  // 1) Primary: Bearer token
  const bearer = getBearerToken(request.headers);
  if (bearer) {
    // Dev-token-in-bearer compatibility is now gated
    if (isDevTokenLike(bearer)) {
      if (!allowDevToken(env)) {
        return { ok: false, status: 401, error: "UNAUTHORIZED", code: "AUTH_DEV_TOKEN_DISABLED", details: null };
      }
      const compatPayload = devTokenToSession(bearer);
      const clean = sanitizeSession(compatPayload);
      if (!clean) return { ok: false, status: 401, error: "UNAUTHORIZED", code: "AUTH_DEV_TOKEN_INVALID", details: null };
      return {
        ok: true,
        session: { ...clean, deprecated: true, deprecatedReason: clean.deprecatedReason || "BEARER_DEV_TOKEN_COMPAT" },
      };
    }

    const vr = await verifySessionToken(env, bearer);
    if (!vr.ok) {
      return { ok: false, status: 401, error: "UNAUTHORIZED", code: vr.code || "AUTH_INVALID", details: vr.details || null };
    }

    const clean = sanitizeSession(vr.session);
    if (!clean) return { ok: false, status: 403, error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null };
    return { ok: true, session: clean };
  }

  // 2) Transitional: dev_token query param (gated)
  const devToken = getDevTokenFromUrl(request.url);
  if (devToken) {
    if (!allowDevToken(env)) {
      return { ok: false, status: 401, error: "UNAUTHORIZED", code: "AUTH_DEV_TOKEN_DISABLED", details: null };
    }
    const compatPayload = devTokenToSession(devToken);
    const clean = sanitizeSession(compatPayload);
    if (!clean) return { ok: false, status: 401, error: "UNAUTHORIZED", code: "AUTH_DEV_TOKEN_INVALID", details: null };
    return { ok: true, session: clean };
  }

  // 3) No anonymous access
  return { ok: false, status: 401, error: "UNAUTHORIZED", code: "AUTH_REQUIRED", details: null };
}
