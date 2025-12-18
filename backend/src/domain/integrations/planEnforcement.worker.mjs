// backend/src/domain/integrations/planEnforcement.worker.mjs
// Fail-closed: if plan limits cannot be resolved, deny.
export function getPlanLimitsOrThrow(ctx) {
  const limits =
    ctx?.plan?.limits ||
    ctx?.tenantPlan?.limits ||
    ctx?.limits ||
    ctx?.planLimits ||
    null;

  if (!limits || typeof limits !== "object") {
    const err = new Error("PLAN_LIMITS_REQUIRED");
    err.code = "PLAN_LIMITS_REQUIRED";
    throw err;
  }
  return limits;
}

export function enforcePlanIntegrationCountOrThrow(ctx, currentCount) {
  const limits = getPlanLimitsOrThrow(ctx);
  const max = Number(limits?.integrations);
  if (!Number.isFinite(max)) {
    const err = new Error("PLAN_INTEGRATIONS_LIMIT_REQUIRED");
    err.code = "PLAN_INTEGRATIONS_LIMIT_REQUIRED";
    throw err;
  }
  if (currentCount >= max) {
    const err = new Error("PLAN_LIMIT_EXCEEDED_INTEGRATIONS");
    err.code = "PLAN_LIMIT_EXCEEDED_INTEGRATIONS";
    err.details = { limit: max, current: currentCount };
    throw err;
  }
}
