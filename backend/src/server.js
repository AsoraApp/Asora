const express = require("express");
const http = require("http");

const app = express();
app.use(express.json());

/**
 * Minimal B1-compatible dev auth + tenant context stub.
 * - 401 if missing/invalid Authorization
 * - 403 if auth ok but tenant cannot be resolved
 * - tenant is session-derived from token only (no client tenant selection)
 *
 * Use:
 *   Authorization: Bearer dev-tenantA
 *   Authorization: Bearer dev-tenantB
 */
function authAndTenantStub(req, res, next) {
  const auth = req.headers.authorization || "";
  const requestId = req.headers["x-request-id"] || null;

  req.ctx = {
    requestId,
    tenantId: null
  };

  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Missing or invalid Authorization header",
        requestId
      }
    });
  }

  const token = auth.slice("Bearer ".length).trim();

  if (token === "dev-tenantA") req.ctx.tenantId = "tenantA";
  if (token === "dev-tenantB") req.ctx.tenantId = "tenantB";

  if (!req.ctx.tenantId) {
    return res.status(403).json({
      error: {
        code: "TENANT_UNRESOLVED",
        message: "Tenant unresolved",
        requestId
      }
    });
  }

  next();
}

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

(async () => {
  const inventoryRouter = (await import("./api/inventory/index.js")).default;
  const rejectTenantOverride = (await import("./middleware/rejectTenantOverride.js")).default;

  app.use(authAndTenantStub);
  app.use(rejectTenantOverride);
  app.use("/api", inventoryRouter);

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Not found",
        requestId: req.ctx?.requestId || null
      }
    });
  });

  const server = http.createServer(app);

  server.listen(3000, () => {
    console.log("Asora backend running on port 3000");
  });
})().catch((err) => {
  // Fail-closed startup
  console.error("Fatal startup error:", err);
  process.exit(1);
});
