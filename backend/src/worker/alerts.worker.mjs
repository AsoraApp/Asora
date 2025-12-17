import { loadTenantCollection, saveTenantCollection } from "../storage/jsonStore.worker.mjs";
import { nowUtcIso } from "../domain/time/utc.mjs";
import { emitAudit } from "../observability/audit.mjs";
import { validateAlertRuleInput } from "../domain/alerts/validateRule.mjs";
import { evaluateAlertsOnce } from "../domain/alerts/evaluate.mjs";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function parsePath(pathname) {
  return (pathname || "/").replace(/\/+$/g, "") || "/";
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

export async function alertsFetchRouter(ctx, request, baseHeaders, cfctx) {
  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  if (!pathname.startsWith("/api/alerts")) return null;
  if (!ctx?.tenantId) return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);

  // DEV (browser-friendly): create LOW_STOCK ITEM rule via query params
  if (method === "GET" && pathname === "/api/alerts/rules/dev-low-stock") {
    const itemId = u.searchParams.get("itemId");
    const thresholdQtyRaw = u.searchParams.get("thresholdQty");
    const enabledRaw = u.searchParams.get("enabled");
    const note = u.searchParams.get("note");

    const thresholdQty = thresholdQtyRaw === null ? NaN : Number(thresholdQtyRaw);
    const enabled = enabledRaw === null ? true : String(enabledRaw).toLowerCase() !== "false";

    const input = {
      type: "LOW_STOCK",
      scope: "ITEM",
      target: { itemId },
      params: { thresholdQty },
      enabled,
      note: note || null
    };

    const v = validateAlertRuleInput(input);
    if (!v.ok) return json(400, { error: "BAD_REQUEST", code: v.code, details: v.details || null }, baseHeaders);

    const rules = (await loadTenantCollection(ctx.tenantId, "alert_rules", [])) || [];
    const now = nowUtcIso();

    const rule = {
      ruleId: crypto.randomUUID(),
      createdAtUtc: now,
      updatedAtUtc: now,
      deletedAtUtc: null,
      enabled: input.enabled !== false,
      type: input.type,
      scope: input.scope,
      target: input.target,
      params: input.params,
      note: input.note
    };

    rules.push(rule);
    await saveTenantCollection(ctx.tenantId, "alert_rules", rules);

    emitAudit(ctx, {
      eventCategory: "ALERT",
      eventType: "ALERT_RULE_CREATE_DEV",
      objectType: "alert_rule",
      objectId: rule.ruleId,
      decision: "ALLOW",
      reasonCode: "CREATED",
      factsSnapshot: { type: rule.type, scope: rule.scope, enabled: rule.enabled, itemId }
    });

    // Non-blocking evaluation, reliable via waitUntil
    try {
      const p = evaluateAlertsOnce(ctx.tenantId, "DEV_RULE_CREATED");
      if (cfctx && typeof cfctx.waitUntil === "function") cfctx.waitUntil(p);
    } catch {
      // swallow
    }

    return json(201, { rule }, baseHeaders);
  }

  // GET /api/alerts/rules
  if (method === "GET" && pathname === "/api/alerts/rules") {
    const rules = (await loadTenantCollection(ctx.tenantId, "alert_rules", [])) || [];
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

    const rules = (await loadTenantCollection(ctx.tenantId, "alert_rules", [])) || [];
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

    // Non-blocking evaluation, reliable via waitUntil
    try {
      const p = evaluateAlertsOnce(ctx.tenantId, "RULE_CREATED");
      if (cfctx && typeof cfctx.waitUntil === "function") cfctx.waitUntil(p);
    } catch {
      // swallow
    }

    return json(201, { rule }, baseHeaders);
  }

  // GET /api/alerts
  if (method === "GET" && pathname === "/api/alerts") {
    const status = (u.searchParams.get("status") || "").toUpperCase() || null;
    if (status && !["OPEN", "ACKNOWLEDGED", "CLOSED"].includes(status)) {
      return json(400, { error: "BAD_REQUEST", code: "INVALID_STATUS_FILTER", details: { status } }, baseHeaders);
    }

    const alerts = (await loadTenantCollection(ctx.tenantId, "alerts", [])) || [];
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
