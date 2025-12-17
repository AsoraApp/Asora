// backend/src/middleware/enforcePlanForRequest.worker.mjs
// Write-path only: resolve plan (fail-closed) + enforce numeric limits for create-like actions
// BEFORE any mutation / ledger write / state change.

import { resolveTenantPlanOrThrow } from "../domain/plans/planResolution.mjs";
import { enforcePlanLimitOrThrow } from "../domain/plans/enforcePlanLimit.mjs";
import { RESOURCE_TYPES } from "../domain/plans/planDefinitions.mjs";
import { loadTenantCollection } from "../storage/jsonStore.worker.mjs";
import { PlanEnforcementError, isPlanEnforcementError } from "../domain/plans/planErrors.mjs";

function isWriteMethod(method) {
  const m = String(method || "").toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

// Deterministic request->resource inference for common "create" endpoints.
// Adjust ONLY by editing this mapping.
function inferCreateLimitCheck(reqUrl, method) {
  const m = String(method || "").toUpperCase();
  if (m !== "POST") return null;

  let p = "";
  try {
    p = new URL(reqUrl).pathname || "";
  } catch {
    return null;
  }

  // Inventory create paths (example conventions):
  // POST /api/inventory/items
  // POST /api/inventory/categories
  // POST /api/inventory/hubs
  // POST /api/inventory/bins
  if (p === "/api/inventory/items") return { resourceType: RESOURCE_TYPES.ITEMS, delta: 1 };
  if (p === "/api/inventory/categories") return { resourceType: RESOURCE_TYPES.CATEGORIES, delta: 1 };
  if (p === "/api/inventory/hubs") return { resourceType: RESOURCE_TYPES.HUBS, delta: 1 };
  if (p === "/api/inventory/bins") return { resourceType: RESOURCE_TYPES.BINS, delta: 1 };

  // Vendors
  if (p === "/api/vendors") return { resourceType: RESOURCE_TYPES.VENDORS, delta: 1 };

  // Exports (treat each export run as +1 against EXPORTS limit)
  if (p === "/api/exports") return { resourceType: RESOURCE_TYPES.EXPORTS, delta: 1 };

  // Integrations (treat each integration config as +1)
  if (p === "/api/integrations") return { resourceType: RESOURCE_TYPES.INTEGRATIONS, delta: 1 };

  return null;
}

export async function enforcePlanForRequestOrThrow(ctx, req) {
  if (!isWriteMethod(req?.method)) return { ok: true };

  // 1) Resolve tenant plan (fail-closed if missing/unknown)
  const { plan } = await resolveTenantPlanOrThrow(ctx, `${req.method || "UNKNOWN"} ${(new URL(req.url)).pathname}`);

  // 2) For known create-like endpoints, enforce capacity before any mutation
  const check = inferCreateLimitCheck(req.url, req.method);
  if (!check) return { ok: true, planName: plan.name };

  // Load tenant collection (read-only) to derive current usage deterministically
  const col = await loadTenantCollection(ctx.tenantId);
  if (!col || typeof col !== "object") {
    throw new PlanEnforcementError("AMBIGUOUS_ENFORCEMENT_STATE", "Tenant collection missing/invalid. Fail-closed.", {
      tenantId: ctx.tenantId,
    });
  }

  await enforcePlanLimitOrThrow(ctx, plan, col, {
    resourceType: check.resourceType,
    delta: check.delta,
    attemptedAction: `${req.method || "UNKNOWN"} ${(new URL(req.url)).pathname}`,
  });

  return { ok: true, planName: plan.name };
}

export function planErrorToHttp(err) {
  if (isPlanEnforcementError(err)) {
    const status = err.code === "PLAN_LIMIT_EXCEEDED" ? 409 : 403;
    return {
      status,
      body: { error: status === 409 ? "CONFLICT" : "FORBIDDEN", code: err.code, details: err.details || null },
    };
  }
  return { status: 403, body: { error: "FORBIDDEN", code: "PLAN_ENFORCEMENT_ERROR", details: null } };
}
