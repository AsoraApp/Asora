// web/functions/api/[...path].js
//
// Asora Pages Function: same-origin API proxy
// Maps:
//   /api/__build                 -> Worker /__build
//   /api/__health                -> Worker /__health
//   /api/__meta                  -> Worker /__meta
//   /api/v1/*                    -> Worker /v1/*
//   /api/* (fallback passthrough)-> Worker /* (rare; keeps flexibility)
//
// Enterprise intent:
// - UI calls same-origin /api/... (no CORS).
// - This function forwards to the Worker service origin.
// - Authorization header is forwarded as-is.

export async function onRequest(context) {
  const { request, env } = context;

  const workerOrigin = (env && env.ASORA_WORKER_ORIGIN) ? String(env.ASORA_WORKER_ORIGIN) : "";
  if (!workerOrigin) {
    return json(500, {
      ok: false,
      error: "MISCONFIGURED",
      code: "ASORA_WORKER_ORIGIN_MISSING",
      details: "Set Pages env var ASORA_WORKER_ORIGIN to your Worker URL.",
    });
  }

  const url = new URL(request.url);

  // url.pathname is like:
  //   /api/__build
  //   /api/v1/ledger/events
  //   /api/v1/inventory/items
  const pathname = url.pathname || "/";

  // Must start with /api/
  if (!pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }

  // Strip "/api" prefix
  //   /api/__build        -> /__build
  //   /api/v1/...         -> /v1/...
  //   /api/anything-else  -> /anything-else
  let forwardPath = pathname.slice("/api".length); // keeps leading "/"
  if (!forwardPath.startsWith("/")) forwardPath = "/" + forwardPath;

  // Build final upstream URL (preserve query string)
  const upstream = new URL(workerOrigin);
  upstream.pathname = normalizeNoDoubleSlash(upstream.pathname, forwardPath);
  upstream.search = url.search;

  // Clone headers, but remove hop-by-hop / origin-specific ones
  const h = new Headers(request.headers);
  h.delete("host");
  h.delete("cf-connecting-ip");
  h.delete("cf-ipcountry");
  h.delete("cf-ray");
  h.delete("x-forwarded-for");
  h.delete("x-forwarded-proto");

  const init = {
    method: request.method,
    headers: h,
    redirect: "manual",
  };

  // Only forward a body for methods that can have one
  if (!isBodylessMethod(request.method)) {
    init.body = request.body;
  }

  let res;
  try {
    res = await fetch(upstream.toString(), init);
  } catch (e) {
    return json(502, {
      ok: false,
      error: "BAD_GATEWAY",
      code: "UPSTREAM_FETCH_FAILED",
      details: { message: String(e?.message || e) },
    });
  }

  // Return response with minimal hardening headers
  const outHeaders = new Headers(res.headers);
  outHeaders.set("Cache-Control", "no-store");
  outHeaders.set("X-Asora-Proxy", "pages");

  return new Response(res.body, {
    status: res.status,
    headers: outHeaders,
  });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isBodylessMethod(method) {
  const m = String(method || "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
}

function normalizeNoDoubleSlash(basePath, addPath) {
  const a = String(basePath || "");
  const b = String(addPath || "");
  if (!a || a === "/") return b;
  if (a.endsWith("/") && b.startsWith("/")) return a.slice(0, -1) + b;
  if (!a.endsWith("/") && !b.startsWith("/")) return a + "/" + b;
  return a + b;
}
