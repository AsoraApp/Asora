// backend/src/worker/ledger.write.worker.mjs

import { loadTenantCollection, saveTenantCollection } from "../storage/jsonStore.worker.mjs";
import { nowUtcIso } from "../domain/time/utc.mjs";
import { emitAudit } from "../observability/audit.worker.mjs";
import { evaluateAlertsOnce } from "../domain/alerts/evaluate.mjs";

import { validateLedgerEventWriteInput, validateStoredLedgerEventShape } from "../domain/ledgerEvent.schema.mjs";
import { computeLedgerEventId, computeNextLedgerSequence } from "../domain/ledgerEvent.identity.mjs";

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

  // U16: Canonical input validation (fail-closed, shape-frozen)
  const v = validateLedgerEventWriteInput(input);
  if (!v.ok) {
    try {
      emitAudit(
        ctx,
        {
          eventCategory: "SECURITY",
          eventType: "VALIDATION_FAILED",
          objectType: "request",
          objectId: `${LEDGER_WRITE_METHOD} ${LEDGER_WRITE_ROUTE}`,
          decision: "DENY",
          reasonCode: v.code,
          factsSnapshot: { details: v.details ?? null },
        },
        env,
        cfctx
      );
    } catch {
      // swallow
    }
    return json(400, { error: "BAD_REQUEST", code: v.code, details: v.details ?? null }, baseHeaders);
  }

  const now = nowUtcIso();

  // Core event facts (no interpretation)
  const eventCore = {
    tenantId: ctx.tenantId,
    createdAtUtc: now,

    itemId: v.value.itemId,
    hubId: v.value.hubId,
    binId: v.value.binId,
    qtyDelta: v.value.qtyDelta,

    reasonCode: v.value.reasonCode,
    referenceType: v.value.referenceType,
    referenceId: v.value.referenceId,
    note: v.value.note,

    // U16 optional lineage / causality (opaque)
    parent_event_id: v.value.parent_event_id,
    causal_chain_id: v.value.causal_chain_id,

    // U16 opaque external pointers (opaque)
    authorization_ref: v.value.authorization_ref,
    decision_ref: v.value.decision_ref,
    external_context_refs: v.value.external_context_refs,
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
          objectId: null,
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

  // U16: deterministic tenant ordering
  const sequence = computeNextLedgerSequence(rows);

  // U16: canonical event identity
  const event_id = computeLedgerEventId(ctx, eventCore);

  // U16: canonical stored shape (frozen)
  // Compatibility:
  // - Keep ledgerEventId as an alias to event_id so existing readers/sorters remain stable.
  const event = {
    event_id,
    ledgerEventId: event_id,
    sequence,
    ...eventCore,
  };

  // Defensive: ensure no unknown keys leak to persistence.
  const se = validateStoredLedgerEventShape(event);
  if (!se.ok) {
    try {
      emitAudit(
        ctx,
        {
          eventCategory: "SYSTEM",
          eventType: "VALIDATION_FAILED",
          objectType: "ledger_event",
          objectId: event_id,
          decision: "DENY",
          reasonCode: se.code,
          factsSnapshot: { details: se.details ?? null },
        },
        env,
        cfctx
      );
    } catch {
      // swallow
    }
    return json(500, { error: "INTERNAL_ERROR", code: se.code, details: se.details ?? null }, baseHeaders);
  }

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
          objectId: event_id,
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
        objectId: event.event_id,
        decision: "ALLOW",
        reasonCode: "APPENDED",
        factsSnapshot: {
          event_id: event.event_id,
          sequence: event.sequence,

          itemId: event.itemId,
          qtyDelta: event.qtyDelta,
          hubId: event.hubId,
          binId: event.binId,

          referenceType: event.referenceType,
          referenceId: event.referenceId,

          // opaque pointers included for traceability only (no interpretation)
          parent_event_id: event.parent_event_id,
          causal_chain_id: event.causal_chain_id,
          authorization_ref: event.authorization_ref,
          decision_ref: event.decision_ref,
          has_external_context_refs: Array.isArray(event.external_context_refs) ? event.external_context_refs.length : 0,
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
