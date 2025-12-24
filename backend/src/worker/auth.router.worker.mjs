// backend/src/worker/auth.router.worker.mjs
import { authExchangeFetch } from "./auth.exchange.worker.mjs";
import { authCallbackFetch } from "./auth.callback.worker.mjs";

export async function authRouterFetch(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/auth/login") {
    return authExchangeFetch(request, env);
  }

  if (url.pathname === "/auth/callback") {
    return authCallbackFetch(request, env);
  }

  return new Response("Not Found", { status: 404 });
}
