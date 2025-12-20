// backend/src/worker/alerts.worker.mjs

import { loadTenantCollection, saveTenantCollection } from "../storage/jsonStore.worker.mjs";
import { nowUtcIso } from "../domain/time/utc.mjs";
import { emitAudit } from "../observability/audit.worker.mjs";
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

function waitUntilEval(cfctx, p) {
  try {
    if (cfctx && typeof cfctx.waitUntil === "function") cfctx.waitUntil(p);
  } catch {
    // swallow
  }
}

/**
 * Deterministic FNV-1a 32-bit hash.
 * Returns 8-hex string.
 */
function fnv1a32Hex(input) {
  const str = String(input ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function stableRuleId(ctx, rule) {
  const tenantId = ctx?.tenantId ?? "";
  const requestId = ctx?.requestId ?? "";
  const type = rule?.type ?? "";
  const scope = rule?.scope ?? "";
  const target = rule?.target ? JSON.stringify(rule.target) : "";
  const params = rule?.params ? JSON.stringify(rule.params) : "";
  const fp = `${tenantId}|${requestId}|${type}|${scope}|${target}|${params}`;
  return `ar_${fnv1a32Hex(fp)}`;
}

function sortByCreatedAtDescThenId(arr) {
  return arr
    .slice()
    .sort((a, b) => {
      const at = String(a?.createdAtUtc ?? "");
      const bt = String(b?.createdAtUtc ?? "");
      if (at === bt) {
        const aid = String(a?.ruleId ?? a?.alertId ?? "");
        const bid = String(b?.ruleId ?? b?.alertId ?? "");
        return aid < bid ? 1 : aid > bid ? -1 : 0;
      }
      return at < bt ? 1 : -1;
    });
}

/**
 * Router for /api/alerts*
 * IMPORTANT: env is required because jsonStore.worker.mjs is now env-plumbed.
 */
export async function alertsFetchRouter(ctx, request, baseHeaders, cfctx, env) {
  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  if (!pathname.startsWith("/api/alerts")) return null;
  if (!ctx?.tenantId) return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);

  // DEV: manual evaluation trigger (browser-friendly)
  // GET /api/alerts/dev/evaluate
  if (method === "GET" && pathname === "/api/alerts/dev/evaluate") {
    emitAudit(
      ctx,
      {
        eventCategory: "ALERT",
        eventType: "ALERT_EVALUATE_DEV_TRIGGER",
        objectType: "alerts",
        objectId: null,
        decision: "ALLOW",
        reasonCode: "SCHEDULED",
        factsSnapshot: { route: pathname, method },
      },
      env,
      cfctx
    );

    const p = evaluateAlertsOnce(ctx.tenantId, "DEV_MANUAL_TRIGGER");
    waitUntilEval(cfctx, p);

    return json(200, { ok: true, scheduled: true }, baseHeaders);
  }

  // DEV: create LOW_STOCK ITEM rule via query params
  // GET /api/alerts/rules/dev-low-stock?itemId=item-1&thresholdQty=5&enabled=true&note=...
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
      note: note || null,
    };

    const v = validateAlertRuleInput(input);
    if (!v.ok) {
      emitAudit(
        ctx,
        {
          eventCategory: "SECURITY",
          eventType: "VALIDATION_FAILED",
          objectType: "alert_rule",
          objectId: null,
          decision: "DENY",
          reasonCode: v.code,
          factsSnapshot: { details: v.details || null },
        },
        env,
        cfctx
      );
      return json(400, { error: "BAD_REQUEST", code: v.code, details: v.details || null }, baseHeaders);
    }

    const rules = (await loadTenantCollection(env, ctx.tenantId, "alert_rules", [])) || [];
    const arr = Array.isArray(rules) ? rules : [];
    const now = nowUtcIso();

    const ruleDraft = {
      createdAtUtc: now,
      updatedAtUtc: now,
      deletedAtUtc: null,
      enabled: input.enabled !== false,
      type: input.type,
      scope: input.scope,
      target: input.target,
      params: input.params,
      note: input.note,
    };

    const rule = { ruleId: stableRuleId(ctx, ruleDraft), ...ruleDraft };

    arr.push(rule);
    await saveTenantCollection(env, ctx.tenantId, "alert_rules", arr);

    emitAudit(
      ctx,
      {
        eventCategory: "ALERT",
        eventType: "ALERT_RULE_CREATE_DEV",
        objectType: "alert_rule",
        objectId: rule.ruleId,
        decision: "ALLOW",
        reasonCode: "CREATED",
        factsSnapshot: { type: rule.type, scope: rule.scope, enabled: rule.enabled, itemId },
      },
      env,
      cfctx
    );

    waitUntilEval(cfctx, evaluateAlertsOnce(ctx.tenantId, "DEV_RULE_CREATED"));

    return json(201, { rule }, baseHeaders);
  }

  // GET /api/alerts/rules
  if (method === "GET" && pathname === "/api/alerts/rules") {
    const rules = (await loadTenantCollection(env, ctx.tenantId, "alert_rules", [])) || [];
    const arr = Array.isArray(rules) ? rules : [];
    const out = arr.filter((r) => r && !r.deletedAtUtc);

    emitAudit(
      ctx,
      {
        eventCategory: "ALERT",
        eventType: "ALERT_RULES_LIST",
        objectType: "alert_rule",
        objectId: null,
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: { count: out.length },
      },
      env,
      cfctx
    );

    return json(200, { rules: out }, baseHeaders);
  }

  // POST /api/alerts/rules
  if (method === "POST" && pathname === "/api/alerts/rules") {
    const body = await readJson(request);
    if (body === "__INVALID_JSON__") {
      emitAudit(
        ctx,
        {
          eventCategory: "SECURITY",
          eventType: "VALIDATION_FAILED",
          objectType: "request",
          objectId: pathname,
          decision: "DENY",
          reasonCode: "INVALID_JSON",
          factsSnapshot: { method, path: pathname },
        },
        env,
        cfctx
      );
      return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);
    }

    const input = body || {};
    const v = validateAlertRuleInput(input);
    if (!v.ok) {
      emitAudit(
        ctx,
        {
          eventCategory: "SECURITY",
          eventType: "VALIDATION_FAILED",
          objectType: "alert_rule",
          objectId: null,
          decision: "DENY",
          reasonCode: v.code,
          factsSnapshot: { details: v.details || null },
        },
        env,
        cfctx
      );
      return json(400, { error: "BAD_REQUEST", code: v.code, details: v.details || null }, baseHeaders);
    }

    const rules = (await loadTenantCollection(env, ctx.tenantId, "alert_rules", [])) || [];
    const arr = Array.isArray(rules) ? rules : [];
    const now = nowUtcIso();

    const ruleDraft = {
      createdAtUtc: now,
      updatedAtUtc: now,
      deletedAtUtc: null,
      enabled: input.enabled !== false,
      type: input.type,
      scope: input.scope,
      target: input.target || null,
      params: input.params || {},
      note: input.note || null,
    };

    const rule = { ruleId: stableRuleId(ctx, ruleDraft), ...ruleDraft };

    arr.push(rule);
    await saveTenantCollection(env, ctx.tenantId, "alert_rules", arr);

    emitAudit(
      ctx,
      {
        eventCategory: "ALERT",
        eventType: "ALERT_RULE_CREATE",
        objectType: "alert_rule",
        objectId: rule.ruleId,
        decision: "ALLOW",
        reasonCode: "CREATED",
        factsSnapshot: { type: rule.type, scope: rule.scope, enabled: rule.enabled },
      },
      env,
      cfctx
    );

    waitUntilEval(cfctx, evaluateAlertsOnce(ctx.tenantId, "RULE_CREATED"));

    return json(201, { rule }, baseHeaders);
  }

  // GET /api/alerts
  if (method === "GET" && pathname === "/api/alerts") {
    const status = (u.searchParams.get("status") || "").toUpperCase() || null;
    if (status && !["OPEN", "ACKNOWLEDGED", "CLOSED"].includes(status)) {
      return json(400, { error: "BAD_REQUEST", code: "INVALID_STATUS_FILTER", details: { status } }, baseHeaders);
    }

    const alerts = (await loadTenantCollection(env, ctx.tenantId, "alerts", [])) || [];
    const arr = Array.isArray(alerts) ? alerts : [];
    const out = sortByCreatedAtDescThenId(arr).filter((a) => (status ? a?.status === status : true));

    emitAudit(
      ctx,
      {
        eventCategory: "ALERT",
        eventType: "ALERTS_LIST",
        objectType: "alert",
        objectId: null,
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: { count: out.length, status: status || "ANY" },
      },
      env,
      cfctx
    );

    return json(200, { alerts: out }, baseHeaders);
  }

  return null;
}
