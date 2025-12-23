// backend/src/auth/oidc.decode.mjs
export function decodeJwt(token) {
  const [, payload] = token.split(".");
  return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
}
