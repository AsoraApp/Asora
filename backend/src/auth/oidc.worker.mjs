// backend/src/auth/oidc.worker.mjs
import { generatePkcePair } from "./oidc.pkce.mjs";
import { makeState, parseState } from "./oidc.state.worker.mjs";
import { fetchToken } from "./oidc.tokenFetch.worker.mjs";
import { fetchUserInfo } from "./oidc.userinfo.worker.mjs";
import { extractIdentityClaims } from "./oidc.claims.worker.mjs";
import { resolveTenantIdpConfig } from "./tenantIdpConfig.worker.mjs";

export async function oidcLoginFetch(request, env) {
  const cfg = resolveTenantIdpConfig(request, env);
  const { verifier, challenge } = await generatePkcePair();
  const state = makeState(verifier);

  const u = new URL(`${cfg.issuer}/v1/authorize`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);

  return Response.redirect(u.toString(), 302);
}

export async function oidcCallbackFetch(request, env) {
  const cfg = resolveTenantIdpConfig(request, env);
  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const verifier = parseState(state);

  if (!code || !verifier) {
    return new Response("Invalid OIDC callback", { status: 400 });
  }

  const token = await fetchToken({
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    code,
    redirectUri: cfg.redirectUri,
    verifier,
  });

  const userinfo = await fetchUserInfo(cfg.issuer, token.access_token);
  const identity = extractIdentityClaims(userinfo, cfg.tenantClaim, cfg.defaultTenant);

  // Hand off identity to bootstrap cookie logic
  const payload = btoa(JSON.stringify(identity));
  return Response.redirect(`/auth/callback?identity=${payload}`, 302);
}
