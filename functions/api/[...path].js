// functions/api/[...path].js
/**
 * ASORA — Cloudflare Pages Functions API Proxy (U14)
 *
 * Purpose:
 * - Provide SAME-ORIGIN /api/* endpoints for the UI (enterprise-safe).
 * - Proxy requests to the Worker origin without CORS.
 *
 * Mapping:
 * - Incoming:  /api/v1/...     -> Upstream: /v1/...
 * - Incoming:  /api/__health   -> Upstream: /__health
 * - Incoming:  /api/__build    -> Upstream: /__build
 * - Incoming:  /api/__meta     -> Upstream: /__meta
 * - Incoming:  /api/auth/...   -> Upstream: /auth/...
 * - Incoming:  /api/* (other)  -> Upstream: /* (after stripping /api)
 *
 * Config:
 * - Optional env var on Pages project: ASORA_API_ORIGIN
 *   e.g. https://asora-ui.dblair1027.workers.dev
 */

function trimSlash(s) {
  return String(s || "").replace(/\/+$/g, "");
}

function getUpstreamOrigin(env) {
  const fromEnv = env?.ASORA_API_ORIGIN ? trimSlash(env.ASORA_API_ORIGIN) : "";
  if (fromEnv) return fromEnv;

  // Default fallback (your current Worker)
  return "https://asora-ui.dblair1027.workers.dev";
}

function mapPath(incomingPathname) {
  // incomingPathname starts with /api/...
  let p = String(incomingPathname || "/");

  if (!p.startsWith("/api")) return p;

  // strip "/api"
  p = p.slice("/api".length) || "/";

  // Normalize specific namespaces to what the Worker serves publicly
  // /v1/* should stay /v1/*
  if (p.startsWith("/v1/") || p === "/v1") return p;

  // /auth/* stays /auth/*
  if (p.startsWith("/auth/") || p === "/auth") return p;

  // /__* stays /__*
  if (p.startsWith("/__")) return p;

  // Otherwise leave as-is (still after /api stripping)
  return p;
}

export async function onRequest(context) {
  const { request, env } = context;

  const upstreamOrigin = getUpstreamOrigin(env);

  const incomingUrl = new URL(request.url);
  const incomingPath = incomingUrl.pathname;

  // Only proxy /api/* (this file should only match /api/* anyway)
  if (!incomingPath.startsWith("/api/")) {
    return new Response("Not Found", { status: 404 });
  }

  const upstreamPath = mapPath(incomingPath);
  const upstreamUrl = new URL(upstreamPath + incomingUrl.search, upstreamOrigin);

  // Clone request to new upstream URL
  const init = {
    method: request.method,
    headers: new Headers(request.headers),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  };

  // Ensure Host is not pinned (fetch will set correctly)
  init.headers.delete("host");

  const upstreamReq = new Request(upstreamUrl.toString(), init);

  const upstreamRes = await fetch(upstreamReq);

  // Pass-through response (no CORS needed; same-origin UI hits Pages, not Worker)
  const outHeaders = new Headers(upstreamRes.headers);
  outHeaders.set("X-Asora-Proxy", "pages-functions");
  outHeaders.set("Cache-Control", "no-store");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: outHeaders,
  });
}
