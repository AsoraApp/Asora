const http = require("http");

const { getOrCreateRequestId } = require("../observability/requestId");
const { createRequestContext } = require("../domain/requestContext");
const { handleAuthMe } = require("../api/auth");
const { requireAuth } = require("../auth/requireAuth");
const { resolveSession } = require("../auth/session");
const { emitAudit } = require("../observability/audit");

const server = http.createServer((req, res) => {
  const requestId = getOrCreateRequestId(req);
  res.setHeader("x-request-id", requestId);

  const session = resolveSession(req);

  // ----- fail-closed on session / tenant resolution -----
  if (session.error) {
    emitAudit({
      category: "TENANT",
      eventType: "TENANT.RESOLVE_FAIL",
      requestId,
      error: session.error
    });

    res.writeHead(session.status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: session.error,
        requestId
      })
    );
    return;
  }

  emitAudit({
    category: "TENANT",
    eventType: "TENANT.RESOLVE_SUCCESS",
    requestId,
    userId: session.userId,
    tenantId: session.tenantId
  });

  const ctx = createRequestContext({
    requestId,
    userId: session.userId,
    tenantId: session.tenantId
  });

  // ----- public route -----
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", requestId }));
    return;
  }

  // ----- protected routes -----
  if (req.method === "GET" && req.url === "/auth/me") {
    const authResult = requireAuth(req, ctx);
    if (!authResult.ok) {
      emitAudit({
        category: "AUTH",
        eventType: "AUTH.UNAUTHENTICATED",
        requestId
      });

      res.writeHead(authResult.status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: authResult.error,
          requestId
        })
      );
      return;
    }

    emitAudit({
      category: "AUTH",
      eventType: "AUTH.ACCESS_GRANTED",
      requestId,
      userId: ctx.userId,
      tenantId: ctx.tenantId
    });

    handleAuthMe(req, res, ctx);
    return;
  }

  // ----- fallback -----
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: "NOT_FOUND",
      requestId
    })
  );
});

server.listen(3000, () => {
  console.log("Asora backend running on port 3000");
});
