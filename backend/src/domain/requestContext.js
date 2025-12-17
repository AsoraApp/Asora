/**
 * Canonical request context constructor.
 *
 * Responsibilities:
 * - Deterministically derive tenant + user from session
 * - Fail-closed if tenant cannot be resolved
 * - Be runtime-agnostic (Node / Worker safe)
 *
 * Session shape (minimum):
 * {
 *   isAuthenticated: boolean
 *   token: string | null
 * }
 */

function createRequestContext({ requestId, session }) {
  const ctx = {
    requestId: requestId || null,
    session: session || null,
    tenantId: null,
    userId: null
  };

  if (!session || session.isAuthenticated !== true) {
    return ctx; // unauthenticated context
  }

  // ---- DEV / MVP TOKEN FORMAT ----
  // Accept simple deterministic tokens:
  //   tenant:<tenantId>
  //   tenant:<tenantId>|user:<userId>
  //
  // Examples:
  //   Authorization: Bearer tenant:demo
  //   Authorization: Bearer tenant:acme|user:admin
  //
  const token = session.token;
  if (typeof token !== "string") {
    return ctx;
  }

  const parts = token.split("|");
  for (const p of parts) {
    if (p.startsWith("tenant:")) {
      ctx.tenantId = p.slice("tenant:".length);
    }
    if (p.startsWith("user:")) {
      ctx.userId = p.slice("user:".length);
    }
  }

  return ctx;
}

module.exports = { createRequestContext };
