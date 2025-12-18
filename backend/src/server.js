// backend/src/server.js
"use strict";

const http = require("http");
const url = require("url");

const { getOrCreateRequestId } = require("./observability/requestId");
const { createRequestContext } = require("./domain/requestContext");
const { handleAuthMe } = require("./api/auth");
const { requireAuth } = require("./auth/requireAuth");
const { resolveSession } = require("./auth/session");
const { emitAudit } = require("./observability/audit");

const { notFound, methodNotAllowed, badRequest } = require("./api/_errors");

// B2 inventory router + guards
const inventoryRouter = require("./api/inventory");
const rejectTenantOverride = require("./middleware/rejectTenantOverride");

// B3 ledger write handler
const { writeLedgerEventHttp } = require("./ledger/write");

// B5 vendor compliance + eligibility
const vendorsRouter = require("./api/vendors");
const complianceRouter = require("./api/compliance");

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch {
        resolve("__INVALID_JSON__");
      }
    });
  });
}

function makeCtx(req, requestId, session) {
  const parsed = url.parse(req.url || "/", true);
  const path = parsed.pathname || "/";

  const ctx = createRequestContext({
    requestId,
    method: req.method || "GET",
    path,
    // tenantId MUST be session-derived only. Never accept client-provided tenant.
    tenantId: session && session.tenantId ? String(session.tenantId) : null,
    actor: session && session.actor ? session.actor : null,
  });

  return ctx;
}

function canonicalNotFound(res, ctx, code, details) {
  // Always deterministic body
  notFound(res, code || "ROUTE_NOT_FOUND", details || null);

  // Emit audit only when tenant-scoped and authenticated (per B13)
  if (ctx && ctx.tenantId && ctx.actor && ctx.actor.type !== "unknown") {
    emitAudit(ctx, "route.not_found", { ok: false, status: 404, code: code || "ROUTE_NOT_FOUND" }, details || null);
  }
}

function canonicalMethodNotAllowed(res, ctx, code, details) {
  methodNotAllowed(res, code || "METHOD_NOT_ALLOWED", details || null);
  if (ctx && ctx.tenantId && ctx.actor && ctx.actor.type !== "unknown") {
    emitAudit(
      ctx,
      "route.method_not_allowed",
      { ok: false, status: 405, code: code || "METHOD_NOT_ALLOWED" },
      details || null
    );
  }
}

function safeCall(handler, req, res, ctx) {
  try {
    return handler(req, res, ctx);
  } catch (e) {
    // Fail-closed. Do not leak error details.
    emitAudit(ctx, "server.handler_exception", { ok: false, status: 500, code: "HANDLER_EXCEPTION" }, null);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "INTERNAL", code: "INTERNAL_ERROR", details: null }));
  }
}

function isApiPath(pathname) {
  return typeof pathname === "string" && pathname.startsWith("/api/");
}

function route(req, res, ctx, body) {
  const parsed = url.parse(req.url || "/", true);
  const pathname = parsed.pathname || "/";

  // Canonical prefix: /api/*
  if (!isApiPath(pathname)) {
    // Not under API surface: deterministic NOT_FOUND (no audit requirement here)
    return notFound(res, "ROUTE_NOT_FOUND", null);
  }

  // Auth self endpoint (example): GET /api/auth/me
  if (pathname === "/api/auth/me") {
    if (req.method !== "GET") return canonicalMethodNotAllowed(res, ctx, "METHOD_NOT_ALLOWED", null);
    return safeCall(handleAuthMe, req, res, ctx);
  }

  // Inventory read/write surface (router decides)
  if (pathname.startsWith("/api/inventory")) {
    return safeCall(inventoryRouter, req, res, ctx);
  }

  // Ledger write surface: POST /api/ledger/events
  if (pathname === "/api/ledger/events") {
    if (req.method !== "POST") return canonicalMethodNotAllowed(res, ctx, "METHOD_NOT_ALLOWED", null);
    // Attach parsed body for downstream if it expects it
    req.body = body;
    return safeCall(writeLedgerEventHttp, req, res, ctx);
  }

  // Vendors + compliance
  if (pathname.startsWith("/api/vendors")) {
    return safeCall(vendorsRouter, req, res, ctx);
  }
  if (pathname.startsWith("/api/compliance")) {
    return safeCall(complianceRouter, req, res, ctx);
  }

  // Unknown API route
  return canonicalNotFound(res, ctx, "ROUTE_NOT_FOUND", null);
}

const server = http.createServer(async (req, res) => {
  const requestId = getOrCreateRequestId(req, res);

  // Reject any client-supplied tenant override deterministically
  // (must apply before any auth/route work)
  try {
    const rejected = rejectTenantOverride(req, res);
    if (rejected) {
      // rejectTenantOverride is responsible for response envelope;
      // ensure audit is still emitted if we can resolve session
      const session = resolveSession(req);
      const ctx = makeCtx(req, requestId, session);
      emitAudit(ctx, "auth.tenant_override_rejected", { ok: false, status: 403, code: "TENANT_OVERRIDE_REJECTED" }, null);
      return;
    }
  } catch {
    // If middleware errors, fail-closed
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "INTERNAL", code: "INTERNAL_ERROR", details: null }));
    return;
  }

  // Parse body only when present; invalid JSON is 400 with deterministic details=null
  const body = await readJsonBody(req);
  if (body === "__INVALID_JSON__") {
    // Attempt to resolve session for audit (no token logging)
    const session = resolveSession(req);
    const ctx = makeCtx(req, requestId, session);
    badRequest(res, "INVALID_JSON", null);
    if (ctx && ctx.tenantId && ctx.actor && ctx.actor.type !== "unknown") {
      emitAudit(ctx, "request.invalid_json", { ok: false, status: 400, code: "INVALID_JSON" }, null);
    }
    return;
  }

  // Resolve session (no raw headers logged)
  const session = resolveSession(req);

  // Require auth for all /api/* except explicitly public endpoints (none in B13)
  // Semantics:
  // - 401 missing/invalid auth
  // - 403 auth ok but tenant missing/forbidden (tenant missing is treated as forbidden)
  const authResult = requireAuth(req, res, session);
  if (!authResult || authResult.ok !== true) {
    // requireAuth must have written the response deterministically
    // Emit standardized audit for auth rejection when possible
    const ctx = makeCtx(req, requestId, session);
    const status = Number.isInteger(authResult && authResult.status) ? authResult.status : res.statusCode || 401;
    const code = (authResult && authResult.code) || (status === 401 ? "AUTH_REQUIRED" : "FORBIDDEN");
    emitAudit(ctx, "auth.rejected", { ok: false, status, code }, null);
    return;
  }

  // Build request context (tenant/session derived)
  const ctx = makeCtx(req, requestId, session);

  // Tenant required for all authenticated requests
  if (!ctx.tenantId) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }));
    emitAudit(ctx, "auth.tenant_missing", { ok: false, status: 403, code: "TENANT_REQUIRED" }, null);
    return;
  }

  // Route
  return route(req, res, ctx, body);
});

module.exports = { server };
