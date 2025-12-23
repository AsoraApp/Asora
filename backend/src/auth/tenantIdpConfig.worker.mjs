// backend/src/auth/tenantIdpConfig.worker.mjs
// U20: OIDC provider + tenant resolution (Option A: external enterprise IdP required)
//
// Provider-agnostic contract consumed by oidc.worker.mjs:
// - resolveOidcConfig(env, requestUrl) -> { ok:true, provider, issuer, clientId, clientSecret, redirectUri }
// - getTenantClaim(env) -> claim name string
// - getDefaultTenant(env) -> fallback tenant string (only used if claim missing)
//
// Selection rules:
// - provider is chosen via ?provider=entra|okta on /api/auth/login and /api/auth/callback
// - fail-closed: any missing config -> { ok:false, code, details }

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s || null;
}

function normalizeProvider(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "entra" || s === "azure" || s === "azuread" || s === "microsoft") return "entra";
  if (s === "okta") return "okta";
  return null;
}

function parseProviderFromUrl(requestUrl) {
  try {
    const u = new URL(String(requestUrl || ""));
    return normalizeProvider(u.searchParams.get("provider"));
  } catch {
    return null;
  }
}

function originFromUrl(requestUrl) {
  try {
    const u = new URL(String(requestUrl || ""));
    return u.origin;
  } catch {
    return null;
  }
}

function must(value, code, details) {
  if (value) return { ok: true, value };
  return { ok: false, code, details: details || null };
}

function providerConfig(env, provider) {
  if (provider === "entra") {
    return {
      provider: "entra",
      issuer: safeStr(env?.OIDC_ENTRA_ISSUER),
      clientId: safeStr(env?.OIDC_ENTRA_CLIENT_ID),
      clientSecret: safeStr(env?.OIDC_ENTRA_CLIENT_SECRET),
    };
  }
  if (provider === "okta") {
    return {
      provider: "okta",
      issuer: safeStr(env?.OIDC_OKTA_ISSUER),
      clientId: safeStr(env?.OIDC_OKTA_CLIENT_ID),
      clientSecret: safeStr(env?.OIDC_OKTA_CLIENT_SECRET),
    };
  }
  return null;
}

export function getTenantClaim(env) {
  // Default: "tenantId" (Option A: enterprise IdP should emit this via claim mapping)
  return safeStr(env?.OIDC_TENANT_CLAIM) || "tenantId";
}

export function getDefaultTenant(env) {
  // Default fallback ONLY if claim missing. Keep deterministic.
  return safeStr(env?.OIDC_DEFAULT_TENANT) || "demo";
}

export function resolveOidcConfig(env, requestUrl) {
  const provider = parseProviderFromUrl(requestUrl) || normalizeProvider(env?.OIDC_DEFAULT_PROVIDER) || null;
  if (!provider) {
    return { ok: false, code: "OIDC_PROVIDER_REQUIRED", details: { expected: ["entra", "okta"] } };
  }

  const pc = providerConfig(env, provider);
  if (!pc) return { ok: false, code: "OIDC_PROVIDER_INVALID", details: { provider } };

  const o = originFromUrl(requestUrl);
  if (!o) return { ok: false, code: "OIDC_REQUEST_URL_INVALID", details: null };

  // Redirect URI must be on the Worker origin because the browser is sent to Worker /api/auth/callback.
  // Pages proxies /api/* to Worker, so redirectUri must match *public Worker origin*.
  // In practice this should be set explicitly; but we can safely derive from request origin.
  const redirectUri = `${o}/api/auth/callback`;

  const i = must(pc.issuer, "OIDC_ISSUER_MISSING", { provider });
  if (!i.ok) return i;

  const c1 = must(pc.clientId, "OIDC_CLIENT_ID_MISSING", { provider });
  if (!c1.ok) return c1;

  const c2 = must(pc.clientSecret, "OIDC_CLIENT_SECRET_MISSING", { provider });
  if (!c2.ok) return c2;

  return {
    ok: true,
    provider,
    issuer: pc.issuer,
    clientId: pc.clientId,
    clientSecret: pc.clientSecret,
    redirectUri,
  };
}
