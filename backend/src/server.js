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

// New (B9)
const offlineRouter = require("./api/offline");

// Optional routers that may exist in your repo (B6/B7). If not present, server will fail-closed for those paths.
let procurementRouter = null;
let rfqsRouter = null;
try {
  procurementRouter = require("./api/procurement");
} catch {
  procurementRouter = null;
}
try {
  rfqsRouter = require("./api/rfqs");
} catch {
  rfqsRouter = null;
}

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

function badRequest(res, code, details) {
  return send(res, 400, { error: "BAD_REQUEST", code, details: details || null });
}
function notFound(res, code, details) {
  return send(res, 404, { error: "NOT_FOUND", code, details: details || null });
}

function match(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";

  const requestId = getOrCreateRequestId(req, res);

  // Reject any tenant override attempts (fail-closed).
  if (rejectTenantOverride(req, res)) return;

  // Read JSON body once (routers can use req.body).
  const body = await readJsonBody(req);
  if (body === "__INVALID_JSON__") {
    emitAudit(
      { requestId, correlationId: requestId, tenantId: null, userId: null, roleIds: [] },
      {
        eventCategory: "HTTP",
        eventType: "HTTP_BAD_JSON",
        objectType: "request",
        objectId: requestId,
        decision: "DENY",
        reasonCode: "INVALID_JSON",
        factsSnapshot: { pathname, method: req.method },
      }
    );
    return badRequest(res, "INVALID_JSON", null);
  }
  req.body = body;

  // Public endpoint(s)
  if (req.method === "GET" && pathname === "/api/auth/me") {
    // handleAuthMe should internally consult session, but we keep behavior consistent with earlier phases.
    return handleAuthMe(req, res, { requestId });
  }

  // Auth + tenant context (fail-closed)
  const session = resolveSession(req);
  if (!session) {
    emitAudit(
      { requestId, correlationId: requestId, tenantId: null, userId: null, roleIds: [] },
      {
        eventCategory: "AUTH",
        eventType: "AUTH_REQUIRED",
        objectType: "request",
        objectId: requestId,
        decision: "DENY",
        reasonCode: "MISSING_OR_INVALID_AUTH",
        factsSnapshot: { pathname, method: req.method },
      }
    );
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "UNAUTHORIZED", code: "AUTH_REQUIRED" }));
  }

  const ctx = createRequestContext({
    requestId,
    correlationId: requestId,
    session,
  });

  // requireAuth gate (keeps existing semantics)
  if (!requireAuth(req, res, ctx)) return;

  // Router dispatch (tenant-scoped everywhere; routers use ctx.tenantId)
  try {
    // Ledger writes
    if (match(pathname, "/api/ledger")) {
      const handled = await writeLedgerEventHttp(req, res, ctx);
      return handled;
    }

    // Inventory reads (B2)
    if (match(pathname, "/api/inventory")) {
      const handled = await inventoryRouter(req, res, ctx);
      return handled;
    }

    // Vendor reads/compliance (B5)
    if (match(pathname, "/api/vendors")) {
      const handled = await vendorsRouter(req, res, ctx);
      return handled;
    }
    if (match(pathname, "/api/compliance")) {
      const handled = await complianceRouter(req, res, ctx);
      return handled;
    }

    // Procurement lifecycle (B6) — fail-closed if module missing
    if (match(pathname, "/api/procurement")) {
      if (!procurementRouter) return notFound(res, "PROCUREMENT_ROUTER_MISSING", null);
      const handled = await procurementRouter(req, res, ctx);
      return handled;
    }

    // RFQs (B7) — fail-closed if module missing
    if (match(pathname, "/api/rfqs")) {
      if (!rfqsRouter) return notFound(res, "RFQS_ROUTER_MISSING", null);
      const handled = await rfqsRouter(req, res, ctx);
      return handled;
    }

    // Offline (B9)
    if (match(pathname, "/api/offline")) {
      const handled = await offlineRouter(req, res, ctx);
      return handled;
    }

    return notFound(res, "ROUTE_NOT_FOUND", { pathname, method: req.method });
  } catch (err) {
    emitAudit(ctx, {
      eventCategory: "HTTP",
      eventType: "HTTP_HANDLER_ERROR",
      objectType: "request",
      objectId: requestId,
      decision: "DENY",
      reasonCode: "UNHANDLED_EXCEPTION",
      factsSnapshot: {
        pathname,
        method: req.method,
        message: err && err.message ? String(err.message) : "unknown",
      },
    });

    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "INTERNAL_ERROR", code: "UNHANDLED_EXCEPTION" }));
  }
});

module.exports = server;
