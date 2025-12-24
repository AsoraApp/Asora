// backend/src/auth/tenantIdpConfig.worker.mjs
//
// U20: Tenant + IdP config resolution for OIDC (provider-agnostic).
//
// HARD REQUIREMENT (from build error):
// - Must export: resolveTenantIdpConfig (named export)
//
// Also provides the helpers referenced in U20 summary:
// - resolveOidcConfig()
// - getTenantClaim()
// - getDefaultTenant()
//
// Provider baseline: Entra + Okta
// Optional third provider (if not overbuild): Auth0
//
// Expected env var patterns (recommended):
//   OIDC_TENANT_CLAIM           (optional) e.g. "tid" | "tenantId" | "groups"
//   OIDC_DEFAULT_TENANT         (optional) default tenantId when claim missing
//
//   OIDC_ENTRA_ISSUER
//   OIDC_ENTRA_CLIENT_ID
//   OIDC_ENTRA_CLIENT_SECRET
//   OIDC_ENTRA_REDIRECT_URI
//
//   OIDC_OKTA_ISSUER
//   OIDC_OKTA_CLIENT_ID
//   OIDC_OKTA_CLIENT_SECRET
//   OIDC_OKTA_REDIRECT_URI
//
//   OIDC_AUTH0_ISSUER
//   OIDC_AUTH0_CLIENT_ID
//   OIDC_AUTH0_CLIENT_SECRET
//   OIDC_AUTH0_REDIRECT_URI
//
// Notes:
// - Fail-closed: missing provider config => throws.
// - We do NOT auto-discover issuer metadata here; oidc.worker.mjs handles OIDC mechanics.

function requiredString(v, name) {
  const s = (v ?? "").toString().trim();
  if (!s) throw new Error(`OIDC config error: missing ${name}`);
  return s;
}

function optionalString(v) {
  const s = (v ?? "").toString().trim();
  return s || null;
}

function normalizeProviderKey(provider) {
  const p = String(provider || "").toLowerCase().trim();
  if (!p) return null;
  // Normalize common aliases.
  if (p === "entra" || p === "azure" || p === "azuread" || p === "microsoft" || p === "microsoftentra") return "entra";
  if (p === "okta") return "okta";
  if (p === "auth0" || p === "auth-0") return "auth0";
  return p; // allow future providers explicitly configured
}

export function getTenantClaim(env) {
  return optionalString(env?.OIDC_TENANT_CLAIM) || "tid";
}

export function getDefaultTenant(env) {
  return optionalString(env?.OIDC_DEFAULT_TENANT) || "demo";
}

/**
 * Resolve the provider config for a given provider key.
 * This is provider-agnostic and purely env-driven.
 */
export function resolveOidcConfig(providerKey, env) {
  const key = normalizeProviderKey(providerKey);
  if (!key) throw new Error("OIDC config error: provider is required");

  const tenantClaim = getTenantClaim(env);
  const defaultTenantId = getDefaultTenant(env);

  if (key === "entra") {
    return {
      provider: "entra",
      issuer: requiredString(env?.OIDC_ENTRA_ISSUER, "OIDC_ENTRA_ISSUER"),
      clientId: requiredString(env?.OIDC_ENTRA_CLIENT_ID, "OIDC_ENTRA_CLIENT_ID"),
      clientSecret: requiredString(env?.OIDC_ENTRA_CLIENT_SECRET, "OIDC_ENTRA_CLIENT_SECRET"),
      redirectUri: requiredString(env?.OIDC_ENTRA_REDIRECT_URI, "OIDC_ENTRA_REDIRECT_URI"),
      tenantClaim,
      defaultTenantId,
    };
  }

  if (key === "okta") {
    return {
      provider: "okta",
      issuer: requiredString(env?.OIDC_OKTA_ISSUER, "OIDC_OKTA_ISSUER"),
      clientId: requiredString(env?.OIDC_OKTA_CLIENT_ID, "OIDC_OKTA_CLIENT_ID"),
      clientSecret: requiredString(env?.OIDC_OKTA_CLIENT_SECRET, "OIDC_OKTA_CLIENT_SECRET"),
      redirectUri: requiredString(env?.OIDC_OKTA_REDIRECT_URI, "OIDC_OKTA_REDIRECT_URI"),
      tenantClaim,
      defaultTenantId,
    };
  }

  if (key === "auth0") {
    return {
      provider: "auth0",
      issuer: requiredString(env?.OIDC_AUTH0_ISSUER, "OIDC_AUTH0_ISSUER"),
      clientId: requiredString(env?.OIDC_AUTH0_CLIENT_ID, "OIDC_AUTH0_CLIENT_ID"),
      clientSecret: requiredString(env?.OIDC_AUTH0_CLIENT_SECRET, "OIDC_AUTH0_CLIENT_SECRET"),
      redirectUri: requiredString(env?.OIDC_AUTH0_REDIRECT_URI, "OIDC_AUTH0_REDIRECT_URI"),
      tenantClaim,
      defaultTenantId,
    };
  }

  // Generic provider support (enterprise-first posture, but explicit env required).
  // Allows future providers without refactors; still fail-closed.
  const upper = key.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return {
    provider: key,
    issuer: requiredString(env?.[`OIDC_${upper}_ISSUER`], `OIDC_${upper}_ISSUER`),
    clientId: requiredString(env?.[`OIDC_${upper}_CLIENT_ID`], `OIDC_${upper}_CLIENT_ID`),
    clientSecret: requiredString(env?.[`OIDC_${upper}_CLIENT_SECRET`], `OIDC_${upper}_CLIENT_SECRET`),
    redirectUri: requiredString(env?.[`OIDC_${upper}_REDIRECT_URI`], `OIDC_${upper}_REDIRECT_URI`),
    tenantClaim,
    defaultTenantId,
  };
}

/**
 * REQUIRED NAMED EXPORT (fixes your build error):
 * oidc.worker.mjs imports { resolveTenantIdpConfig } from "./tenantIdpConfig.worker.mjs"
 *
 * Contract:
 * - providerKey is required.
 * - tenantId is currently not used for env lookup (single app, multi-tenant runtime),
 *   but is retained to support per-tenant overrides later without breaking call sites.
 */
export function resolveTenantIdpConfig({ tenantId, providerKey, env }) {
  // tenantId retained for future enterprise overrides (per-tenant IdP routing)
  // without changing call signature across the codebase.
  void tenantId;
  return resolveOidcConfig(providerKey, env);
}
