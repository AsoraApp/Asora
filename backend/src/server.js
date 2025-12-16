const http = require("http");

const { getOrCreateRequestId } = require("../observability/requestId");
const { createRequestContext } = require("../domain/requestContext");
const { handleAuthMe } = require("../api/auth");
const { requireAuth } = require("../auth/requireAuth");
const { resolveSession } = require("../auth/session");

const server = http.createServer((req, res) => {
  const requestId = getOrCreateRequestId(req);
  res.setHeader("x-request-id", requestId);

  // ----- resolve session (authoritative, server-side) -----
  const session = resolveSession(req);

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
      res.writeHead(authResult.status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: authResult.error,
          requestId
        })
      );
      return;
    }

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
