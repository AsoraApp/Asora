// backend/src/auth/oidc.pkce.mjs

export async function generatePkcePair() {
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);

  const challenge = btoa(
    String.fromCharCode(...new Uint8Array(digest))
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { verifier, challenge };
}
