// backend/src/worker/auth.callback.worker.mjs
import { issueBootstrapCookie } from "../auth/bootstrapCookie.worker.mjs";

export async function authCallbackFetch(request, env) {
  const u = new URL(request.url);
  const encoded = u.searchParams.get("identity");
  if (!encoded) return new Response("Missing identity", { status: 400 });

  const identity = JSON.parse(atob(encoded));
  const cookie = issueBootstrapCookie(identity, env);

  const h = new Headers();
  h.append("Set-Cookie", cookie);

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/auth/callback",
      ...Object.fromEntries(h),
    },
  });
}
