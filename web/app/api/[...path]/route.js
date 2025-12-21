// web/app/api/[...path]/route.js
//
// Next.js App Router API proxy for Asora.
// This is the correct approach when using @cloudflare/next-on-pages.
//
// Routes handled:
//   /api/__build
//   /api/__health
//   /api/__meta
//   /api/v1/*
//   /api/* (fallback)
//
// Upstream:
//   process.env.ASORA_WORKER_ORIGIN (recommended, server-only)
// Fallbacks:
//   process.env.NEXT_PUBLIC_ASORA_API_BASE (if you already set it)
//   https://asora-ui.dblair1027.workers.dev (last resort)
export const runtime = "edge";

function getUpstreamOrigin() {
  const fromServer = process.env.ASORA_WORKER_ORIGIN || "";
  if (fromServer) return trimSlash(fromServer);

  const fromPublic = process.env.NEXT_PUBLIC_ASORA_API_BASE || "";
  if (fromPublic) return trimSlash(fromPublic);

  return "https://asora-ui.dblair1027.workers.dev";
}

function trimSlash(s) {
  return String(s || "").replace(/\/+$/g, "");
}

function normalizeJoin(origin, path) {
  const o = trimSlash(origin);
  const p = String(path || "");
  if (!p.startsWith("/")) return `${o}/${p}`;
  return `${o}${p}`;
}

async function proxy(request, { params }) {
  const upstreamOrigin = getUpstreamOrigin();

  // Next gives params.path as array of segments (catch-all)
  const segments = Array.isArray(params?.path) ? params.path : [];
  const forwardPath = "/" + segments.map((s) => encodeURIComponent(String(s))).join("/");

  const inUrl = new URL(request.url);

  // We proxy "/api/<...>" to "/<...>" on the Worker (strip "/api")
  // Example: /api/v1/ledger/events -> /v1/ledger/events
  const upstreamUrl = new URL(upstreamOrigin);
  upstreamUrl.pathname = forwardPath;     // already stripped of /api because this handler *is* /api/*
  upstreamUrl.search = inUrl.search;      // preserve query string

  const headers = new Headers(request.headers);

  // Remove headers that should not be forwarded
  headers.delete("host");
  headers.delete("content-length");

  const method = request.method.toUpperCase();

  const init = {
    method,
    headers,
    redirect: "manual",
  };

  // Only attach body for non-GET/HEAD
  if (method !== "GET" && method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  let res;
  try {
    res = await fetch(upstreamUrl.toString(), init);
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: "BAD_GATEWAY",
        code: "UPSTREAM_FETCH_FAILED",
        details: { message: String(e?.message || e) },
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  const outHeaders = new Headers(res.headers);
  outHeaders.set("Cache-Control", "no-store");
  outHeaders.set("X-Asora-Proxy", "next-on-pages");

  return new Response(res.body, { status: res.status, headers: outHeaders });
}

export async function GET(request, context) {
  return proxy(request, context);
}

export async function POST(request, context) {
  return proxy(request, context);
}

export async function PUT(request, context) {
  return proxy(request, context);
}

export async function PATCH(request, context) {
  return proxy(request, context);
}

export async function DELETE(request, context) {
  return proxy(request, context);
}

export async function OPTIONS(request) {
  // Let upstream decide; but avoid Next.js 404 on OPTIONS
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
