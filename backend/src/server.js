import express from "express";
import http from "http";

// Existing middleware you already have
import { errorHandler } from "./middleware/errorHandler.js";
import rejectTenantOverride from "./middleware/rejectTenantOverride.js";

// Existing B2 read routes (KEEP/ADJUST the import name/path to match your repo)
import inventoryReadRoutes from "./routes/inventory/inventory.read.routes.js";

// B3 ledger write routes
import ledgerWriteRoutes from "./routes/inventory/ledger.write.routes.js";

const app = express();

/**
 * Global middleware
 */
app.use(express.json());
app.use(rejectTenantOverride);

/**
 * Routes
 * Keep your existing B1 auth + tenant context gates exactly as they exist today.
 * If you currently mount auth/tenant middleware here, keep it here above these routes.
 */
app.use("/api/inventory", inventoryReadRoutes);
app.use("/api/inventory", ledgerWriteRoutes);

/**
 * Error handler MUST be last
 */
app.use(errorHandler);

const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Asora backend listening on port ${PORT}`);
});

export default app;
