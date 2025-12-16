const http = require("http");

const { getOrCreateRequestId } = require("../observability/requestId");
const { createRequestContext } = require("../domain/requestContext");
const { handleAuthMe } = require("../api/auth");

const server = http.createServer((req, res) => {
  // ----- request id -----
  const requestId = getOrCreateRequestId(req);
  res.setHeader("x-request-id", requestId);

  // ----- request context (B1 plumbing only) -----
  // auth + tenant enforcement will replace these placeholders
  const ctx = createRequestContext({
    requestId,
    userId: "anonymous",
    tenantId: "unresolved"
  });

  // ----- routing -----
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", requestId }));
    return;
  }

  if (req.method === "GET" && req.url === "/auth/me") {
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
