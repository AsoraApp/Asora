// backend/src/server.js
"use strict";

const http = require("http");
const url = require("url");

const { getOrCreateRequestId } = require("./observability/requestId");
const { createRequestContext } = require("./domain/requestContext");
const { emitAudit } = require("./observability/audit");

const { requireAuth } = require("./auth/requireAuth");
const { resolveSession } = require("./auth/session");

const { badRequest, forbidden, notFound, methodNotAllowed } = require("./api/_errors");
const { handleAuthMe } = require("./api/auth");

// Routers (existing)
const inventoryRouter = require("./api/inventory");
const vendorsRouter = require("./api/vendors");
const complianceRouter = require("./api/compliance");
const { writeLedgerEventHttp } = require("./ledger/write");

const rejectTenantOverride = require("./middleware/rejectTenantOverride");

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve("__INVALID_JSON__");
      }
    });
  });
}

function makeCtx(req, requestId, session) {
  const parsed = url.parse(req.url || "/", true);
  const path = parsed.pathname || "/";
  return createRequestContext({
    requestId,
    method: req.method || "GET",
    path,
    tenantId: session && session.tenantId ? String(session.tenantId) : null, // session-derived only
    actor: session && session.actor ? session.actor : null,
  });
}

function isApiPath(pathname) {
  return typeof pathname === "string" && pathname.startsWith("/api/");
}

function safeCall(handler, req, res, ctx) {
  try {
    return handler(req, res, ctx);
  } catch {
    emitAudit(ctx, "server.handler_exception", { ok: false, status: 500, code: "HANDLER_EXCEPTION" }, null);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "INTERNAL", code: "INTERNAL_ERROR", details: null }));
  }
}

function canonicalApiNotFound(req, res, ctx) {
  notFound(res, "ROUTE_NOT_FOUND", null);

  // Audit 404 only when authenticated + tenant-scoped
  if (ctx && ctx.tenantId && ctx.actor && ctx.actor.type !== "unknown") {
    emitAudit(ctx, "route.not_found", { ok: false, status: 404, code: "ROUTE_NOT_FOUND" }, null);
  }
}

function canonicalMethodNotAllowed(req, res, ctx) {
  methodNotAllowed(res, "METHOD_NOT_ALLOWED", null);

  // Audit 405 only when authenticated + tenant-scoped
  if (ctx && ctx.tenantId && ctx.actor && ctx.actor.type !== "unknown") {
    emitAudit(ctx, "route.method_not_allowed", { ok: false, status: 405, code: "METHOD_NOT_ALLOWED" }, null);
  }
}

function routeAuthed(req, res, ctx, body) {
  const parsed = url.parse(req.url || "/", true);
  const pathname = parsed.pathname || "/";

  // GET /api/auth/me
  if (pathname === "/api/auth/me") {
    if (req.method !== "GET") return canonicalMethodNotAllowed(req, res, ctx);
    return safeCall(handleAuthMe, req, res, ctx);
  }

  if (pathname.startsWith("/api/inventory")) return safeCall(inventoryRouter, req, res, ctx);

  if (pathname === "/api/ledger/events") {
    if (req.method !== "POST") return canonicalMethodNotAllowed(req, res, ctx);
    req.body = body;
    return safeCall(writeLedgerEventHttp, req, res, ctx);
  }

  if (pathname.startsWith("/api/vendors")) return safeCall(vendorsRouter, req, res, ctx);

  if (pathname.startsWith("/api/compliance")) return safeCall(complianceRouter, req, res, ctx);

  return canonicalApiNotFound(req, res, ctx);
}

const server = http.createServer(async (req, res) => {
  const requestId = getOrCreateRequestId(req, res);

  // Fail-closed tenant override rejection (pre-auth)
  if (rejectTenantOverride(req, res)) {
    const session = resolveSession(req);
    const ctx = makeCtx(req, requestId, session);
    emitAudit(ctx, "auth.tenant_override_rejected", { ok: false, status: 403, code: "TENANT_OVERRIDE_REJECTED" }, null);
    return;
  }

  const parsed = url.parse(req.url || "/", true);
  const pathname = parsed.pathname || "/";

  // Non-API: deterministic 404
  if (!isApiPath(pathname)) {
    return notFound(res, "ROUTE_NOT_FOUND", null);
  }

  // Parse body (needed for INVALID_JSON check)
  const body = await readJsonBody(req);
  if (body === "__INVALID_JSON__") {
    const session = resolveSession(req);
    const ctx = makeCtx(req, requestId, session);
    badRequest(res, "INVALID_JSON", null);
    if (ctx && ctx.tenantId && ctx.actor && ctx.actor.type !== "unknown") {
      emitAudit(ctx, "request.invalid_json", { ok: false, status: 400, code: "INVALID_JSON" }, null);
    }
    return;
  }

  // Method tightening for /api/auth/me even when unauthenticated (deterministic 405)
  // (This fixes your observed #3 behavior.)
  if (pathname === "/api/auth/me" && req.method !== "GET") {
    // No audit required unless authed+tenant-scoped (handled inside canonicalMethodNotAllowed)
    const session = resolveSession(req);
    const ctx = makeCtx(req, requestId, session);
    return canonicalMethodNotAllowed(req, res, ctx);
  }

  // Auth gate for all /api/*
  const session = resolveSession(req);
  const ctx = makeCtx(req, requestId, session);

  const auth = requireAuth(req, res, session);
  if (!auth || auth.ok !== true) {
    emitAudit(ctx, "auth.rejected", { ok: false, status: 401, code: "AUTH_REQUIRED" }, null);
    return;
  }

  // Tenant required (authenticated but forbidden)
  if (!ctx.tenantId) {
    forbidden(res, "TENANT_REQUIRED", null);
    emitAudit(ctx, "auth.tenant_missing", { ok: false, status: 403, code: "TENANT_REQUIRED" }, null);
    return;
  }

  return routeAuthed(req, res, ctx, body);
});

module.exports = { server };
