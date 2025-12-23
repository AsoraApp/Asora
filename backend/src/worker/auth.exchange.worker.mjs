// backend/src/worker/auth.exchange.worker.mjs
import { resolveTenantIdpConfig } from "../auth/tenantIdpConfig.worker.mjs";
import { generatePkcePair } from "../auth/oidc.pkce.mjs";

export async function authExchangeFetch(request, env) {
  const { issuer, clientId, redirectUri } = resolveTenantIdpConfig(request, env);

  const { verifier, challenge } = await generatePkcePair();

  const state = crypto.randomUUID();

  const authUrl = new URL(`${issuer}/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid profile email");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `pkce_verifier=${verifier}; HttpOnly; Secure; SameSite=Lax; Path=/`
  );
  headers.append(
    "Set-Cookie",
    `oidc_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/`
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      ...Object.fromEntries(headers),
    },
  });
}
