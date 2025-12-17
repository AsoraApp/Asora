"use strict";

const http = require("http");
const url = require("url");

const { getOrCreateRequestId } = require("./observability/requestId");
const { createRequestContext } = require("./domain/requestContext");
const { handleAuthMe } = require("./api/auth");
const { requireAuth } = require("./auth/requireAuth");
const { resolveSession } = require("./auth/session");
const { emitAudit } = require("./observability/audit");

// Existing routers
const inventoryRouter = require("./api/inventory");
const rejectTenantOverride = require("./middleware/rejectTenantOverride");
const { writeLedgerEventHttp } = require("./ledger/write");
const vendorsRouter = require("./api/vendors");
const complianceRouter = require("./api/compliance");

// New B8 routers
const reportsRouter = require("./api/reports");
const exportsRouter = require("./api/exports");

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

function send(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function notFound(res, code) {
  return send(res, 404, { error: "NOT_FOUND", code });
}

function methodNotAllowed(res, code) {
  return send(res, 405, { error: "METHOD_NOT_ALLOWED", code });
}

const server = http.createServer(async (req, res) => {
  const requestId = getOrCreateRequestId(req, res);
  const reqUrl = url.parse(req.url, true);
  const pathname = reqUrl.pathname || "/";

  // Fail-closed: reject any client attempt to override tenant context
  rejectTenantOverride(req, res);

  // Resolve session (tenant-scoped; derived from Authorization only)
  const session = resolveSession(req);
  const ctx = createRequestContext({ requestId, session });

  // Minimal audit envelope for every request (allow/deny handled downstream too)
  emitAudit(ctx, {
    eventCategory: "AUTH",
    eventType: "HTTP_REQUEST",
    objectType: "http",
    objectId: `${req.method || "?"} ${pathname}`,
    decision: "SYSTEM",
    reasonCode: "REQUEST_RECEIVED",
    factsSnapshot: { method: req.method || null, pathname },
  });

  // Public auth endpoint(s)
  if (pathname === "/api/auth/me") {
    if (req.method !== "GET") return methodNotAllowed(res, "AUTH_ME_METHOD");
    return handleAuthMe(req, res, ctx);
  }

  // Everything else requires auth + tenant context
  const authResult = requireAuth(req, res, ctx);
  if (!authResult || authResult.ok !== true) return;

  // Body parsing for write routes only
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const body = await readJsonBody(req);
    if (body === "__INVALID_JSON__") {
      return send(res, 400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null });
    }
    req.body = body;
  }

  // Ledger write endpoint (B3)
  if (pathname === "/api/ledger/write") {
    if (req.method !== "POST") return methodNotAllowed(res, "LEDGER_WRITE_METHOD");
    return writeLedgerEventHttp(req, res, ctx);
  }

  // B2 Inventory (read-only)
  if (pathname.startsWith("/api/inventory")) {
    return inventoryRouter(req, res, ctx);
  }

  // B5 Vendor + Compliance
  if (pathname.startsWith("/api/vendors")) {
    return vendorsRouter(req, res, ctx);
  }
  if (pathname.startsWith("/api/compliance")) {
    return complianceRouter(req, res, ctx);
  }

  // B8 Reports + Exports (read-only)
  if (pathname.startsWith("/api/reports/")) {
    if (req.method !== "GET") return methodNotAllowed(res, "REPORTS_METHOD");
    return reportsRouter(req, res, ctx);
  }
  if (pathname.startsWith("/api/exports/")) {
    if (req.method !== "GET") return methodNotAllowed(res, "EXPORTS_METHOD");
    return exportsRouter(req, res, ctx);
  }

  return notFound(res, "ROUTE_NOT_FOUND");
});

module.exports = server;
const http = require("http");
const url = require("url");

const { getOrCreateRequestId } = require("./observability/requestId");
const { createRequestContext } = require("./domain/requestContext");
const { handleAuthMe } = require("./api/auth");
const { requireAuth } = require("./auth/requireAuth");
const { resolveSession } = require("./auth/session");
const { emitAudit } = require("./observability/audit");

const rejectTenantOverride = require("./middleware/rejectTenantOverride");

// B2 inventory router + guards
const inventoryRouter = require("./api/inventory");

// B3 ledger write handler
const { writeLedgerEventHttp } = require("./ledger/write");

// B5 vendor compliance + eligibility
const vendorsRouter = require("./api/vendors");
const complianceRouter = require("./api/compliance");

// B6 procurement lifecycle (existing from Phase 7/B6)
const procurementRouter = require("./api/procurement");

// B7 RFQs + Quotes + Comparison + Selection + PO from selected quote
const rfqsRouter = require("./api/rfqsRouter");
const quotesRouter = require("./api/quotes");
const poFromSelectedQuoteRouter = require("./api/purchaseOrdersFromSelectedQuote");

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

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function notFound(res) {
  return sendJson(res, 404, { error: "NOT_FOUND" });
}

function methodNotAllowed(res) {
  return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
}

const server = http.createServer(async (req, res) => {
  const requestId = getOrCreateRequestId(req, res);

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname || "/";
  const method = (req.method || "GET").toUpperCase();

  // Body parse (only if needed)
  let body = null;
  if (method !== "GET" && method !== "HEAD") {
    body = await readJsonBody(req);
    if (body === "__INVALID_JSON__") {
      return sendJson(res, 400, { error: "INVALID_JSON", code: "BADC-JSON" });
    }
  }

  // Create deterministic request context (tenant derived from session)
  const ctx = createRequestContext({
    requestId,
    nowUtc: new Date().toISOString(),
    method,
    path,
    query: parsed.query || {},
    body,
  });

  try {
    // Reject any attempt to override tenant (fail-closed)
    if (rejectTenantOverride) {
      const rejected = rejectTenantOverride(req, res);
      if (rejected) return;
    }

    // Health-ish / auth endpoint
    if (path === "/api/auth/me") {
      if (method !== "GET") return methodNotAllowed(res);
      return handleAuthMe(ctx, req, res);
    }

    // Require auth + session-derived tenant for everything else under /api
    if (path.startsWith("/api/")) {
      const authOk = await requireAuth(ctx, req, res, resolveSession);
      if (!authOk) return;

      // Routers are responsible for tenant-scoped enforcement via ctx.tenantId
      if (inventoryRouter && inventoryRouter(ctx, req, res)) return;
      if (vendorsRouter && vendorsRouter(ctx, req, res)) return;
      if (complianceRouter && complianceRouter(ctx, req, res)) return;
      if (procurementRouter && procurementRouter(ctx, req, res)) return;

      if (rfqsRouter && rfqsRouter(ctx, req, res)) return;
      if (quotesRouter && quotesRouter(ctx, req, res)) return;
      if (poFromSelectedQuoteRouter && poFromSelectedQuoteRouter(ctx, req, res)) return;

      // Ledger write endpoint (B3)
      if (path.startsWith("/api/ledger")) {
        return writeLedgerEventHttp(ctx, req, res);
      }

      return notFound(res);
    }

    return notFound(res);
  } catch (err) {
    // Fail-closed; emit auditable error event
    try {
      emitAudit(ctx, {
        eventCategory: "SYSTEM",
        eventType: "UNHANDLED_ERROR",
        objectType: "http_request",
        objectId: `${method} ${path}`,
        decision: "DENY",
        reasonCode: "UNHANDLED_ERROR",
        factsSnapshot: {
          message: err && err.message ? String(err.message) : "unknown",
        },
      });
    } catch (_) {}

    return sendJson(res, 500, { error: "INTERNAL_ERROR", code: "INT-ERR" });
  }
});

module.exports = server;
