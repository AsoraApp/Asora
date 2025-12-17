const url = require("url");

const { emitAudit } = require("../observability/audit");
const { loadTenantCollection } = require("../storage/jsonStore");

function send(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function badRequest(res, code, details) {
  return send(res, 400, { error: "BAD_REQUEST", code, details: details || null });
}
function forbidden(res, code, details) {
  return send(res, 403, { error: "FORBIDDEN", code, details: details || null });
}

function parsePath(pathname) {
  return pathname.replace(/\/+$/g, "") || "/";
}

/**
 * Read-only MVP notifications.
 * Deterministic ordering: newest first.
 */
async function notificationsRouter(ctx, req, res) {
  if (!ctx || !ctx.tenantId) return forbidden(res, "TENANT_REQUIRED");

  const u = url.parse(req.url, true);
  const pathname = parsePath(u.pathname || "/");
  const method = (req.method || "GET").toUpperCase();

  if (method !== "GET" || pathname !== "/api/notifications") return false;

  const q = u.query || {};
  const limit = q.limit ? Number(q.limit) : 200;
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    return badRequest(res, "INVALID_LIMIT", { limit });
  }

  const notifications = (await loadTenantCollection(ctx.tenantId, "notifications")) || [];
  const out = notifications
    .slice()
    .sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? 1 : -1))
    .slice(0, limit);

  emitAudit(ctx, {
    eventCategory: "ALERT",
    eventType: "NOTIFICATIONS_LIST",
    objectType: "notification",
    objectId: null,
    decision: "ALLOW",
    reasonCode: "OK",
    factsSnapshot: { count: out.length },
  });

  return send(res, 200, { notifications: out });
}

module.exports = notificationsRouter;
