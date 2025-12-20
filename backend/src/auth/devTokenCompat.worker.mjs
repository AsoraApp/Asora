// backend/src/auth/devTokenCompat.worker.mjs
// U10: Transitional compatibility bridge for legacy dev_token.
// Explicitly deprecated. No new features may depend on it.

export function parseDevTokenTenantId(devTokenRaw) {
  const t = String(devTokenRaw || "").trim();
  if (!t) return null;

  // Legacy format: "tenant:<id>"
  if (!t.startsWith("tenant:")) return null;
  const tenantId = t.slice("tenant:".length).trim();
  if (!tenantId) return null;

  // Conservative allow-list to avoid ambiguity/injection.
  if (!/^[a-zA-Z0-9._-]+$/.test(tenantId)) return null;

  return tenantId;
}

export function devTokenToSession(devTokenRaw) {
  const tenantId = parseDevTokenTenantId(devTokenRaw);
  if (!tenantId) return null;

  return {
    v: 1,
    tenantId,
    actorId: "dev_token:compat",
    authLevel: "dev",
    iat: 0,
    exp: 9999999999,
    deprecated: true,
    deprecatedReason: "dev_token_compat_bridge",
  };
}
