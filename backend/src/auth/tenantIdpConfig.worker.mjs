// backend/src/auth/tenantIdpConfig.worker.mjs
// U20-B1: Tenant-aware OIDC IdP resolution (enterprise-grade, fail-closed)

function extractTenantFromHost(hostname) {
  if (!hostname) return null;
  const parts = hostname.split(".");
  if (parts.length < 3) return null;
  return parts[0]; // subdomain-based tenant
}

export function resolveTenantIdpConfig(request, env) {
  const url = new URL(request.url);
  const tenant =
    extractTenantFromHost(url.hostname) ||
    env.OIDC_DEFAULT_TENANT ||
    null;

  if (!tenant) {
    throw new Error("OIDC_TENANT_NOT_RESOLVED");
  }

  const issuer = env[`OIDC_ISSUER__${tenant}`] || env.OIDC_ISSUER;
  const clientId = env[`OIDC_CLIENT_ID__${tenant}`] || env.OIDC_CLIENT_ID;
  const clientSecret =
    env[`OIDC_CLIENT_SECRET__${tenant}`] || env.OIDC_CLIENT_SECRET;

  if (!issuer || !clientId || !clientSecret) {
    throw new Error("OIDC_CONFIG_INCOMPLETE");
  }

  return {
    tenantId: tenant,
    issuer,
    clientId,
    clientSecret,
    redirectUri: env.OIDC_REDIRECT_URI,
    tenantClaim: env.OIDC_TENANT_CLAIM || "tenantId",
  };
}
