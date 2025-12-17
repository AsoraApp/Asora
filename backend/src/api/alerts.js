const crypto = require("crypto");
const url = require("url");

const { emitAudit } = require("../observability/audit");
const { loadTenantCollection, saveTenantCollection } = require("../storage/jsonStore");
const { nowUtcIso } = require("../domain/time/utc");
const { validateAlertRuleInput } = require("../domain/alerts/validateRule");
const { evaluateAlertsAsync } = require("../domain/alerts/evaluate");

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
function notFound(res, code) {
  return send(res, 404, { error: "NOT_FOUND", code });
}
function conflict(res, code, details) {
  return send(res, 409, { error: "CONFLICT", code, details: details || null });
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve("__INVALID_JSON__");
      }
    });
  });
}

function parsePath(pathname) {
  return pathname.replace(/\/+$/g, "") || "/";
}

async function listRules(ctx, res) {
  const rules = await loadTenantCollection(ctx.tenantId, "alert_rules");
  const out = (rules || []).filter((r) => !r.deletedAtUtc);
  emitAudit(ctx, {
    eventCategory: "ALERT",
    eventType: "ALERT_RULES_LIST",
    objectType: "alert_rule",
    objectId: null,
    decision: "ALLOW",
    reasonCode: "OK",
    factsSnapshot: { count: out.length },
  });
  return send(res, 200, { rules: out });
}

async function createRule(ctx, req, res) {
  const body = await readJsonBody(req);
  if (body === "__INVALID_JSON__") return badRequest(res, "INVALID_JSON");
  const input = body || {};
  const v = validateAlertRuleInput(input);
  if (!v.ok) return badRequest(res, v.code, v.details);

  const rules = (await loadTenantCollection(ctx.tenantId, "alert_rules")) || [];
  const now = nowUtcIso();

  const rule = {
    ruleId: crypto.randomUUID(),
    createdAtUtc: now,
    updatedAtUtc: now,
    deletedAtUtc: null,
    enabled: input.enabled !== false, // default true
    type: input.type, // LOW_STOCK | STOCKOUT | OVER_RECEIPT
    scope: input.scope, // ITEM | BIN | HUB | AGGREGATE | PO_LINE
    target: input.target || null, // { itemId?, hubId?, binId?, poId?, poLineId? }
    params: input.params || {}, // { thresholdQty?, ... }
    note: input.note || null,
  };

  rules.push(rule);
  await saveTenantCollection(ctx.tenantId, "alert_rules", rules);

  emitAudit(ctx, {
    eventCategory: "ALERT",
    eventType: "ALERT_RULE_CREATE",
    objectType: "alert_rule",
    objectId: rule.ruleId,
    decision: "ALLOW",
    reasonCode: "CREATED",
    factsSnapshot: { type: rule.type, scope: rule.scope, enabled: rule.enabled },
  });

  // Observer-only: best-effort evaluate to potentially generate alerts from committed facts.
  evaluateAlertsAsync(ctx.tenantId, "RULE_CREATED").catch(() => {});

  return send(res, 201, { rule });
}

