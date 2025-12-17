/**
 * Minimal header-based session resolver for Worker runtime.
 * Mirrors your existing dev pattern: Authorization: Bearer <token>
 * Token value is passed through; tenant/user resolution stays in requestContext logic.
 */
function resolveSessionFromHeaders(headers) {
  const auth = headers.get("authorization") || headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : null;

  return {
    isAuthenticated: !!token,
    token: token || null,
  };
}

module.exports = { resolveSessionFromHeaders };
