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
const rfqsRouter = require("./api/rfqs");
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
