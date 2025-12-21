// functions/api/[[path]].js

function trimSlash(s) {
  return String(s || "").replace(/\/+$/g, "");
}

function getWorkerOrigin(env) {
  // Optional: set in Cloudflare Pages env vars (recommended)
  // Example: ASORA_WORKER_ORIGIN = https://asora-ui.dblair1027.workers.dev
  const fromEnv = env?.ASORA_WORKER_ORIGIN || env?.WORKER_ORIGIN || "";
  if (fromEnv) return trimSlash(fromEnv);

  // Default fallback (your current Worker dev URL)
  return "https://asora-ui.dblair1027.workers.dev";
}

function withNoStore(headers) {
  const h = new Headers(headers);
  h.set("Cache-Control", "no-store");
  return h;
}

export async function onRequest(context) {
  const { request, env } = context;

  const url = new URL(request.url);

  // Incoming:  /api/<anything>
  // Target:    <workerOrigin>/<anything>
  const workerOrigin = getWorkerOrigin(env);

  // Remove "/api" prefix
  const apiPrefix = "/api";
  let restPath = url.pathname.startsWith(apiPrefix) ? url.pathname.slice(apiPrefix.length) : url.pathname;
  if (!restPath.startsWith("/")) restPath = `/${restPath}`;

  const targetUrl = new URL(workerOrigin);
  targetUrl.pathname = restPath;
  targetUrl.search = url.search;

  // Handle preflight defensively (same-origin reduces this, but keep enterprise-safe)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: withNoStore({
        "Access-Control-Allow-Origin": url.origin,
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "Authorization,Content-Type",
        "Access-Control-Max-Age": "86400",
      }),
    });
  }

  // Forward request (method, headers, body)
  const forwardHeaders = new Headers(request.headers);

  // Ensure Host header does not break upstream
  forwardHeaders.delete("host");

  const init = {
    method: request.method,
    headers: forwardHeaders,
    redirect: "manual",
  };

  // Only attach body for methods that can have it
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const upstream = await fetch(targetUrl.toString(), init);

  // Pass through response with minimal, safe header handling
  const outHeaders = new Headers(upstream.headers);
  outHeaders.set("Cache-Control", "no-store");

  // CORS headers (safe; does not hurt same-origin, helps if you test cross-origin)
  outHeaders.set("Access-Control-Allow-Origin", url.origin);
  outHeaders.set("Vary", "Origin");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}
