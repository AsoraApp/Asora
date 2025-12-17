const { emitAudit } = require("../observability/audit");
const { loadTenantCollection, saveTenantCollection } = require("../storage/jsonStore");
const { nowUtcIso } = require("../domain/time/utc");
const { validateAlertRuleInput } = require("../domain/alerts/validateRule");
const { evaluateAlertsAsync } = require("../domain/alerts/evaluate");

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return "__INVALID_JSON__";
  }
}

function parsePath(pathname) {
  return (pathname || "/").replace(/\/+$/g, "") || "/";
}

async function alertsFetchRouter(ctx, request, baseHeaders) {
  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  if (!pathname.startsWith("/api/alerts")) return null;
  if (!ctx || !ctx.tenantId) return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);

  // GET /api/alerts/rules
  if (method === "GET" && pathname === "/api/alerts/rules") {
    const rules = (await loadTenantCollection(ctx.tenantId, "alert_rules")) || [];
    const out = rules.filter((r) => !r.deletedAtUtc);

    emitAudit(ctx, {
      eventCategory: "ALERT",
      eventType: "ALERT_RULES_LIST",
      objectType: "alert_rule",
      objectId: null,
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { count: out.length }
    });

    return json(200, { rules: out }, baseHeaders);
  }

  // POST /api/alerts/rules
  if (method === "POST" && pathname === "/api/alerts/rules") {
    const body = await readJson(request);
    if (body === "__INVALID_JSON__") return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);

    const input = body || {};
    const v = validateAlertRuleInput(input);
    if (!v.ok) return json(400, { error: "BAD_REQUEST", code: v.code, details: v.details || null }, baseHeaders);

    const rules = (await loadTenantCollection(ctx.tenantId, "alert_rules")) || [];
    const now = nowUtcIso();

    const rule = {
      ruleId: crypto.randomUUID(),
      createdAtUtc: now,
      updatedAtUtc: now,
      deletedAtUtc: null,
      enabled: input.enabled !== false,
      type: input.type,
      scope: input.scope,
      target: input.target || null,
      params: input.params || {},
      note: input.note || null
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
      factsSnapshot: { type: rule.type, scope: rule.scope, enabled: rule.enabled }
    });

    evaluateAlertsAsync(ctx.tenantId, "RULE_CREATED").catch(() => {});
    return json(201, { rule }, baseHeaders);
  }

  // Alerts list
  if (method === "GET" && pathname === "/api/alerts") {
    const status = (u.searchParams.get("status") || "").toUpperCase() || null;
    if (status && !["OPEN", "ACKNOWLEDGED", "CLOSED"].includes(status)) {
      return json(400, { error: "BAD_REQUEST", code: "INVALID_STATUS_FILTER", details: { status } }, baseHeaders);
    }

    const alerts = (await loadTenantCollection(ctx.tenantId, "alerts")) || [];
    const out = alerts
      .filter((a) => (status ? a.status === status : true))
      .sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? 1 : -1));

    emitAudit(ctx, {
      eventCategory: "ALERT",
      eventType: "ALERTS_LIST",
      objectType: "alert",
      objectId: null,
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { count: out.length, status: status || "ANY" }
    });

    return json(200, { alerts: out }, baseHeaders);
  }

  return null;
}

module.exports = { alertsFetchRouter };
