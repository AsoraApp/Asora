// backend/src/domain/requestContext.mjs
// U13: Deterministic request context.
// - Never derives tenant from raw tokens (avoid ambiguity).
// - Uses authoritative session fields produced by resolveSessionFromHeaders().
// - Fail-closed: no tenantId unless session is authenticated AND tenantId is present.

export function createRequestContext({ requestId, session }) {
  const s = session && typeof session === "object" ? session : null;

  const isAuthenticated = !!(s && s.isAuthenticated === true);

  // Authoritative tenant/actor are provided by auth layer (Bearer or dev_token compat).
  const tenantId =
    isAuthenticated && typeof s.tenantId === "string" && s.tenantId.length > 0 ? s.tenantId : null;

  const actorId =
    isAuthenticated && typeof s.actorId === "string" && s.actorId.length > 0 ? s.actorId : null;

  return {
    requestId: requestId || null,

    // Session (as provided by resolveSessionFromHeaders)
    session: s || {
      isAuthenticated: false,
      token: null,
      tenantId: null,
      actorId: null,
      authLevel: null,
    },

    // Tenant-scoped everywhere (auth-derived only)
    tenantId,

    // Optional identity handle (auth-derived only)
    actorId,
  };
}