async function updateRule(ctx, req, res, ruleId) {
  const body = await readJsonBody(req);
  if (body === "__INVALID_JSON__") return badRequest(res, "INVALID_JSON");
  const input = body || {};
  const v = validateAlertRuleInput(input, { allowPartial: true });
  if (!v.ok) return badRequest(res, v.code, v.details);

  const rules = (await loadTenantCollection(ctx.tenantId, "alert_rules")) || [];
  const idx = rules.findIndex((r) => r.ruleId === ruleId);
  if (idx === -1) return notFound(res, "RULE_NOT_FOUND");
  if (rules[idx].deletedAtUtc) return conflict(res, "RULE_DELETED", { ruleId });

  const now = nowUtcIso();
  const next = { ...rules[idx] };

  // Only allow explicit, deterministic fields.
  if (typeof input.enabled === "boolean") next.enabled = input.enabled;
  if (typeof input.note === "string" || input.note === null) next.note = input.note;

  if (typeof input.type === "string") next.type = input.type;
  if (typeof input.scope === "string") next.scope = input.scope;
  if (input.target !== undefined) next.target = input.target;
  if (input.params !== undefined) next.params = input.params;

  // Re-validate full object after merge.
  const v2 = validateAlertRuleInput(
    {
      type: next.type,
      scope: next.scope,
      target: next.target,
      params: next.params,
      enabled: next.enabled,
      note: next.note,
    },
    { requireAll: true }
  );
  if (!v2.ok) return badRequest(res, v2.code, v2.details);

  next.updatedAtUtc = now;
  rules[idx] = next;
  await saveTenantCollection(ctx.tenantId, "alert_rules", rules);

  emitAudit(ctx, {
    eventCategory: "ALERT",
    eventType: "ALERT_RULE_UPDATE",
    objectType: "alert_rule",
    objectId: ruleId,
    decision: "ALLOW",
    reasonCode: "UPDATED",
    factsSnapshot: { type: next.type, scope: next.scope, enabled: next.enabled },
  });

  evaluateAlertsAsync(ctx.tenantId, "RULE_UPDATED").catch(() => {});

  return send(res, 200, { rule: next });
}

async function softDeleteRule(ctx, res, ruleId) {
  const rules = (await loadTenantCollection(ctx.tenantId, "alert_rules")) || [];
  const idx = rules.findIndex((r) => r.ruleId === ruleId);
  if (idx === -1) return notFound(res, "RULE_NOT_FOUND");
  if (rules[idx].deletedAtUtc) return conflict(res, "RULE_ALREADY_DELETED", { ruleId });

  const now = nowUtcIso();
  rules[idx] = { ...rules[idx], deletedAtUtc: now, updatedAtUtc: now, enabled: false };
  await saveTenantCollection(ctx.tenantId, "alert_rules", rules);

  emitAudit(ctx, {
    eventCategory: "ALERT",
    eventType: "ALERT_RULE_DELETE",
    objectType: "alert_rule",
    objectId: ruleId,
    decision: "ALLOW",
    reasonCode: "SOFT_DELETED",
    factsSnapshot: {},
  });

  return send(res, 200, { ok: true });
}

async function listAlerts(ctx, req, res) {
  const q = url.parse(req.url, true).query || {};
  const status = q.status ? String(q.status).toUpperCase() : null; // OPEN | ACKNOWLEDGED | CLOSED
  const limit = q.limit ? Number(q.limit) : 200;

  if (status && !["OPEN", "ACKNOWLEDGED", "CLOSED"].includes(status)) {
    return badRequest(res, "INVALID_STATUS_FILTER", { status });
  }
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    return badRequest(res, "INVALID_LIMIT", { limit });
  }

  const alerts = (await loadTenantCollection(ctx.tenantId, "alerts")) || [];
  const out = alerts
    .filter((a) => (status ? a.status === status : true))
    .sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? 1 : -1))
    .slice(0, limit);

  emitAudit(ctx, {
    eventCategory: "ALERT",
    eventType: "ALERTS_LIST",
    objectType: "alert",
    objectId: null,
    decision: "ALLOW",
    reasonCode: "OK",
    factsSnapshot: { count: out.length, status: status || "ANY" },
  });

  return send(res, 200, { alerts: out });
}

async function getAlert(ctx, res, alertId) {
  const alerts = (await loadTenantCollection(ctx.tenantId, "alerts")) || [];
  const found = alerts.find((a) => a.alertId === alertId);
  if (!found) return notFound(res, "ALERT_NOT_FOUND");

  emitAudit(ctx, {
    eventCategory: "ALERT",
    eventType: "ALERT_GET",
    objectType: "alert",
    objectId: alertId,
    decision: "ALLOW",
    reasonCode: "OK",
    factsSnapshot: { status: found.status },
  });

  return send(res, 200, { alert: found });
}

