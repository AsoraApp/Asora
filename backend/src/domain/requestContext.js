/**
 * Deterministic, fail-closed tenant resolution for MVP.
 *
 * Token formats accepted:
 * - tenant:<tenantId>
 * - tenant:<tenantId>|user:<userId>
 */
export function createRequestContext({ requestId, session }) {
  const ctx = {
    requestId: requestId || null,
    session: session || null,
    tenantId: null,
    userId: null
  };

  if (!session || session.isAuthenticated !== true) return ctx;
  const token = session.token;
  if (typeof token !== "string") return ctx;

  const parts = token.split("|");
  for (const p of parts) {
    if (p.startsWith("tenant:")) ctx.tenantId = p.slice("tenant:".length);
    if (p.startsWith("user:")) ctx.userId = p.slice("user:".length);
  }

  return ctx;
}
