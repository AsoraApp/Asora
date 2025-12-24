// backend/src/auth/oidc.claims.mjs
export function extractTenantClaim(idTokenPayload, claimName) {
  return idTokenPayload?.[claimName] || null;
}
