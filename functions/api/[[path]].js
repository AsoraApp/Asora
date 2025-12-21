// functions/api/[[path]].js
/**
 * Cloudflare Pages Function: /api/* proxy -> Asora Worker
 *
 * Purpose:
 * - Make UI calls same-origin (https://asora.pages.dev/api/...) to avoid CORS issues.
 * - Forward method, headers, and body to the Worker origin.
 *
 * Configure (recommended):
 * - In Cloudflare Pages project env vars, set:
 *     ASORA_WORKER_ORIGIN = https://asora-ui.dblair1027.workers.dev
 *
 * If not set, this file falls back to that origin by default.
 */

const DEFAULT_ORIGIN = "https://asora-ui.dblair1027.workers.dev";

function getWorkerOrigin(env) {
  const v = (env?.ASORA_WORKER_ORIGIN || "").trim();
  return v || DEFAULT_ORIGIN;
}

function stripHopByHopHeaders(headers) {
  // Hop-by-hop headers should not be forwarded.
  const h = new Headers(headers);
  h.delete("connection");
  h.delete("keep-alive");
  h.delete("proxy-authenticate");
  h.delete("proxy-authorization");
  h.delete("te");
  h.delete("trailers");
  h.delete("transfer-encoding");
  h.delete("upgrade");
  // Host is set by fetch automatically.
  h.delete("host");
  return h;
}

export async function onRequest(context) {
  const { request, env } = context;

  const workerOrigin = getWorkerOrigin(env);

  const inUrl = new URL(request.url);

  // Incoming:  /api/<rest>
  // Forward to: <workerOrigin>/api/<rest>
  const target = new URL(inUrl.pathname + inUrl.search, workerOrigin);

  // Forward request as-is (method/body), with safe header handling.
  const method = (request.method || "GET").toUpperCase();
  const headers = stripHopByHopHeaders(request.headers);

  // Deterministic: do not cache at the edge.
  headers.set("Cache-Control", "no-store");

  // Body: only forward for methods that may contain one.
  const hasBody = !["GET", "HEAD"].includes(method);
  const init = {
    method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  };

  const res = await fetch(target.toString(), init);

  // Return response, but also ensure no caching on the Pages edge.
  const outHeaders = stripHopByHopHeaders(res.headers);
  outHeaders.set("Cache-Control", "no-store");

  return new Response(res.body, {
    status: res.status,
    headers: outHeaders,
  });
}
