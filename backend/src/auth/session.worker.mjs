export function resolveSessionFromHeaders(headers, url) {
  // Primary: Authorization header
  const auth = headers.get("authorization") || headers.get("Authorization") || "";
  let token = null;

  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) token = m[1];

  // Dev-only fallback: query param
  if (!token && url) {
    const dev = url.searchParams.get("dev_token");
    if (dev && typeof dev === "string") {
      token = dev;
    }
  }

  return {
    isAuthenticated: !!token,
    token: token || null
  };
}
