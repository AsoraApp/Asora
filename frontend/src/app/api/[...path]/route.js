// frontend/src/app/api/[...path]/route.js
export const runtime = "edge";

/**
 * SAME-ORIGIN /api/* proxy to Worker.
 * Proxy only. No business logic.
 *
 * Env required on Pages:
 *  - ASORA_WORKER_ORIGIN  e.g. https://<your-worker-subdomain>.<domain>.workers.dev
 *
 * This handler forwards:
 *  - method
 *  - headers (including Authorization)
 *  - query string
 *  - body for non-GET
 *
 * Fail-closed:
 *  - If ASORA_WORKER_ORIGIN missing -> 503
 */

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function baseUrl() {
  const v = process.env.ASORA_WORKER_ORIGIN || "";
  return String(v).replace(/\/+$/g, "");
}

async function proxy(req) {
  const base = baseUrl();
  if (!base) {
    return json(503, { error: "SERVICE_UNAVAILABLE", code: "WORKER_ORIGIN_MISSING", details: null });
  }

  const url = new URL(req.url);

  // Pages receives /api/<...>. We forward exactly /api/<...> to the Worker.
  const target = `${base}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);

  // Do not forward host-specific hop-by-hop headers.
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  const init = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
  }

  const upstream = await fetch(target, init);
  const outHeaders = new Headers(upstream.headers);
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export async function GET(req) {
  return proxy(req);
}
export async function POST(req) {
  return proxy(req);
}
export async function PUT(req) {
  return proxy(req);
}
export async function PATCH(req) {
  return proxy(req);
}
export async function DELETE(req) {
  return proxy(req);
}
export async function OPTIONS(req) {
  return proxy(req);
}
