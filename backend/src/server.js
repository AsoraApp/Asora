// backend/src/server.js
//
// Asora backend — raw Node HTTP server (no Express)
// B1: auth + tenant context (session-derived tenantId)
// B2: inventory read router delegation
// B3: ledger write endpoint
// B4: cycle counts router delegation
//
// Global rules enforced here:
// - Fail-closed on session/tenant resolution ambiguity
// - Protected routing under /api/* requires auth + tenant override guard
// - req.ctx is the authoritative request context

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

// B4 cycle counts router
const cycleCountsRouter = require("./api/cycleCounts");

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

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const requestId = getOrCreateRequestId(req);
  res.setHeader("x-request-id", requestId);

  // Parse JSON body once (best-effort; null allowed)
  const body = await readJsonBody(req);
  if (body === "__INVALID_JSON__") {
    json(res, 400, {
      error: { code: "BAD_REQUEST", message: "Invalid JSON" },
      requestId,
    });
    return;
  }
  req.body = body;

  // Resolve session (fail-closed)
  const session = resolveSession(req);

  if (session.error) {
    emitAudit({
      category: "TENANT",
      eventType: "TENANT.RESOLVE_FAIL",
      requestId,
      error: session.error,
    });

    json(res, session.status, { error: session.error, requestId });
    return;
  }

  emitAudit({
    category: "TENANT",
    eventType: "TENANT.RESOLVE_SUCCESS",
    requestId,
    userId: session.userId,
    tenantId: session.tenantId,
  });

  // Create request context (authoritative tenant + user)
  const ctx = createRequestContext({
    requestId,
    userId: session.userId,
    tenantId: session.tenantId,
  });

  // Expose context
  req.ctx = ctx;

  // ----- public route -----
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { status: "ok", requestId });
    return;
  }

  // ----- protected route: /auth/me -----
  if (req.method === "GET" && req.url === "/auth/me") {
    const authResult = requireAuth(req, ctx);
    if (!authResult.ok) {
      emitAudit({
        category: "AUTH",
        eventType: "AUTH.UNAUTHENTICATED",
        requestId,
      });

      json(res, authResult.status, { error: authResult.error, requestId });
      return;
    }

    emitAudit({
      category: "AUTH",
      eventType: "AUTH.ACCESS_GRANTED",
      requestId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    });

    handleAuthMe(req, res, ctx);
    return;
  }

  // ----- protected routes: /api/* -----
  if (req.url && req.url.startsWith("/api/")) {
    const authResult = requireAuth(req, ctx);
    if (!authResult.ok) {
      emitAudit({
        category: "AUTH",
        eventType: "AUTH.UNAUTHENTICATED",
        requestId,
      });

      json(res, authResult.status, { error: authResult.error, requestId });
      return;
    }

    // tenant override guard (fail-closed)
    const guard = rejectTenantOverride(req, res);
    if (!guard.ok) {
      json(res, guard.status, { error: guard.error, requestId });
      return;
    }

    // ----- B3 ledger write endpoint -----
    if (req.method === "POST" && req.url === "/api/inventory/ledger/events") {
      const handledLedgerWrite = writeLedgerEventHttp(req, res, ctx, requestId);
      if (handledLedgerWrite) return;
    }

    // ----- delegate to B2 inventory router -----
    const handledInventory = inventoryRouter(req, res);
    if (handledInventory) return;

    // ----- delegate to B4 cycle counts router -----
    const handledCycleCounts = cycleCountsRouter(req, res);
    if (handledCycleCounts) return;

    json(res, 404, {
      error: { code: "NOT_FOUND", message: "Not found" },
      requestId,
    });
    return;
  }

  // ----- fallback -----
  json(res, 404, { error: "NOT_FOUND", requestId });
});

server.listen(3000, () => {
  console.log("Asora backend running on port 3000");
});
