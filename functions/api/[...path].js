// functions/api/[...path].js
/**
 * ASORA — Pages Functions API proxy (same-origin -> Worker origin)
 *
 * Goal (U14):
 * - Browser calls:  https://asora.pages.dev/api/...
 * - Pages proxies to Worker: https://asora-ui.dblair1027.workers.dev/api/...
 * - Eliminates CORS entirely for the UI.
 *
 * Env (optional):
 * - ASORA_WORKER_ORIGIN  (recommended) e.g. "https://asora-ui.dblair1027.workers.dev"
 * If not set, falls back to the current Worker origin.
 */

const DEFAULT_WORKER_ORIGIN = "https://asora-ui.dblair1027.workers.dev";

function trimSlash(s) {
  return String(s || "").replace(/\/+$/g, "");
}

function joinPath(parts) {
  return parts
    .filter((p) => p !== undefined && p !== null)
    .map((p) => String(p).replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export async function onRequest(context) {
  const { request, env, params } = context;

  // Params for a Pages catchall route are provided as an array under the param name.
  // With file name "[...path].js" the param key is "path".
  const pathParts = Array.isArray(params?.path) ? params.path : [];
  const url = new URL(request.url);

  // Resolve Worker origin (prefer env var)
  const workerOrigin = trimSlash(env?.ASORA_WORKER_ORIGIN || DEFAULT_WORKER_ORIGIN);

  // Build upstream URL:
  // Incoming: /api/<...>  (handled by this function)
  // Upstream: <workerOrigin>/api/<...>?<search>
  const upstreamPath = joinPath(["api", ...pathParts]);
  const upstreamUrl = `${workerOrigin}/${upstreamPath}${url.search || ""}`;

  // Clone headers and remove hop-by-hop / host-related headers that should not be forwarded as-is
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("keep-alive");
  headers.delete("proxy-authenticate");
  headers.delete("proxy-authorization");
  headers.delete("te");
  headers.delete("trailers");
  headers.delete("transfer-encoding");
  headers.delete("upgrade");

  // Add proxy marker (useful for debugging)
  headers.set("X-Asora-Proxy", "pages-functions");

  // Create upstream request
  const method = (request.method || "GET").toUpperCase();

  // Note: Passing request.body directly is fine in Workers/Pages runtime.
  // For GET/HEAD, body must be null.
  const body = method === "GET" || method === "HEAD" ? null : request.body;

  const upstreamReq = new Request(upstreamUrl, {
    method,
    headers,
    body,
    redirect: "manual",
  });

  const upstreamRes = await fetch(upstreamReq);

  // Return upstream response to the browser (status, headers, and streaming body)
  const resHeaders = new Headers(upstreamRes.headers);
  resHeaders.set("X-Asora-Proxied-By", "pages-functions");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: resHeaders,
  });
}
