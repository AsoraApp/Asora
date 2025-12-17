const http = require("http");
const url = require("url");

const { getOrCreateRequestId } = require("./observability/requestId");
const { createRequestContext } = require("./domain/requestContext");
const { handleAuthMe } = require("./api/auth");
const { requireAuth } = require("./auth/requireAuth");
const { resolveSession } = require("./auth/session");
const { emitAudit } = require("./observability/audit");

// B2 inventory router + guards
const inventoryRouter = require("./api/inventory");
const rejectTenantOverride = require("./middleware/rejectTenantOverride");

// B3 ledger write handler
const { writeLedgerEventHttp } = require("./ledger/write");

// B5 vendor compliance + eligibility
const vendorsRouter = require("./api/vendors");
const complianceRouter = require("./api/compliance");

// B10 alerts + notifications
const alertsRouter = require("./api/alerts");
const notificationsRouter = require("./api/notifications");

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

function notFound(res) {
  return send(res, 404, { error: "NOT_FOUND", code: "ROUTE_NOT_FOUND" });
}

function methodNotAllowed(res) {
  return send(res, 405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED" });
}

function parsePath(pathname) {
  return (pathname || "/").replace(/\/+$/g, "") || "/";
}

const server = http.createServer(async (req, res) => {
  const requestId = getOrCreateRequestId(req, res);
  res.setHeader("X-Request-Id", requestId);

  // Tenant override rejection (fail-closed)
  if (!rejectTenantOverride(req, res)) return;

  // Resolve session (authn) and build request context (tenant-scoped)
  const session = resolveSession(req);
  const ctx = createRequestContext({ requestId, session });

  // Always emit request audit boundary (best-effort)
  emitAudit(ctx, {
    eventCategory: "SYSTEM",
    eventType: "HTTP_REQUEST",
    objectType: "http_request",
    objectId: null,
    decision: "SYSTEM",
    reasonCode: "RECEIVED",
    factsSnapshot: {
      method: req.method || null,
      path: url.parse(req.url || "").pathname || null,
    },
  });

  const u = url.parse(req.url || "/");
  const pathname = parsePath(u.pathname);

  // Public/auth helper
  if (pathname === "/api/auth/me") {
    if ((req.method || "GET").toUpperCase() !== "GET") return methodNotAllowed(res);
    return handleAuthMe(ctx, req, res);
  }

  // Auth gate for all other /api/*
  if (pathname.startsWith("/api/")) {
    if (!requireAuth(ctx, req, res)) return;
  }

  // Ledger write (B3)
  if (pathname === "/api/ledger/events") {
    if ((req.method || "POST").toUpperCase() !== "POST") return methodNotAllowed(res);
    return writeLedgerEventHttp(ctx, req, res);
  }

  // Routers (tenant-scoped)
  if (await inventoryRouter(ctx, req, res)) return;
  if (await vendorsRouter(ctx, req, res)) return;
  if (await complianceRouter(ctx, req, res)) return;

  // B10
  if (await alertsRouter(ctx, req, res)) return;
  if (await notificationsRouter(ctx, req, res)) return;

  return notFound(res);
});

module.exports = server;
