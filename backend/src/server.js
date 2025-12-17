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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function errorJson(res, status, code, message, ctx) {
  return sendJson(res, status, {
    error: {
      code,
      message,
      requestId: ctx?.requestId || null,
    },
  });
}

function notFound(res, ctx) {
  return errorJson(res, 404, "NOT_FOUND", "Not found.", ctx);
}

function methodNotAllowed(res, ctx) {
  return errorJson(res, 409, "METHOD_NOT_ALLOWED", "Method not allowed.", ctx);
}

function normalizePath(url) {
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

const server = http.createServer(async (req, res) => {
  const requestId = getOrCreateRequestId(req);

  // B1: tenant must be session-derived only; reject client tenant override attempts
  rejectTenantOverride(req, res, () => {});

  // Basic request context
  const ctx = createRequestContext({ req, requestId });

  // Attach parsed body once (routers can use ctx.body)
  ctx.body = await readJsonBody(req);
  if (ctx.body === "__INVALID_JSON__") {
    emitAudit({
      tenantId: null,
      eventCategory: "API",
      eventType: "REQUEST_INVALID_JSON",
      objectType: "http_request",
      objectId: null,
      actorUserId: null,
      actorRoleIds: [],
      decision: "DENY",
      reasonCode: "INVALID_JSON",
      factsSnapshot: { path: req.url, method: req.method },
      correlationId: requestId,
    });
    return errorJson(res, 400, "VALIDATION_ERROR", "Invalid JSON body.", ctx);
  }

  // Health
  if (req.method === "GET" && normalizePath(req.url) === "/health") {
    return sendJson(res, 200, { ok: true, requestId });
  }

  // Auth info
  if (req.method === "GET" && normalizePath(req.url) === "/auth/me") {
    return handleAuthMe(req, res, ctx);
  }

  // B3: ledger write (HTTP handler already enforces auth/tenant internally per prior phases)
  if (normalizePath(req.url) === "/ledger" || normalizePath(req.url).startsWith("/ledger/")) {
    return writeLedgerEventHttp(req, res, ctx);
  }

  // All /api/* require B1 auth + tenant context
  if (normalizePath(req.url).startsWith("/api/")) {
    // Auth gate
    const authDecision = requireAuth(req);
    if (!authDecision.ok) {
      emitAudit({
        tenantId: null,
        eventCategory: "AUTH",
        eventType: "AUTH_REQUIRED",
        objectType: "http_request",
        objectId: null,
        actorUserId: null,
        actorRoleIds: [],
        decision: "DENY",
        reasonCode: authDecision.reasonCode || "UNAUTHENTICATED",
        factsSnapshot: { path: req.url, method: req.method },
        correlationId: requestId,
      });
      return errorJson(res, 401, "UNAUTHENTICATED", "Authentication required.", ctx);
    }

    // Session → tenant resolution (fail-closed)
    const session = resolveSession(req);
    if (!session || !session.tenantId) {
      emitAudit({
        tenantId: null,
        eventCategory: "TENANT",
        eventType: "TENANT_UNRESOLVED",
        objectType: "http_request",
        objectId: null,
        actorUserId: session?.userId || null,
        actorRoleIds: session?.roleIds || [],
        decision: "DENY",
        reasonCode: "TENANT_UNRESOLVED",
        factsSnapshot: { path: req.url, method: req.method },
        correlationId: requestId,
      });
      return errorJson(res, 403, "TENANT_UNRESOLVED", "Tenant could not be resolved.", ctx);
    }

    ctx.tenantId = session.tenantId;
    ctx.userId = session.userId || null;
    ctx.roleIds = session.roleIds || [];

    // Route: inventory (B2)
    if (normalizePath(req.url).startsWith("/api/inventory")) {
      return inventoryRouter(req, res, ctx);
    }

    // Route: vendors (B5)
    if (normalizePath(req.url).startsWith("/api/vendors")) {
      return vendorsRouter(req, res, ctx);
    }

    // Route: compliance rules (B5)
    if (normalizePath(req.url).startsWith("/api/compliance")) {
      return complianceRouter(req, res, ctx);
    }

    return notFound(res, ctx);
  }

  // Default
  if (req.method !== "GET") return methodNotAllowed(res, ctx);
  return notFound(res, ctx);
});

module.exports = server;
