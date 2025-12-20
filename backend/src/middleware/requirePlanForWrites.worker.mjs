// backend/src/middleware/requirePlanForWrites.worker.mjs
// Write-path only gate: ensures tenant resolves to exactly one known plan. Fail-closed.
// Does NOT enforce numeric limits by itself; it only blocks missing/unknown plan on writes.

import { nowUtcIso } from "../domain/time/utc.mjs";
import { emitAudit } from "../observability/audit.worker.mjs";
import { resolveTenantPlanOrThrow } from "../domain/plans/planResolution.mjs";
import { isPlanEnforcementError } from "../domain/plans/planErrors.mjs";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function isWriteMethod(method) {
  const m = String(method || "").toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

function safePath(req) {
  try {
    return new URL(req.url).pathname;
  } catch {
    return null;
  }
}

function routeLabel(req) {
  const method = String(req?.method || "UNKNOWN").toUpperCase();
  const path = safePath(req);
  return `${method} ${path || "UNKNOWN_PATH"}`;
}

/**
 * Worker middleware. env + cfctx required (audit is persisted via KV).
 * Returns:
 * - { ok: true } when allowed
 * - Response when blocked (fail-closed)
 */
export async function requirePlanForWrites(ctx, req, baseHeaders, cfctx, env) {
  if (!isWriteMethod(req?.method)) return { ok: true };

  const path = safePath(req);
  const method = req?.method || null;

  try {
    await resolveTenantPlanOrThrow(ctx, routeLabel(req), env, cfctx);
    return { ok: true };
  } catch (err) {
    if (isPlanEnforcementError(err)) {
      // Resolver may emit audit, but we still record a deterministic "blocked write" fact.
      emitAudit(
        ctx,
        {
          eventCategory: "SECURITY",
          eventType: "WRITE_BLOCKED",
          objectType: "http_route",
          objectId: routeLabel(req),
          decision: "DENY",
          reasonCode: err.code,
          factsSnapshot: {
            atUtc: nowUtcIso(),
            tenantId: ctx?.tenantId || null,
            path,
            method,
            details: err.details || null,
          },
        },
        env,
        cfctx
      );

      return json(403, { error: "FORBIDDEN", code: err.code, details: err.details || null }, baseHeaders);
    }

    emitAudit(
      ctx,
      {
        eventCategory: "SECURITY",
        eventType: "WRITE_BLOCKED",
        objectType: "http_route",
        objectId: routeLabel(req),
        decision: "DENY",
        reasonCode: "PLAN_ENFORCEMENT_ERROR",
        factsSnapshot: {
          atUtc: nowUtcIso(),
          tenantId: ctx?.tenantId || null,
          path,
          method,
        },
      },
      env,
      cfctx
    );

    return json(403, { error: "FORBIDDEN", code: "PLAN_ENFORCEMENT_ERROR", details: null }, baseHeaders);
  }
}
