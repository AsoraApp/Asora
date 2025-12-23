// backend/src/auth/tenantIdpConfig.worker.mjs

export function resolveTenantIdpConfig(request, env) {
  // Phase 1: single-tenant / single-IdP (expandable to per-tenant map later)
  return {
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: env.OIDC_REDIRECT_URI,
    tenantClaim: env.OIDC_TENANT_CLAIM || "tenantId",
    defaultTenant: env.OIDC_DEFAULT_TENANT || "demo",
  };
}
