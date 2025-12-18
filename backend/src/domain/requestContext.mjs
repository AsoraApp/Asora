// backend/src/domain/requestContext.mjs

function fnv1a32(str) {
  // Deterministic, sync hash (no crypto.subtle needed)
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function deriveTenantIdFromToken(token) {
  if (!token || typeof token !== "string") return null;
  const hex = fnv1a32(token).toString(16).padStart(8, "0");
  return `t_${hex}`;
}

function deriveActorIdFromToken(token) {
  if (!token || typeof token !== "string") return null;
  const hex = fnv1a32(`actor:${token}`).toString(16).padStart(8, "0");
  return `u_${hex}`;
}

export function createRequestContext({ requestId, session }) {
  const token = session && typeof session === "object" ? session.token : null;
  const isAuthenticated = !!(session && session.isAuthenticated === true && token);

  const tenantId = isAuthenticated ? deriveTenantIdFromToken(token) : null;
  const actorId = isAuthenticated ? deriveActorIdFromToken(token) : null;

  return {
    requestId: requestId || null,

    // Session (as provided by resolveSessionFromHeaders)
    session: session || { isAuthenticated: false, token: null },

    // Tenant-scoped everywhere (session-derived only)
    tenantId,

    // Optional identity handle (session-derived only)
    actorId,
  };
}
