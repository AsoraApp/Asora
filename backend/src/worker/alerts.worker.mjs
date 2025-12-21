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

function methodNotAllowed(baseHeaders) {
  return json(405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED", details: null }, baseHeaders);
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
 * Deterministic stable JSON stringify (sorted keys, recursive).
 * - No randomness
 * - Stable across runs for equivalent objects
 */
function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }

  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ":" + stableStringify(value[k]));
  }
  return "{" + parts.join(",") + "}";
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
  // U13: ruleId must NOT depend on requestId.
  // It should be stable for the same logical rule content within a tenant.
  const tenantId = ctx?.tenantId ?? "";
  const type = rule?.type ?? "";
  const scope = rule?.scope ?? "";
  const target = rule?.target ? stableStringify(rule.target) : "";
  const params = rule?.params ? stableStringify(rule.params) : "";
  const fp = `${tenantId}|${type}|${scope}|${target}|${params}`;
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

function isDev(ctx) {
  return ctx?.session?.isAuthenticated === true && ctx?.session?.authLevel === "dev";
}

function denyDevOnly(ctx, env, cfctx, baseHeaders, pathname, reasonCode) {
  emitAudit(
    ctx,
    {
      eventCategory: "SECURITY",
      eventType: "AUTHZ_DENIED",
      objectType: "alerts",
      objectId: pathname,
      decision: "DENY",
      reasonCode: reasonCode || "AUTHZ_DENIED",
      factsSnapshot: { authLevel: ctx?.session?.authLevel ?? null },
    },
    env,
    cfctx
  );
  return json(403, { error: "FORBIDDEN", code: "AUTHZ_DENIED", details: null }, baseHeaders);
}

async function safeLoad(env, tenantId, name, defaultValue) {
  try {
    return await loadTenantCollection(env, tenantId, name, defaultValue);
  } catch (e) {
    const code = e?.code || e?.message || "STORAGE_ERROR";
    // Deterministic fail-closed for infra issues
    if (code === "KV_NOT_BOUND") {
      return { __err: { status: 503, error: "SERVICE_UNAVAILABLE", code: "KV_NOT_BOUND" } };
    }
    if (code === "TENANT_NOT_RESOLVED") {
      return { __err: { status: 403, error: "FORBIDDEN", code: "TENANT_REQUIRED" } };
    }
    return { __err: { status: 500, error: "INTERNAL_ERROR", code: "STORAGE_ERROR" } };
  }
}

async function safeSave(env, tenantId, name, value) {
  try {
    await saveTenantCollection(env, tenantId, name, value);
    return { ok: true };
  } catch (e) {
    const code = e?.code || e?.message || "STORAGE_ERROR";
    if (code === "KV_NOT_BOUND") {
      return { ok: false, status: 503, error: "SERVICE_UNAVAILABLE", code: "KV_NOT_BOUND" };
    }
    if (code === "TENANT_NOT_RESOLVED") {
      return { ok: false, status: 403, error: "FORBIDDEN", code: "TENANT_REQUIRED" };
    }
    return { ok: false, status: 500, error: "INTERNAL_ERROR", code: "STORAGE_ERROR" };
  }
}

/**
 * Router for /api/alerts*
 * IMPORTANT: env is required because jsonStore.worker.mjs is env-plumbed.
 */
export async function alertsFetchRouter(ctx, request, baseHeaders, cfctx, env) {
  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  if (!pathname.startsWith("/api/alerts")) return null;
  if (!ctx?.tenantId) return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);

  // DEV: manual evaluation trigger (browser-friendly)
  // GET /api/alerts/dev/evaluate
  if (pathname === "/api/alerts/dev/evaluate") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    if (!isDev(ctx)) return denyDevOnly(ctx, env, cfctx, baseHeaders, pathname, "DEV_ONLY");

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
  if (pathname === "/api/alerts/rules/dev-low-stock") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    if (!isDev(ctx)) return denyDevOnly(ctx, env, cfctx, baseHeaders, pathname, "DEV_ONLY");

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

    const loaded = await safeLoad(env, ctx.tenantId, "alert_rules", []);
    if (loaded && loaded.__err) return json(loaded.__err.status, { error: loaded.__err.error, code: loaded.__err.code, details: null }, baseHeaders);

    const rules = loaded || [];
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
    const saved = await safeSave(env, ctx.tenantId, "alert_rules", arr);
    if (!saved.ok) return json(saved.status, { error: saved.error, code: saved.code, details: null }, baseHeaders);

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
  if (pathname === "/api/alerts/rules") {
    if (method === "GET") {
      const loaded = await safeLoad(env, ctx.tenantId, "alert_rules", []);
      if (loaded && loaded.__err) return json(loaded.__err.status, { error: loaded.__err.error, code: loaded.__err.code, details: null }, baseHeaders);

      const rules = loaded || [];
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

    if (method === "POST") {
      // U13: writes are dev-only
      if (!isDev(ctx)) return denyDevOnly(ctx, env, cfctx, baseHeaders, pathname, "DEV_ONLY");

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

      const loaded = await safeLoad(env, ctx.tenantId, "alert_rules", []);
      if (loaded && loaded.__err) return json(loaded.__err.status, { error: loaded.__err.error, code: loaded.__err.code, details: null }, baseHeaders);

      const rules = loaded || [];
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
      const saved = await safeSave(env, ctx.tenantId, "alert_rules", arr);
      if (!saved.ok) return json(saved.status, { error: saved.error, code: saved.code, details: null }, baseHeaders);

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

    return methodNotAllowed(baseHeaders);
  }

  // GET /api/alerts
  if (pathname === "/api/alerts") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);

    const status = (u.searchParams.get("status") || "").toUpperCase() || null;
    if (status && !["OPEN", "ACKNOWLEDGED", "CLOSED"].includes(status)) {
      return json(400, { error: "BAD_REQUEST", code: "INVALID_STATUS_FILTER", details: { status } }, baseHeaders);
    }

    const loaded = await safeLoad(env, ctx.tenantId, "alerts", []);
    if (loaded && loaded.__err) return json(loaded.__err.status, { error: loaded.__err.error, code: loaded.__err.code, details: null }, baseHeaders);

    const alerts = loaded || [];
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

  // For any other /api/alerts* path, explicitly return null (router fallthrough will 404)
  return null;
}
