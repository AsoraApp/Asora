// backend/src/auth/oidc.userinfo.worker.mjs

export async function fetchUserInfo(issuer, accessToken) {
  const res = await fetch(`${issuer}/v1/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error("OIDC_USERINFO_FAILED");
  return res.json();
}
