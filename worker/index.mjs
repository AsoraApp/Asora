import { getOrCreateRequestIdFromHeaders } from "../observability/requestId.worker.mjs";
import { createRequestContext } from "../domain/requestContext.mjs";
import { resolveSessionFromHeaders } from "../auth/session.worker.mjs";
import { emitAudit } from "../observability/audit.mjs";

import { writeLedgerEventFromJson } from "./ledger.write.worker.mjs";
import { alertsFetchRouter } from "./alerts.worker.mjs";
import { notificationsFetchRouter } from "./notifications.worker.mjs";
import { authMeFetch } from "./auth.worker.mjs";

function json(statusCode, body, extraHeaders) {
  const h = new Headers(extraHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function parsePath(pathname) {
  return (pathname || "/").replace(/\/+$/g, "") || "/";
}

function methodNotAllowed() {
  return json(405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED" });
}
function notFound() {
  return json(404, { error: "NOT_FOUND", code: "ROUTE_NOT_FOUND" });
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
  // KV binding for storage layer
  globalThis.__ASORA_ENV__ = env || {};

  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  const requestId = getOrCreateRequestIdFromHeaders(request.headers);
  const session = resolveSessionFromHeaders(request.headers);
  const ctx = createRequestContext({ requestId, session });

  const baseHeaders = { "X-Request-Id": requestId };

  emitAudit(ctx, {
    eventCategory: "SYSTEM",
    eventType: "HTTP_REQUEST",
    objectType: "http_request",
    objectId: null,
    decision: "SYSTEM",
    reasonCode: "RECEIVED",
    factsSnapshot: { method, path: pathname }
  });

  if (pathname === "/api/auth/me") {
    if (method !== "GET") return methodNotAllowed();
    return authMeFetch(ctx, baseHeaders);
  }

  if (pathname.startsWith("/api/")) {
    const denied = requireAuth(ctx, baseHeaders);
    if (denied) return denied;
  }

  if (pathname === "/api/ledger/events") {
    if (method !== "POST") return methodNotAllowed();
    const body = await readJson(request);
    if (body === "__INVALID_JSON__") {
      return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);
    }
    return writeLedgerEventFromJson(ctx, body, baseHeaders);
  }

  {
    const r = await alertsFetchRouter(ctx, request, baseHeaders);
    if (r) return r;
  }
  {
    const r = await notificationsFetchRouter(ctx, request, baseHeaders);
    if (r) return r;
  }

  return notFound();
}
