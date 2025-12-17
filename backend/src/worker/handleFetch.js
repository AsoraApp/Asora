const url = require("url");

const { getOrCreateRequestIdFromHeaders } = require("../observability/requestId.worker");
const { createRequestContext } = require("../domain/requestContext");
const { resolveSessionFromHeaders } = require("../auth/session.worker");
const { emitAudit } = require("../observability/audit");

// Existing domain/handlers you already have (reused)
const { writeLedgerEventFromJson } = require("../worker/ledger.write.worker");
const { alertsFetchRouter } = require("../worker/alerts.worker");
const { notificationsFetchRouter } = require("../worker/notifications.worker");
const { authMeFetch } = require("../worker/auth.worker");

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

function requireAuth(ctx) {
  if (!ctx || !ctx.session || !ctx.session.isAuthenticated) {
    return json(401, { error: "UNAUTHORIZED", code: "AUTH_REQUIRED" });
  }
  if (!ctx.tenantId) {
    return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null });
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

async function handleFetch(request, env, cfctx) {
  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  const requestId = getOrCreateRequestIdFromHeaders(request.headers);
  const session = resolveSessionFromHeaders(request.headers);

  const ctx = createRequestContext({ requestId, session });

  // Add request id header on all responses
  const baseHeaders = { "X-Request-Id": requestId };

  // Request boundary audit (best-effort)
  emitAudit(ctx, {
    eventCategory: "SYSTEM",
    eventType: "HTTP_REQUEST",
    objectType: "http_request",
    objectId: null,
    decision: "SYSTEM",
    reasonCode: "RECEIVED",
    factsSnapshot: { method, path: pathname },
  });

  // Public
  if (pathname === "/api/auth/me") {
    if (method !== "GET") return methodNotAllowed();
    return authMeFetch(ctx, baseHeaders);
  }

  // Auth gate for /api/*
  if (pathname.startsWith("/api/")) {
    const denied = requireAuth(ctx);
    if (denied) {
      denied.headers.set("X-Request-Id", requestId);
      return denied;
    }
  }

  // Ledger write (B3)
  if (pathname === "/api/ledger/events") {
    if (method !== "POST") return methodNotAllowed();
    const body = await readJson(request);
    if (body === "__INVALID_JSON__") return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);
    return writeLedgerEventFromJson(ctx, body, baseHeaders);
  }

  // B10 Alerts
  {
    const r = await alertsFetchRouter(ctx, request, baseHeaders);
    if (r) return r;
  }

  // B10 Notifications
  {
    const r = await notificationsFetchRouter(ctx, request, baseHeaders);
    if (r) return r;
  }

  return notFound();
}

module.exports = { handleFetch };
