// backend/src/auth/oidc.tokenFetch.worker.mjs

export async function fetchToken({ issuer, clientId, clientSecret, code, redirectUri, verifier }) {
  const res = await fetch(`${issuer}/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) throw new Error("OIDC_TOKEN_EXCHANGE_FAILED");
  return res.json();
}
