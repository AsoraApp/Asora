// backend/src/auth/oidc.utils.mjs
export function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sha256(input) {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", data);
}
