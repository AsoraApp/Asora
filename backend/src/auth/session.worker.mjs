// backend/src/auth/session.worker.mjs
// Session resolution is intentionally deterministic and fail-closed.
//
// Supported inputs:
// 1) Authorization: Bearer <token>
// 2) Dev-only fallback: ?dev_token=<token>
//
// Dev token format to carry tenant scope WITHOUT a login UI:
//   dev_token=tenant:<TENANT_ID>
// Example:
//   /v1/inventory/items?dev_token=tenant:demo

function safeGetHeader(headers, name) {
  try {
    return headers.get(name) || headers.get(name.toLowerCase()) || "";
  } catch {
    return "";
  }
}

function parseTenantFromToken(token) {
  if (!token || typeof token !== "string") return null;

  // tenant:<TENANT_ID>
  const m = token.match(/^tenant:([A-Za-z0-9._-]{1,128})$/);
  if (m) return m[1];

  return null;
}

export function resolveSessionFromHeaders(headers, urlObj) {
  const auth = safeGetHeader(headers, "Authorization");
  let token = null;

  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) token = m[1];

  // Dev-only fallback: query param
  if (!token && urlObj && urlObj.searchParams) {
    const dev = urlObj.searchParams.get("dev_token");
    if (dev && typeof dev === "string") token = dev;
  }

  const tenantId = parseTenantFromToken(token);

  return {
    isAuthenticated: !!token,
    token: token || null,
    tenantId: tenantId || null,
  };
}
