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

const server = http.createServer(async (req, res) => {
  const requestId = getOrCreateRequestId(req);
  res.setHeader("x-request-id", requestId);

  // Parse JSON body once
  const body = await readJsonBody(req);
  if (body === "__INVALID_JSON__") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: "BAD_REQUEST", message: "Invalid JSON" },
        requestId,
      })
    );
    return;
  }
  req.body = body;

  const session = resolveSession(req);

  // ----- fail-closed on session / tenant resolution -----
  if (session.error) {
    emitAudit({
      category: "TENANT",
      eventType: "TENANT.RESOLVE_FAIL",
      requestId,
      error: session.error,
    });

    res.writeHead(session.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: session.error, requestId }));
    return;
  }

  emitAudit({
    category: "TENANT",
    eventType: "TENANT.RESOLVE_SUCCESS",
    requestId,
    userId: session.userId,
    tenantId: session.tenantId,
  });

  const ctx = createRequestContext({
    requestId,
    userId: session.userId,
    tenantId: session.tenantId,
  });

  // expose context
  req.ctx = ctx;

  // ----- public route -----
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", requestId }));
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

      res.writeHead(authResult.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: authResult.error, requestId }));
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

      res.writeHead(authResult.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: authResult.error, requestId }));
      return;
    }

    // tenant override guard
    const guard = rejectTenantOverride(req, res);
    if (!guard.ok) {
      res.writeHead(guard.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: guard.error, requestId }));
      return;
    }

    // ----- B3 ledger write endpoint -----
    if (req.method === "POST" && req.url === "/api/inventory/ledger/events") {
      const handled = writeLedgerEventHttp(req, res, ctx, requestId);
      if (handled) return;
    }

    // ----- delegate to B2 inventory router -----
    const handled = inventoryRouter(req, res);
    if (handled) return;

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: "NOT_FOUND", message: "Not found" },
        requestId,
      })
    );
    return;
  }

  // ----- fallback -----
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", requestId }));
});

server.listen(3000, () => {
  console.log("Asora backend running on port 3000");
});
