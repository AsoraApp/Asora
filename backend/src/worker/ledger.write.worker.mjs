// backend/src/worker/ledger.write.worker.mjs

import { loadTenantCollection, saveTenantCollection } from "../storage/jsonStore.worker.mjs";
import { nowUtcIso } from "../domain/time/utc.mjs";
import { emitAudit } from "../observability/audit.worker.mjs";
import { evaluateAlertsOnce } from "../domain/alerts/evaluate.mjs";

const KNOWN_AUTH_LEVELS = new Set(["user", "service", "system", "dev"]);
const LEDGER_WRITE_ALLOWED = new Set(["service", "system", "dev"]);

// Deterministic route/method facts for this execution path (no inference).
// NOTE: router normalizes /v1/* to /api/*, so writes land here.
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

function stableLedgerEventId(ctx, event) {
  // Ledger event IDs must be replay-safe and deterministic.
  // Using tenantId + requestId + a stable projection of the event payload.
  const tenantId = ctx?.tenantId ?? "";
  const requestId = ctx?.requestId ?? "";

  const fp = [
    tenantId,
    requestId,
    String(event?.itemId ?? ""),
    String(event?.hubId ?? ""),
    String(event?.binId ?? ""),
    String(event?.qtyDelta ?? ""),
    String(event?.reasonCode ?? ""),
    String(event?.referenceType ?? ""),
    String(event?.referenceId ?? ""),
    String(event?.note ?? ""),
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
    // swallow (observability must never break execution)
  }
}

function enforceLedgerWriteAuthorizationOrReturn(ctx, baseHeaders, env, cfctx) {
  // Must be authenticated, tenant must already be session-derived.
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

export async function writeLedgerEventFromJson(ctx, input, baseHeaders, cfctx, env) {
  // U11: explicit authorization boundary for ledger writes (fail-closed)
  const denial = enforceLedgerWriteAuthorizationOrReturn(ctx, baseHeaders, env, cfctx);
  if (denial) return denial;

  // Tenant guard (fail-closed)
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
  if (input.hubId !== undefined && typeof input.hubId !== "string") {
    return json(400, { error: "BAD_REQUEST", code: "INVALID_HUB_ID", details: null }, baseHeaders);
  }
  if (input.binId !== undefined && typeof input.binId !== "string") {
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
    reasonCode: typeof input.reasonCode === "string" ? input.reasonCode : "UNSPECIFIED",
    referenceType: typeof input.referenceType === "string" ? input.referenceType : null,
    referenceId: typeof input.referenceId === "string" ? input.referenceId : null,
    note: typeof input.note === "string" ? input.note : null,
  };

  const ledgerEventId = stableLedgerEventId(ctx, eventCore);

  const event = {
    ledgerEventId,
    ...eventCore,
  };

  // Append-only persistence
  const events = (await loadTenantCollection(env, ctx.tenantId, "ledger_events", [])) || [];
  const rows = Array.isArray(events) ? events : [];

  rows.push(event);
  await saveTenantCollection(env, ctx.tenantId, "ledger_events", rows);

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
