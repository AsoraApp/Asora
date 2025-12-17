// backend/src/worker.mjs
// Central request router (Worker). Write paths are gated by tenant plan resolution + limits (B12).

import { getOrCreateRequestId } from "./observability/requestId.mjs";
import { createRequestContext } from "./domain/requestContext.mjs";
import { emitAudit } from "./observability/audit.mjs";

import { requireAuth } from "./auth/requireAuth.mjs";
import { resolveSession } from "./auth/session.mjs";

// Existing routers / handlers (must already exist in your repo)
import { handleAuthMe } from "./api/auth.worker.mjs";
import inventoryRouter from "./api/inventory.worker.mjs";
import vendorsRouter from "./api/vendors.worker.mjs";
import complianceRouter from "./api/compliance.worker.mjs";
import ledgerRouter from "./ledger/router.worker.mjs";

import rejectTenantOverride from "./middleware/rejectTenantOverride.worker.mjs";

// B12 enforcement
import { enforcePlanForRequestOrThrow, planErrorToHttp } from "./middleware/enforcePlanForRequest.worker.mjs";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function notFound(baseHeaders) {
  return json(404, { error: "NOT_FOUND", code: "ROUTE_NOT_FOUND" }, baseHeaders);
}

function methodNotAllowed(baseHeaders) {
  return json(405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED" }, baseHeaders);
}

// Minimal deterministic dispatch contract for routers:
// router.handle(ctx, req, baseHeaders, cfctx) => Response | null
async function dispatchRouter(router, ctx, req, baseHeaders, cfctx) {
  if (!router || typeof router.handle !== "function") return null;
  return await router.handle(ctx, req, baseHeaders, cfctx);
}

export default {
  async fetch(req, env, cfctx) {
    const requestId = getOrCreateRequestId(req);
    const baseHeaders = { "x-request-id": requestId };

    const url = new URL(req.url);
    const path = url.pathname;

    // Context is tenant-scoped and session-derived only.
    const session = await resolveSession(req, env);
    const ctx = createRequestContext({ req, env, requestId, session });

    try {
      // Reject any client-supplied tenant override attempts (fail-closed).
      const rej = await rejectTenantOverride(req, baseHeaders);
      if (rej) return rej;

      // Auth gate (B1)
      const auth = await requireAuth(ctx, req, baseHeaders);
      if (auth) return auth;

      // B12: enforce plan on write paths BEFORE any router/handler mutation
      try {
        await enforcePlanForRequestOrThrow(ctx, req);
      } catch (e) {
        const { status, body } = planErrorToHttp(e);
        // audits are emitted by enforcement modules; still deterministic response here
        return json(status, body, baseHeaders);
      }

      // Routes
      if (path === "/api/auth/me") {
        if (req.method !== "GET") return methodNotAllowed(baseHeaders);
        return await handleAuthMe(ctx, req, baseHeaders, cfctx);
      }

      // Inventory API
      if (path.startsWith("/api/inventory")) {
        const resp = await dispatchRouter(inventoryRouter, ctx, req, baseHeaders, cfctx);
        return resp || notFound(baseHeaders);
      }

      // Vendors API
      if (path.startsWith("/api/vendors")) {
        const resp = await dispatchRouter(vendorsRouter, ctx, req, baseHeaders, cfctx);
        return resp || notFound(baseHeaders);
      }

      // Compliance API
      if (path.startsWith("/api/compliance")) {
        const resp = await dispatchRouter(complianceRouter, ctx, req, baseHeaders, cfctx);
        return resp || notFound(baseHeaders);
      }

      // Ledger
      if (path.startsWith("/ledger")) {
        const resp = await dispatchRouter(ledgerRouter, ctx, req, baseHeaders, cfctx);
        return resp || notFound(baseHeaders);
      }

      return notFound(baseHeaders);
    } catch (err) {
      await emitAudit(ctx, {
        action: "worker.error",
        atUtc: new Date().toISOString(),
        tenantId: ctx?.tenantId || null,
        requestId,
        path,
        method: req.method || null,
      });

      return json(500, { error: "INTERNAL", code: "UNHANDLED_ERROR", details: null }, baseHeaders);
    }
  },
};

// ADD import
import adminTenantPlanRouter from "./api/admin/tenantPlan.worker.mjs";

// ADD route block (admin-only)
if (path === "/api/admin/tenant/plan") {
  const resp = await dispatchRouter(adminTenantPlanRouter, ctx, req, baseHeaders, cfctx);
  return resp || notFound(baseHeaders);
}
