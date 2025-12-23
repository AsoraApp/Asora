// backend/src/worker/auth.callback.worker.mjs
import { resolveTenantIdpConfig } from "../auth/tenantIdpConfig.worker.mjs";

export async function authCallbackFetch(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response("Invalid OIDC callback", { status: 400 });
  }

  const cookies = request.headers.get("Cookie") || "";
  const verifier = cookies.match(/pkce_verifier=([^;]+)/)?.[1];
  const storedState = cookies.match(/oidc_state=([^;]+)/)?.[1];

  if (!verifier || state !== storedState) {
    return new Response("OIDC state mismatch", { status: 403 });
  }

  const { issuer, clientId, clientSecret, redirectUri } =
    resolveTenantIdpConfig(request, env);

  const tokenRes = await fetch(`${issuer}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    return new Response("OIDC token exchange failed", { status: 502 });
  }

  const tokenJson = await tokenRes.json();

  return new Response(JSON.stringify(tokenJson), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
