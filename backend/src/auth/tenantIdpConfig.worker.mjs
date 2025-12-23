// backend/src/auth/tenantIdpConfig.worker.mjs
// Tenant-scoped IdP configuration (multi-IdP from day one).
//
// This file intentionally supports BOTH Entra + Okta in the same deployment.
// Tenants can be mapped to one provider; the core OIDC code is provider-agnostic.
//
// NOTE: For initial controlled launch, OIDC_DEFAULT_TENANT can map users
// who do not have the claim to a tenant (e.g. "demo").
//
// Env variables expected (minimum):
// - OIDC_TENANT_CLAIM (default "tenantId")
// - OIDC_DEFAULT_TENANT (default "demo")
//
// Provider configs (per deployment; tenant chooses which):
// - OIDC_ENTRA_ISSUER
// - OIDC_ENTRA_CLIENT_ID
// - OIDC_ENTRA_REDIRECT_URI
// - (secret) OIDC_ENTRA_CLIENT_SECRET
//
// - OIDC_OKTA_ISSUER
// - OIDC_OKTA_CLIENT_ID
// - OIDC_OKTA_REDIRECT_URI
// - (secret) OIDC_OKTA_CLIENT_SECRET

const KNOWN_PROVIDERS = new Set(["entra", "okta"]);

function s(v) {
  return String(v || "").trim();
}

export function getTenantClaim(env) {
  const v = s(env?.OIDC_TENANT_CLAIM);
  return v || "tenantId";
}

export function getDefaultTenant(env) {
  const v = s(env?.OIDC_DEFAULT_TENANT);
  return v || "demo";
}

function readProviderConfig(env, provider) {
  if (!KNOWN_PROVIDERS.has(provider)) return null;

  const upper = provider.toUpperCase();
  const issuer = s(env?.[`OIDC_${upper}_ISSUER`]);
  const clientId = s(env?.[`OIDC_${upper}_CLIENT_ID`]);
  const redirectUri = s(env?.[`OIDC_${upper}_REDIRECT_URI`]);

  // client secret is stored as Worker Secret, not normal variable
  const clientSecretKey = `OIDC_${upper}_CLIENT_SECRET`;
  const clientSecret = s(env?.[clientSecretKey]);

  if (!issuer || !clientId || !redirectUri) {
    return {
      ok: false,
      code: "OIDC_PROVIDER_CONFIG_MISSING",
      details: { provider, missing: { issuer: !issuer, clientId: !clientId, redirectUri: !redirectUri } },
    };
  }

  if (!clientSecret) {
    return {
      ok: false,
      code: "OIDC_CLIENT_SECRET_MISSING",
      details: { provider, missingSecret: clientSecretKey },
    };
  }

  return {
    ok: true,
    provider,
    issuer,
    clientId,
    clientSecret,
    redirectUri,
  };
}

/**
 * Tenant → provider selection.
 *
 * For now, we support:
 * - explicit query param ?provider=entra|okta (admin/operator chooses)
 * - otherwise default to env OIDC_DEFAULT_PROVIDER (optional), else "entra"
 *
 * This preserves multi-IdP from day one without needing a DB yet.
 * When we add tenant admin config UI, this function becomes storage-backed.
 */
export function resolveProviderForRequest(env, requestUrl) {
  let provider = "entra";
  try {
    const u = new URL(requestUrl);
    const qp = s(u.searchParams.get("provider")).toLowerCase();
    if (qp && KNOWN_PROVIDERS.has(qp)) provider = qp;
  } catch {
    // ignore
  }

  const envDefault = s(env?.OIDC_DEFAULT_PROVIDER).toLowerCase();
  if (envDefault && KNOWN_PROVIDERS.has(envDefault)) provider = envDefault;

  return provider;
}

export function resolveOidcConfig(env, requestUrl) {
  const provider = resolveProviderForRequest(env, requestUrl);
  const cfg = readProviderConfig(env, provider);
  return cfg;
}
