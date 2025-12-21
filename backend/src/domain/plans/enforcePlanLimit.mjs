// backend/src/domain/plans/enforcePlanLimit.mjs
// Hard enforcement inside write paths only. Rejects fully, emits audit on violation.

import { nowUtcIso } from "../time/utc.mjs";
import { emitAudit } from "../../observability/audit.worker.mjs";
import { getLimitOrNull } from "./planDefinitions.mjs";
import { PlanEnforcementError } from "./planErrors.mjs";
import { getCurrentCountOrThrow } from "./usageCounters.mjs";

/**
 * Enforce plan capacity for a resource type by comparing:
 *   attemptedValue (absolute) OR (current + delta)
 *
 * Fail-closed on missing/undefined limits or ambiguous usage state.
 */
export async function enforcePlanLimitOrThrow(ctx, plan, col, input) {
  const resourceType = input?.resourceType;
  const attemptedAction = input?.attemptedAction || "unknown";
  const attemptedValue = input?.attemptedValue; // absolute
  const delta = input?.delta; // increment intent (typically +1)

  if (!ctx?.tenantId) {
    throw new PlanEnforcementError("TENANT_REQUIRED", "Tenant required.", null);
  }
  if (!plan) {
    throw new PlanEnforcementError("PLAN_REQUIRED", "Plan required for enforcement.", null);
  }
  if (typeof resourceType !== "string" || !resourceType) {
    throw new PlanEnforcementError("INVALID_RESOURCE_TYPE", "Resource type required.", null);
  }

  const limit = getLimitOrNull(plan, resourceType);
  if (!Number.isFinite(limit)) {
emitAudit(
  ctx,
  {
    eventCategory: "SECURITY",
    eventType: "PLAN_VIOLATION",
    objectType: "tenant",
    objectId: ctx.tenantId,
    decision: "DENY",
    reasonCode: "UNDEFINED_LIMIT",
    factsSnapshot: {
      plan: plan.name,
      resourceType,
      attemptedAction,
      limit: null,
    },
  },
  ctx.env,
  ctx.cfctx
);
    throw new PlanEnforcementError("UNDEFINED_LIMIT", "Plan limit undefined. Fail-closed.", {
      plan: plan.name,
      resourceType,
    });
  }

  const current = getCurrentCountOrThrow(col, resourceType);

  let attempted = null;
  if (Number.isFinite(attemptedValue)) attempted = attemptedValue;
  else if (Number.isFinite(delta)) attempted = current + delta;

  if (!Number.isFinite(attempted)) {
    throw new PlanEnforcementError(
      "AMBIGUOUS_ATTEMPT",
      "Attempted usage could not be determined deterministically. Fail-closed.",
      { resourceType, current, attemptedValue, delta }
    );
  }

  if (attempted > limit) {
    emitAudit(
  ctx,
  {
    eventCategory: "SECURITY",
    eventType: "PLAN_VIOLATION",
    objectType: "tenant",
    objectId: ctx.tenantId,
    decision: "DENY",
    reasonCode: "LIMIT_EXCEEDED",
    factsSnapshot: {
      plan: plan.name,
      resourceType,
      limit,
      attempted,
      attemptedAction,
    },
  },
  ctx.env,
  ctx.cfctx
);

    throw new PlanEnforcementError("PLAN_LIMIT_EXCEEDED", "Plan limit exceeded. Operation blocked.", {
      tenantId: ctx.tenantId,
      plan: plan.name,
      resourceType,
      limit,
      attempted,
      attemptedAction,
    });
  }

  return { ok: true, current, attempted, limit };
}
