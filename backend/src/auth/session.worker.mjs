export function resolveSessionFromHeaders(headers) {
  const auth = headers.get("authorization") || headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : null;

  return { isAuthenticated: !!token, token: token || null };
}
