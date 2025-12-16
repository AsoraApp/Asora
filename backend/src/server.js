const http = require("http");

const { getOrCreateRequestId } = require("../observability/requestId");
const { createRequestContext } = require("../domain/requestContext");

const server = http.createServer((req, res) => {
    const requestId = getOrCreateRequestId(req);
  res.setHeader("x-request-id", requestId);

  // B1 plumbing: auth + tenant will populate these later
  const ctx = createRequestContext({
    requestId,
    userId: "anonymous",
    tenantId: "unresolved"
  });

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(3000, () => {
  console.log("Asora backend running on port 3000");
});
