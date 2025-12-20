// backend/auth/devTokenCompat.worker.mjs
// U10: Transitional compatibility bridge for legacy dev_token.
// Explicitly deprecated. No new features may depend on it.

export function parseDevTokenTenantId(devTokenRaw) {
  const t = String(devTokenRaw || "").trim();
  if (!t) return null;

  // Legacy format observed in project: "tenant:demo"
  // Fail-closed: only accept "tenant:<id>" with non-empty <id>.
  if (!t.startsWith("tenant:")) return null;
  const tenantId = t.slice("tenant:".length).trim();
  if (!tenantId) return null;

  // Optional: tighten allowed charset to avoid injection/ambiguity.
  // Keep conservative but not overly restrictive:
  if (!/^[a-zA-Z0-9._-]+$/.test(tenantId)) return null;

  return tenantId;
}

export function devTokenToSession(devTokenRaw) {
  const tenantId = parseDevTokenTenantId(devTokenRaw);
  if (!tenantId) return null;

  // actorId is explicitly labeled as compat/deprecated.
  return {
    v: 1,
    tenantId,
    actorId: "dev_token:compat",
    authLevel: "dev",
    iat: 0,
    exp: 9999999999, // compatibility path does not expire; it remains deprecated.
    deprecated: true,
    deprecatedReason: "dev_token_compat_bridge",
  };
}
