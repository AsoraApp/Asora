// web/app/api/[...path]/route.js
export const runtime = "edge";

// Hard target: your backend Worker origin (NOT Pages).
// Keep this as a single source of truth for the proxy.
const WORKER_ORIGIN = "https://asora-ui.dblair1027.workers.dev";

function json(status, body, extraHeaders) {
  const h = new Headers(extraHeaders || {});
  h.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: h });
}

/**
 * Incoming requests are same-origin:
 *   https://asora.pages.dev/api/<...>
 *
 * We forward them to the backend Worker:
 *   https://asora-ui.dblair1027.workers.dev/<...>
 *
 * IMPORTANT:
 * - We strip the leading "/api" prefix.
 * - Query string is preserved.
 * - Authorization header is forwarded (Bearer support).
 * - dev_token query param is forwarded (legacy support).
 */
function buildUpstreamUrl(req, params) {
  const url = new URL(req.url);

  const rest = Array.isArray(params?.path) ? params.path.join("/") : String(params?.path || "");
  // Strip "/api" by construction; this handler is mounted at /api/* already.
  // So upstream path becomes "/<rest>".
  const upstream = new URL(`/${rest}`, WORKER_ORIGIN);

  // Preserve query string exactly
  upstream.search = url.search;

  return upstream;
}

function filterRequestHeaders(req) {
  const h = new Headers();

  // Forward auth if present
  const auth = req.headers.get("authorization");
  if (auth) h.set("authorization", auth);

  // Forward content type for POST
  const ct = req.headers.get("content-type");
  if (ct) h.set("content-type", ct);

  // Optional: request id passthrough if you use it
  const rid = req.headers.get("x-request-id");
  if (rid) h.set("x-request-id", rid);

  return h;
}

function filterResponseHeaders(upstreamHeaders) {
  const h = new Headers();

  // Pass through content-type + cache signaling
  const ct = upstreamHeaders.get("content-type");
  if (ct) h.set("content-type", ct);

  const cc = upstreamHeaders.get("cache-control");
  if (cc) h.set("cache-control", cc);

  // Helpful for debugging
  const vary = upstreamHeaders.get("vary");
  if (vary) h.set("vary", vary);

  return h;
}

async function proxy(req, ctx) {
  const upstreamUrl = buildUpstreamUrl(req, ctx?.params);

  const init = {
    method: req.method,
    headers: filterRequestHeaders(req),
    redirect: "manual",
  };

  // Only attach body for methods that can have one
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl.toString(), init);
  } catch (e) {
    return json(502, {
      error: "BAD_GATEWAY",
      code: "UPSTREAM_FETCH_FAILED",
      details: String(e?.message || e),
      upstream: upstreamUrl.toString(),
    });
  }

  const resHeaders = filterResponseHeaders(upstreamRes.headers);

  // Stream body through
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: resHeaders,
  });
}

export async function GET(req, ctx) {
  return proxy(req, ctx);
}

export async function POST(req, ctx) {
  return proxy(req, ctx);
}

// Optional, but helps avoid random preflight failures if the browser ever triggers it.
export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
