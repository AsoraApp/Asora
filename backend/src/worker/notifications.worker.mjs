import { loadTenantCollection } from "../storage/jsonStore.worker.mjs";
import { emitAudit } from "../observability/audit.mjs";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function parsePath(pathname) {
  return (pathname || "/").replace(/\/+$/g, "") || "/";
}

export async function notificationsFetchRouter(ctx, request, baseHeaders) {
  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  if (pathname !== "/api/notifications") return null;
  if (method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED" }, baseHeaders);
  if (!ctx?.tenantId) return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);

  const notifications = (await loadTenantCollection(ctx.tenantId, "notifications", [])) || [];
  const out = notifications.slice().sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? 1 : -1));

  emitAudit(ctx, {
    eventCategory: "ALERT",
    eventType: "NOTIFICATIONS_LIST",
    objectType: "notification",
    objectId: null,
    decision: "ALLOW",
    reasonCode: "OK",
    factsSnapshot: { count: out.length }
  });

  return json(200, { notifications: out }, baseHeaders);
}
