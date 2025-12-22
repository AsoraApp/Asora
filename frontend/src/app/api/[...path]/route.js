export const runtime = "edge";

/**
 * SAME-ORIGIN /api/* proxy to Worker.
 * Proxy only. No business logic.
 *
 * Env required on Pages:
 *  - ASORA_WORKER_BASE_URL  e.g. https://<your-worker-subdomain>.<domain>.workers.dev
 *
 * This handler forwards:
 *  - method
 *  - headers (including Authorization)
 *  - query string
 *  - body for non-GET
 *
 * Fail-closed:
 *  - If ASORA_WORKER_BASE_URL missing -> 503
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

async function proxy(req, ctx) {
  const base = baseUrl();
  if (!base) {
    return json(503, { error: "SERVICE_UNAVAILABLE", code: "WORKER_BASE_URL_MISSING", details: null });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "/api"); // keep /api prefix intact
  const target = `${base}${path}${url.search}`;

  const headers = new Headers(req.headers);

  // Do not leak host-specific headers.
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

  // Return upstream response as-is.
  const outHeaders = new Headers(upstream.headers);
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export async function GET(req, ctx) {
  return proxy(req, ctx);
}
export async function POST(req, ctx) {
  return proxy(req, ctx);
}
export async function PUT(req, ctx) {
  return proxy(req, ctx);
}
export async function PATCH(req, ctx) {
  return proxy(req, ctx);
}
export async function DELETE(req, ctx) {
  return proxy(req, ctx);
}
export async function OPTIONS(req, ctx) {
  return proxy(req, ctx);
}
