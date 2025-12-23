// backend/src/auth/oidc.pkce.mjs
import { base64UrlEncode, sha256 } from "./oidc.utils.mjs";

export async function generatePkcePair() {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64UrlEncode(await sha256(verifier));
  return { verifier, challenge };
}
