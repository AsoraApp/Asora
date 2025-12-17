// backend/src/api/admin/tenantPlan.worker.mjs
// Server-controlled admin endpoint to set tenant plan deterministically.
// No client-supplied tenant switching. Requires existing admin authorization upstream.

import { setTenantPlan } from "../../domain/plans/planResolution.mjs";
import { PlanEnforcementError, isPlanEnforcementError } from "../../domain/plans/planErrors.mjs";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function handleSetTenantPlan(ctx, req, baseHeaders) {
  if (req.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED" }, baseHeaders);
  }

  // This endpoint assumes admin auth/permissions are already enforced upstream (B11).
  // Tenant is always session-derived; no overrides.
  const body = await readJson(req);
  const planName = body?.planName;

  try {
    const plan = await setTenantPlan(ctx, planName);
    return json(200, { ok: true, plan: plan.name }, baseHeaders);
  } catch (err) {
    if (isPlanEnforcementError(err)) {
      return json(403, { error: "FORBIDDEN", code: err.code, details: err.details || null }, baseHeaders);
    }
    return json(500, { error: "INTERNAL", code: "UNHANDLED_ERROR", details: null }, baseHeaders);
  }
}

export default {
  async handle(ctx, req, baseHeaders) {
    return handleSetTenantPlan(ctx, req, baseHeaders);
  },
};