async function acknowledge(ctx, res, alertId) {
  const alerts = (await loadTenantCollection(ctx.tenantId, "alerts")) || [];
  const idx = alerts.findIndex((a) => a.alertId === alertId);
  if (idx === -1) return notFound(res, "ALERT_NOT_FOUND");

  const cur = alerts[idx];
  if (cur.status === "CLOSED") return conflict(res, "ALERT_CLOSED_IMMUTABLE", { alertId });
  if (cur.status === "ACKNOWLEDGED") return conflict(res, "ALERT_ALREADY_ACKNOWLEDGED", { alertId });

  const now = nowUtcIso();
  const next = {
    ...cur,
    status: "ACKNOWLEDGED",
    acknowledgedAtUtc: now,
    acknowledgedByUserId: ctx.userId || null,
    updatedAtUtc: now,
  };

  alerts[idx] = next;
  await saveTenantCollection(ctx.tenantId, "alerts", alerts);

  emitAudit(ctx, {
    eventCategory: "ALERT",
    eventType: "ALERT_ACK",
    objectType: "alert",
    objectId: alertId,
    decision: "ALLOW",
    reasonCode: "ACKNOWLEDGED",
    factsSnapshot: {},
  });

  return send(res, 200, { alert: next });
}

async function close(ctx, res, alertId) {
  const alerts = (await loadTenantCollection(ctx.tenantId, "alerts")) || [];
  const idx = alerts.findIndex((a) => a.alertId === alertId);
  if (idx === -1) return notFound(res, "ALERT_NOT_FOUND");

  const cur = alerts[idx];
  if (cur.status === "CLOSED") return conflict(res, "ALERT_ALREADY_CLOSED", { alertId });

  const now = nowUtcIso();
  const next = {
    ...cur,
    status: "CLOSED",
    closedAtUtc: now,
    closedByUserId: ctx.userId || null,
    updatedAtUtc: now,
  };

  alerts[idx] = next;
  await saveTenantCollection(ctx.tenantId, "alerts", alerts);

  emitAudit(ctx, {
    eventCategory: "ALERT",
    eventType: "ALERT_CLOSE",
    objectType: "alert",
    objectId: alertId,
    decision: "ALLOW",
    reasonCode: "CLOSED",
    factsSnapshot: {},
  });

  return send(res, 200, { alert: next });
}

/**
 * Router: returns true if handled.
 */
async function alertsRouter(ctx, req, res) {
  if (!ctx || !ctx.tenantId) return forbidden(res, "TENANT_REQUIRED");

  const u = url.parse(req.url);
  const pathname = parsePath(u.pathname || "/");
  const method = (req.method || "GET").toUpperCase();

  // Rules
  if (method === "GET" && pathname === "/api/alerts/rules") return listRules(ctx, res);
  if (method === "POST" && pathname === "/api/alerts/rules") return createRule(ctx, req, res);

  const ruleMatch = pathname.match(/^\/api\/alerts\/rules\/([^/]+)$/);
  if (ruleMatch) {
    const ruleId = ruleMatch[1];
    if (method === "PUT") return updateRule(ctx, req, res, ruleId);
    if (method === "DELETE") return softDeleteRule(ctx, res, ruleId);
  }

  // Alerts
  if (method === "GET" && pathname === "/api/alerts") return listAlerts(ctx, req, res);

  const alertMatch = pathname.match(/^\/api\/alerts\/([^/]+)$/);
  if (alertMatch && method === "GET") {
    return getAlert(ctx, res, alertMatch[1]);
  }

  const ackMatch = pathname.match(/^\/api\/alerts\/([^/]+)\/acknowledge$/);
  if (ackMatch && method === "POST") {
    return acknowledge(ctx, res, ackMatch[1]);
  }

  const closeMatch = pathname.match(/^\/api\/alerts\/([^/]+)\/close$/);
  if (closeMatch && method === "POST") {
    return close(ctx, res, closeMatch[1]);
  }

  return false;
}

module.exports = alertsRouter;
