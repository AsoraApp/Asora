// backend/src/domain/plans/planResolution.mjs
// Deterministic tenant->plan resolution. Server-controlled only. Fail-closed on absence/unknown.

import { loadTenantCollection, saveTenantCollection } from "../../storage/jsonStore.worker.mjs";
import { nowUtcIso } from "../time/utc.mjs";
import { emitAudit } from "../../observability/audit.mjs";
import { getPlanOrNull } from "./planDefinitions.mjs";
import { PlanEnforcementError } from "./planErrors.mjs";

const TENANT_META_KEY = "__tenant_meta__";

function normalizePlanName(x) {
  if (typeof x !== "string") return null;
  const s = x.trim();
  return s ? s : null;
}

export async function getTenantMeta(ctx) {
  const col = await loadTenantCollection(ctx.tenantId);
  const meta = col?.[TENANT_META_KEY] && typeof col[TENANT_META_KEY] === "object" ? col[TENANT_META_KEY] : null;
  return { col, meta };
}

export async function setTenantPlan(ctx, planName) {
  // Server-side utility only (admin tooling can call this). Not for client input paths.
  const p = normalizePlanName(planName);
  const plan = getPlanOrNull(p);
  if (!plan) {
    throw new PlanEnforcementError("UNKNOWN_PLAN", "Unknown plan name.", { planName: p });
  }

  const { col, meta } = await getTenantMeta(ctx);
  const next = {
    ...(meta || {}),
    planName: plan.name,
    updatedAtUtc: nowUtcIso(),
  };

  const nextCol = { ...(col || {}) };
  nextCol[TENANT_META_KEY] = next;

  await saveTenantCollection(ctx.tenantId, nextCol);

  await emitAudit(ctx, {
    action: "tenant.plan.set",
    atUtc: nowUtcIso(),
    tenantId: ctx.tenantId,
    plan: plan.name,
  });

  return plan;
}

export async function resolveTenantPlanOrThrow(ctx, actionForAudit) {
  if (!ctx?.tenantId) {
    throw new PlanEnforcementError("TENANT_REQUIRED", "Tenant context required to resolve plan.", null);
  }

  const { col, meta } = await getTenantMeta(ctx);

  const planName = normalizePlanName(meta?.planName);
  if (!planName) {
    await emitAudit(ctx, {
      action: "plan.violation",
      atUtc: nowUtcIso(),
      tenantId: ctx.tenantId,
      plan: null,
      resourceType: null,
      limit: null,
      attempted: null,
      attemptedAction: actionForAudit || "unknown",
      reason: "MISSING_PLAN",
    });
    throw new PlanEnforcementError("MISSING_PLAN", "Tenant plan is missing. Fail-closed.", {
      tenantId: ctx.tenantId,
    });
  }

  const plan = getPlanOrNull(planName);
  if (!plan) {
    await emitAudit(ctx, {
      action: "plan.violation",
      atUtc: nowUtcIso(),
      tenantId: ctx.tenantId,
      plan: planName,
      resourceType: null,
      limit: null,
      attempted: null,
      attemptedAction: actionForAudit || "unknown",
      reason: "UNKNOWN_PLAN",
    });
    throw new PlanEnforcementError("UNKNOWN_PLAN", "Tenant plan is unknown. Fail-closed.", {
      tenantId: ctx.tenantId,
      planName,
    });
  }

  // Attach for downstream deterministic usage (write paths only)
  ctx.plan = Object.freeze({ name: plan.name });

  // Defensive: ensure tenant meta exists deterministically if absent (but DO NOT auto-assign a plan).
  // We do not mutate here; resolution is read-only.

  return { plan, col };
}
