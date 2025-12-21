// backend/src/worker/notifications.worker.mjs

import { loadTenantCollection } from "../storage/jsonStore.worker.mjs";
import { emitAudit } from "../observability/audit.worker.mjs";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function parsePath(pathname) {
  return (pathname || "/").replace(/\/+$/g, "") || "/";
}

function sortByCreatedAtDescThenId(arr) {
  return arr
    .slice()
    .sort((a, b) => {
      const at = String(a?.createdAtUtc ?? "");
      const bt = String(b?.createdAtUtc ?? "");
      if (at === bt) {
        const aid = String(a?.notificationId ?? a?.id ?? "");
        const bid = String(b?.notificationId ?? b?.id ?? "");
        return aid < bid ? 1 : aid > bid ? -1 : 0;
      }
      return at < bt ? 1 : -1;
    });
}

/**
 * GET /api/notifications
 * Worker router. env + cfctx required for storage + audit.
 */
export async function notificationsFetchRouter(ctx, request, baseHeaders, cfctx, env) {
  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  if (pathname !== "/api/notifications") return null;

  if (method !== "GET") {
    return json(405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED", details: null }, baseHeaders);
  }

  if (!ctx?.tenantId) {
    return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);
  }

  const notifications = (await loadTenantCollection(env, ctx.tenantId, "notifications", [])) || [];
  const arr = Array.isArray(notifications) ? notifications : [];
  const out = sortByCreatedAtDescThenId(arr);

  emitAudit(
    ctx,
    {
      eventCategory: "ALERT",
      eventType: "NOTIFICATIONS_LIST",
      objectType: "notification",
      objectId: null,
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { count: out.length },
    },
    env,
    cfctx
  );

  return json(200, { notifications: out }, baseHeaders);
}
