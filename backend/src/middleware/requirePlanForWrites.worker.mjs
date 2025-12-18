// backend/src/middleware/requirePlanForWrites.worker.mjs
// Write-path only gate: ensures tenant resolves to exactly one known plan. Fail-closed.
// Does NOT enforce numeric limits by itself; it only blocks missing/unknown plan on writes.

import { nowUtcIso } from "../domain/time/utc.mjs";
import { emitAudit } from "../observability/audit.mjs";
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

export async function requirePlanForWrites(ctx, req, baseHeaders) {
  if (!isWriteMethod(req?.method)) return { ok: true };

  try {
    await resolveTenantPlanOrThrow(ctx, `${req.method || "UNKNOWN"} ${new URL(req.url).pathname}`);
    return { ok: true };
  } catch (err) {
    if (isPlanEnforcementError(err)) {
      // Audit already emitted by resolver on missing/unknown plan; still emit a generic blocked write audit fact.
      await emitAudit(ctx, {
        action: "write.blocked",
        atUtc: nowUtcIso(),
        tenantId: ctx?.tenantId || null,
        reason: err.code,
        path: (() => {
          try {
            return new URL(req.url).pathname;
          } catch {
            return null;
          }
        })(),
        method: req?.method || null,
      });

      // Deterministic fail-closed response
      return json(403, { error: "FORBIDDEN", code: err.code, details: err.details || null }, baseHeaders);
    }

    await emitAudit(ctx, {
      action: "write.blocked",
      atUtc: nowUtcIso(),
      tenantId: ctx?.tenantId || null,
      reason: "PLAN_ENFORCEMENT_ERROR",
      path: (() => {
        try {
          return new URL(req.url).pathname;
        } catch {
          return null;
        }
      })(),
      method: req?.method || null,
    });

    return json(403, { error: "FORBIDDEN", code: "PLAN_ENFORCEMENT_ERROR", details: null }, baseHeaders);
  }
}
