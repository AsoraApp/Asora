/**
 * Deterministic MVP tenant resolution.
 * Token formats:
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
  for
