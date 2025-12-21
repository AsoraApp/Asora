// backend/src/domain/plans/planResolution.mjs
// Deterministic tenant->plan resolution. Server-controlled only. Fail-closed on absence/unknown.

import { loadTenantCollection, saveTenantCollection } from "../../storage/jsonStore.worker.mjs";
import { nowUtcIso } from "../time/utc.mjs";
import { emitAudit } from "../../observability/audit.worker.mjs";
import { getPlanOrNull } from "./planDefinitions.mjs";
import { PlanEnforcementError } from "./planErrors.mjs";

// Stored as a dedicated tenant-scoped KV document.
// We do NOT store this inside an "items.json" style object; keep it isolated.
const TENANT_META_DOC = "__tenant_meta__";

function normalizePlanName(x) {
  if (typeof x !== "string") return null;
  const s = x.trim();
  return s ? s : null;
}

function requireTenantId(ctx) {
  const tenantId = typeof ctx?.tenantId === "string" ? ctx.tenantId : null;
  if (!tenantId) {
    throw new PlanEnforcementError("TENANT_REQUIRED", "Tenant context required to resolve plan.", null);
  }
  return tenantId;
}

function attachPlanToCtx(ctx, plan) {
  try {
    // Downstream write-path middleware often expects ctx.plan to exist.
    // Keep minimal deterministic shape.
    ctx.plan = Object.freeze({ name: plan.name });
  } catch {
    // swallow
  }
}

export async function getTenantMeta(ctx, env) {
  const tenantId = requireTenantId(ctx);

  // Meta is a single object doc (or null if never set).
  const meta = await loadTenantCollection(env, tenantId, TENANT_META_DOC, null);
  const out = meta && typeof meta === "object" ? meta : null;

  return { meta: out };
}

export async function setTenantPlan(ctx, planName, env, cfctx) {
  // Server-side utility only (admin tooling can call this). Not for client input paths.
  const tenantId = requireTenantId(ctx);

  const p = normalizePlanName(planName);
  const plan = getPlanOrNull(p);
  if (!plan) {
    throw new PlanEnforcementError("UNKNOWN_PLAN", "Unknown plan name.", { planName: p });
  }

  const { meta } = await getTenantMeta(ctx, env);

  const nextMeta = {
    ...(meta || {}),
    planName: plan.name,
    updatedAtUtc: nowUtcIso(),
  };

  await saveTenantCollection(env, tenantId, TENANT_META_DOC, nextMeta);

  emitAudit(
    ctx,
    {
      eventCategory: "SECURITY",
      eventType: "TENANT_PLAN_SET",
      objectType: "tenant",
      objectId: tenantId,
      decision: "ALLOW",
      reasonCode: "SET",
      factsSnapshot: { plan: plan.name },
    },
    env,
    cfctx
  );

  attachPlanToCtx(ctx, plan);
  return plan;
}

/**
 * Resolve tenant plan deterministically; fail-closed if missing/unknown.
 * Returns: { plan, meta }
 * Side-effect: attaches ctx.plan = { name } for downstream usage.
 */
export async function resolveTenantPlanOrThrow(ctx, actionForAudit, env, cfctx) {
  const tenantId = requireTenantId(ctx);

  const { meta } = await getTenantMeta(ctx, env);

  const planName = normalizePlanName(meta?.planName);
  if (!planName) {
    emitAudit(
      ctx,
      {
        eventCategory: "SECURITY",
        eventType: "PLAN_VIOLATION",
        objectType: "tenant",
        objectId: tenantId,
        decision: "DENY",
        reasonCode: "MISSING_PLAN",
        factsSnapshot: {
          attemptedAction: typeof actionForAudit === "string" ? actionForAudit : "unknown",
          plan: null,
        },
      },
      env,
      cfctx
    );

    throw new PlanEnforcementError("MISSING_PLAN", "Tenant plan is missing. Fail-closed.", { tenantId });
  }

  const plan = getPlanOrNull(planName);
  if (!plan) {
    emitAudit(
      ctx,
      {
        eventCategory: "SECURITY",
        eventType: "PLAN_VIOLATION",
        objectType: "tenant",
        objectId: tenantId,
        decision: "DENY",
        reasonCode: "UNKNOWN_PLAN",
        factsSnapshot: {
          attemptedAction: typeof actionForAudit === "string" ? actionForAudit : "unknown",
          plan: planName,
        },
      },
      env,
      cfctx
    );

    throw new PlanEnforcementError("UNKNOWN_PLAN", "Tenant plan is unknown. Fail-closed.", {
      tenantId,
      planName,
    });
  }

  attachPlanToCtx(ctx, plan);

  // Resolution is read-only; we do not auto-create meta or auto-assign a plan.
  return { plan, meta };
}
