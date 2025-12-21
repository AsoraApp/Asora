// backend/src/worker/ledger.write.worker.mjs

import { loadTenantCollection, saveTenantCollection } from "../storage/jsonStore.worker.mjs";
import { nowUtcIso } from "../domain/time/utc.mjs";
import { emitAudit } from "../observability/audit.worker.mjs";
import { evaluateAlertsOnce } from "../domain/alerts/evaluate.mjs";

const KNOWN_AUTH_LEVELS = new Set(["user", "service", "system", "dev"]);
const LEDGER_WRITE_ALLOWED = new Set(["service", "system", "dev"]);

// Deterministic route/method facts for this execution path (no inference).
const LEDGER_WRITE_ROUTE = "/api/ledger/events";
const LEDGER_WRITE_METHOD = "POST";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function authzEnvelope(code, details) {
  return { error: "FORBIDDEN", code, details: details ?? null };
}

/**
 * Deterministic FNV-1a 32-bit hash.
 * - Pure + deterministic
 * - Returns lowercase 8-hex string
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

function clampString(v, maxLen) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function stableLedgerEventId(ctx, eventCore) {
  // U13: Prefer reference-based stability for replay safety.
  // If referenceType+referenceId are provided, they become the stable idempotency basis.
  // Otherwise, fall back to requestId for uniqueness (best possible without adding new required fields).
  const tenantId = ctx?.tenantId ?? "";
  const requestId = ctx?.requestId ?? "";

  const refType = String(eventCore?.referenceType ?? "");
  const refId = String(eventCore?.referenceId ?? "");
  const hasStableRef = !!(refType && refId);

  const fp = [
    tenantId,
    hasStableRef ? "REF" : "REQ",
    hasStableRef ? `${refType}:${refId}` : requestId,
    String(eventCore?.itemId ?? ""),
    String(eventCore?.hubId ?? ""),
    String(eventCore?.binId ?? ""),
    String(eventCore?.qtyDelta ?? ""),
    String(eventCore?.reasonCode ?? ""),
    String(eventCore?.note ?? ""),
  ].join("|");

  return `le_${fnv1a32Hex(fp)}`;
}

function emitAuthzDeniedAudit(ctx, code, details, env, cfctx) {
  try {
    emitAudit(
      ctx,
      {
        eventCategory: "SECURITY",
        eventType: "AUTHZ_DENIED",
        objectType: "http_route",
        objectId: `${LEDGER_WRITE_METHOD} ${LEDGER_WRITE_ROUTE}`,
        decision: "DENY",
        reasonCode: code,
        factsSnapshot: {
          actorId: ctx?.actorId ?? null,
          authLevel: ctx?.session?.authLevel ?? null,
          tenantId: ctx?.tenantId ?? null,
          route: LEDGER_WRITE_ROUTE,
          method: LEDGER_WRITE_METHOD,
          denial: details ?? null,
        },
      },
      env,
      cfctx
    );
  } catch {
    // swallow
  }
}

function enforceLedgerWriteAuthorizationOrReturn(ctx, baseHeaders, env, cfctx) {
  const authLevel = ctx?.session?.authLevel ?? null;

  if (!authLevel || !KNOWN_AUTH_LEVELS.has(authLevel)) {
    const details = { authLevel };
    emitAuthzDeniedAudit(ctx, "AUTHZ_INVALID_AUTH_LEVEL", details, env, cfctx);
    return json(403, authzEnvelope("AUTHZ_INVALID_AUTH_LEVEL", details), baseHeaders);
  }

  if (!LEDGER_WRITE_ALLOWED.has(authLevel)) {
    const details = {
      authLevel,
      capability: "LEDGER_WRITE",
      route: LEDGER_WRITE_ROUTE,
      method: LEDGER_WRITE_METHOD,
    };
    emitAuthzDeniedAudit(ctx, "AUTHZ_DENIED", details, env, cfctx);
    return json(403, authzEnvelope("AUTHZ_DENIED", details), baseHeaders);
  }

  return null;
}

async function safeLoad(env, tenantId, name, defaultValue) {
  try {
    return await loadTenantCollection(env, tenantId, name, defaultValue);
  } catch (e) {
    const code = e?.code || e?.message || "STORAGE_ERROR";
    if (code === "KV_NOT_BOUND") return { __err: { status: 503, error: "SERVICE_UNAVAILABLE", code: "KV_NOT_BOUND" } };
    if (code === "TENANT_NOT_RESOLVED")
      return { __err: { status: 403, error: "FORBIDDEN", code: "TENANT_REQUIRED" } };
    return { __err: { status: 500, error: "INTERNAL_ERROR", code: "STORAGE_ERROR" } };
  }
}

async function safeSave(env, tenantId, name, value) {
  try {
    await saveTenantCollection(env, tenantId, name, value);
    return { ok: true };
  } catch (e) {
    const code = e?.code || e?.message || "STORAGE_ERROR";
    if (code === "KV_NOT_BOUND") return { ok: false, status: 503, error: "SERVICE_UNAVAILABLE", code: "KV_NOT_BOUND" };
    if (code === "TENANT_NOT_RESOLVED") return { ok: false, status: 403, error: "FORBIDDEN", code: "TENANT_REQUIRED" };
    return { ok: false, status: 500, error: "INTERNAL_ERROR", code: "STORAGE_ERROR" };
  }
}

export async function writeLedgerEventFromJson(ctx, input, baseHeaders, cfctx, env) {
  const denial = enforceLedgerWriteAuthorizationOrReturn(ctx, baseHeaders, env, cfctx);
  if (denial) return denial;

  if (!ctx?.tenantId) {
    return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);
  }

  // Validation (fail-closed)
  if (!input || typeof input !== "object") {
    try {
      emitAudit(
        ctx,
        {
          eventCategory: "SECURITY",
          eventType: "VALIDATION_FAILED",
          objectType: "request",
          objectId: `${LEDGER_WRITE_METHOD} ${LEDGER_WRITE_ROUTE}`,
          decision: "DENY",
          reasonCode: "INVALID_BODY_OBJECT",
          factsSnapshot: { gotType: typeof input },
        },
        env,
        cfctx
      );
    } catch {
      // swallow
    }
    return json(400, { error: "BAD_REQUEST", code: "INVALID_BODY_OBJECT", details: null }, baseHeaders);
  }

  if (typeof input.itemId !== "string" || !input.itemId) {
    return json(400, { error: "BAD_REQUEST", code: "MISSING_ITEM_ID", details: null }, baseHeaders);
  }
  if (typeof input.qtyDelta !== "number" || !Number.isFinite(input.qtyDelta)) {
    return json(400, { error: "BAD_REQUEST", code: "INVALID_QTY_DELTA", details: null }, baseHeaders);
  }
  if (input.hubId !== undefined && input.hubId !== null && typeof input.hubId !== "string") {
    return json(400, { error: "BAD_REQUEST", code: "INVALID_HUB_ID", details: null }, baseHeaders);
  }
  if (input.binId !== undefined && input.binId !== null && typeof input.binId !== "string") {
    return json(400, { error: "BAD_REQUEST", code: "INVALID_BIN_ID", details: null }, baseHeaders);
  }

  const now = nowUtcIso();

  const eventCore = {
    tenantId: ctx.tenantId,
    createdAtUtc: now,
    itemId: input.itemId,
    hubId: typeof input.hubId === "string" ? input.hubId : null,
    binId: typeof input.binId === "string" ? input.binId : null,
    qtyDelta: input.qtyDelta,
    reasonCode: clampString(input.reasonCode, 64) || "UNSPECIFIED",
    referenceType: clampString(input.referenceType, 64),
    referenceId: clampString(input.referenceId, 128),
    note: clampString(input.note, 512),
  };

  const ledgerEventId = stableLedgerEventId(ctx, eventCore);

  const event = {
    ledgerEventId,
    ...eventCore,
  };

  // Append-only persistence (tenant-scoped)
  const loaded = await safeLoad(env, ctx.tenantId, "ledger_events", []);
  if (loaded && loaded.__err) {
    try {
      emitAudit(
        ctx,
        {
          eventCategory: "SYSTEM",
          eventType: "STORAGE_ERROR",
          objectType: "ledger_event",
          objectId: ledgerEventId,
          decision: "DENY",
          reasonCode: loaded.__err.code,
          factsSnapshot: { route: LEDGER_WRITE_ROUTE, method: LEDGER_WRITE_METHOD },
        },
        env,
        cfctx
      );
    } catch {
      // swallow
    }
    return json(loaded.__err.status, { error: loaded.__err.error, code: loaded.__err.code, details: null }, baseHeaders);
  }

  const events = loaded || [];
  const rows = Array.isArray(events) ? events : [];

  rows.push(event);

  const saved = await safeSave(env, ctx.tenantId, "ledger_events", rows);
  if (!saved.ok) {
    try {
      emitAudit(
        ctx,
        {
          eventCategory: "SYSTEM",
          eventType: "STORAGE_ERROR",
          objectType: "ledger_event",
          objectId: ledgerEventId,
          decision: "DENY",
          reasonCode: saved.code,
          factsSnapshot: { route: LEDGER_WRITE_ROUTE, method: LEDGER_WRITE_METHOD },
        },
        env,
        cfctx
      );
    } catch {
      // swallow
    }
    return json(saved.status, { error: saved.error, code: saved.code, details: null }, baseHeaders);
  }

  // Audit: append succeeded
  try {
    emitAudit(
      ctx,
      {
        eventCategory: "INVENTORY",
        eventType: "LEDGER_EVENT_APPEND",
        objectType: "ledger_event",
        objectId: event.ledgerEventId,
        decision: "ALLOW",
        reasonCode: "APPENDED",
        factsSnapshot: {
          itemId: event.itemId,
          qtyDelta: event.qtyDelta,
          hubId: event.hubId,
          binId: event.binId,
          referenceType: event.referenceType,
          referenceId: event.referenceId,
        },
      },
      env,
      cfctx
    );
  } catch {
    // swallow
  }

  // Non-blocking alert evaluation
  try {
    const p = evaluateAlertsOnce(ctx.tenantId, "LEDGER_EVENT_COMMITTED", event);
    if (cfctx && typeof cfctx.waitUntil === "function") cfctx.waitUntil(p);
  } catch {
    // swallow
  }

  return json(201, { event }, baseHeaders);
}
