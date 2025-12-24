// backend/src/auth/oidc.claims.worker.mjs

export function extractIdentityClaims(userinfo, tenantClaim, defaultTenant) {
  return {
    tenantId: userinfo?.[tenantClaim] || defaultTenant,
    actorId: userinfo?.sub || null,
    authLevel: "user",
  };
}
