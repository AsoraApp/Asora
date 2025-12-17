// backend/src/server.js
const http = require("http");

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

// B6 procurement lifecycle
const requisitionsRouter = require("./api/requisitions");
const purchaseOrdersRouter = require("./api/purchaseOrders");
const receiptsRouter = require("./api/receipts");

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

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function notFound(res) {
  return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
}

const server = http.createServer(async (req, res) => {
  const requestId = getOrCreateRequestId(req);
  res.setHeader("x-request-id", requestId);

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // Parse body once; handlers may use ctx.body
  const body = await readJsonBody(req);

  const ctx = createRequestContext({
    requestId,
    method: req.method,
    path,
    url,
    nowUtc: new Date().toISOString(),
    body,
    session: null,
    tenantId: null,
    userId: null,
    roleIds: [],
  });

  // Public auth endpoint(s)
  if (path === "/api/auth/me") {
    return handleAuthMe(req, res, ctx);
  }

  // Auth gate
  const session = resolveSession(req);
  ctx.session = session;
  try {
    requireAuth(ctx);
  } catch (e) {
    emitAudit(ctx, {
      eventCategory: "AUTH",
      eventType: "AUTH_DENY",
      decision: "DENY",
      reasonCode: e.code || "UNAUTHORIZED",
      factsSnapshot: { path, method: req.method },
    });
    return sendJson(res, 401, { error: { code: e.code || "UNAUTHORIZED", message: e.message } });
  }

  // Tenant is session-derived only (fail-closed)
  if (!session || !session.tenantId) {
    emitAudit(ctx, {
      eventCategory: "TENANT",
      eventType: "TENANT_DENY",
      decision: "DENY",
      reasonCode: "TENANT_UNRESOLVED",
      factsSnapshot: { path, method: req.method },
    });
    return sendJson(res, 403, {
      error: { code: "TENANT_UNRESOLVED", message: "Tenant could not be resolved" },
    });
  }

  ctx.tenantId = session.tenantId;
  ctx.userId = session.userId || null;
  ctx.roleIds = Array.isArray(session.roleIds) ? session.roleIds : [];

  // Reject any client attempt to override tenant
  try {
    rejectTenantOverride(req);
  } catch (e) {
    emitAudit(ctx, {
      eventCategory: "TENANT",
      eventType: "TENANT_OVERRIDE_REJECT",
      decision: "DENY",
      reasonCode: e.code || "TENANT_OVERRIDE",
      factsSnapshot: { path, method: req.method },
    });
    return sendJson(res, 403, { error: { code: e.code || "TENANT_OVERRIDE", message: e.message } });
  }

  // Invalid JSON body (fail-closed)
  if (ctx.body === "__INVALID_JSON__") {
    emitAudit(ctx, {
      eventCategory: "API",
      eventType: "INVALID_JSON",
      decision: "DENY",
      reasonCode: "INVALID_JSON",
      factsSnapshot: { path, method: req.method },
    });
    return sendJson(res, 400, {
      error: { code: "INVALID_JSON", message: "Request body must be valid JSON" },
    });
  }

  // Route delegation (handlers return true if handled)
  if (await inventoryRouter(req, res, ctx)) return;
  if (await writeLedgerEventHttp(req, res, ctx)) return;

  if (await vendorsRouter(req, res, ctx)) return;
  if (await complianceRouter(req, res, ctx)) return;

  if (await requisitionsRouter(req, res, ctx)) return;
  if (await purchaseOrdersRouter(req, res, ctx)) return;
  if (await receiptsRouter(req, res, ctx)) return;

  return notFound(res);
});

module.exports = server;
