// backend/src/domain/requestContext.mjs
// U13: Request context must be derived from the authoritative resolved session.
// - No token hashing
// - No randomness
// - Deterministic, stable shape
// - Fail-closed when session lacks required fields

export function createRequestContext({ requestId, session }) {
  const s = session && typeof session === "object" ? session : null;

  const isAuthenticated = s?.isAuthenticated === true;
  const tenantId = isAuthenticated && typeof s?.tenantId === "string" && s.tenantId ? s.tenantId : null;
  const actorId = isAuthenticated && typeof s?.actorId === "string" && s.actorId ? s.actorId : null;

  return {
    requestId: requestId || null,

    // Session (as provided by resolveSessionFromHeaders)
    session: s || { isAuthenticated: false, token: null, tenantId: null, actorId: null, authLevel: null },

    // Tenant-scoped everywhere (session-derived only)
    tenantId,

    // Optional identity handle (session-derived only)
    actorId,
  };
}
