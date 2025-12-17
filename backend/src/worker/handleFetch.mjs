import { getOrCreateRequestIdFromHeaders } from "../observability/requestId.worker.mjs";
import { resolveSessionFromHeaders } from "../auth/session.worker.mjs";
import { createRequestContext } from "../domain/requestContext.mjs";
import { emitAudit } from "../observability/audit.mjs";

import { authMeFetch } from "./auth.worker.mjs";
import { writeLedgerEventFromJson } from "./ledger.write.worker.mjs";
import { alertsFetchRouter } from "./alerts.worker.mjs";
import { notificationsFetchRouter } from "./notifications.worker.mjs";

const BUILD_STAMP = "b10-alerts-2025-12-17T22:30Z"; // change this string on each deploy attempt

function json(statusCode, body, headersObj) {
  const h = new Headers(headersObj || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function parsePath(pathname) {
  return (pathname || "/").replace(/\/+$/g, "") || "/";
}

function methodNotAllowed(baseHeaders) {
  return json(405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED" }, baseHeaders);
}
function notFound(baseHeaders) {
  return json(404, { error: "NOT_FOUND", code: "ROUTE_NOT_FOUND" }, baseHeaders);
}

function requireAuth(ctx, baseHeaders) {
  if (!ctx || !ctx.session || ctx.session.isAuthenticated !== true) {
    return json(401, { error: "UNAUTHORIZED", code: "AUTH_REQUIRED", details: null }, baseHeaders);
  }
  if (!ctx.tenantId) {
    return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);
  }
  return null;
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return "__INVALID_JSON__";
  }
}

export default async function handleFetch(request, env, cfctx) {
  globalThis.__ASORA_ENV__ = env || {};

  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  const requestId = getOrCreateRequestIdFromHeaders(request.headers);
  const session = resolveSessionFromHeaders(request.headers, u);
  const ctx = createRequestContext({ requestId, session });

  const baseHeaders = { "X-Request-Id": requestId };

  // Deterministic deployed-code check (public)
  if (pathname === "/__build") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(200, { ok: true, build: BUILD_STAMP, requestId }, baseHeaders);
  }

  // Root health (public)
  if (pathname === "/") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(200, { ok: true, service: "asora", runtime: "cloudflare-worker", requestId }, baseHeaders);
  }

  emitAudit(ctx, {
    eventCategory: "SYSTEM",
    eventType: "HTTP_REQUEST",
    objectType: "http_request",
    objectId: null,
    decision: "SYSTEM",
    reasonCode: "RECEIVED",
    factsSnapshot: { method, path: pathname }
  });

  // Public
  if (pathname === "/api/auth/me") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return authMeFetch(ctx, baseHeaders);
  }

  // Auth gate
  if (pathname.startsWith("/api/")) {
    const denied = requireAuth(ctx, baseHeaders);
    if (denied) return denied;
  }

  // Ledger write (B3)
  if (pathname === "/api/ledger/events") {
    if (method !== "POST") return methodNotAllowed(baseHeaders);
    const body = await readJson(request);
    if (body === "__INVALID_JSON__") {
      return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);
    }
    return writeLedgerEventFromJson(ctx, body, baseHeaders, cfctx);
  }

  // B10 Alerts
  {
    const r = await alertsFetchRouter(ctx, request, baseHeaders, cfctx);
    if (r) return r;
  }

  // B10 Notifications
  {
    const r = await notificationsFetchRouter(ctx, request, baseHeaders);
    if (r) return r;
  }

  return notFound(baseHeaders);
}
