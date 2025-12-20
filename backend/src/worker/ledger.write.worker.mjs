// backend/src/worker/ledger.write.worker.mjs

import { loadTenantCollection, saveTenantCollection } from "../storage/jsonStore.worker.mjs";
import { nowUtcIso } from "../domain/time/utc.mjs";
import { emitAudit } from "../observability/audit.mjs";
import { evaluateAlertsOnce } from "../domain/alerts/evaluate.mjs";

const KNOWN_AUTH_LEVELS = new Set(["user", "service", "system", "dev"]);
const LEDGER_WRITE_ALLOWED = new Set(["service", "system", "dev"]);

// Deterministic route/method facts for this execution path (no inference).
const LEDGER_WRITE_ROUTE = "/v1/ledger/events";
const LEDGER_WRITE_METHOD = "POST";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function authzEnvelope(code, details) {
  return { error: "FORBIDDEN", code, details: details ?? null };
}

function emitAuthzDeniedAudit(ctx, code, details) {
  try {
    emitAudit(ctx, {
      eventCategory: "SECURITY",
      eventType: "AUTHZ_DENIED",
      objectType: "http_route",
      objectId: `${LEDGER_WRITE_METHOD} ${LEDGER_WRITE_ROUTE}`,
      decision: "DENY",
      reasonCode: code,
      factsSnapshot: {
        actorId: ctx?.actorId ?? null,
        authLevel: ctx?.authLevel ?? null,
        tenantId: ctx?.tenantId ?? null,
        route: LEDGER_WRITE_ROUTE,
        method: LEDGER_WRITE_METHOD,
        denial: details ?? null,
      },
    });
  } catch {
    // swallow (observability must never break execution)
  }
}

function enforceLedgerWriteAuthorizationOrReturn(ctx, baseHeaders) {
  // Must be authenticated (U10), tenant must already be session-derived.
  const authLevel = ctx?.authLevel ?? null;

  if (!authLevel || !KNOWN_AUTH_LEVELS.has(authLevel)) {
    const details = { authLevel };
    emitAuthzDeniedAudit(ctx, "AUTHZ_INVALID_AUTH_LEVEL", details);
    return json(403, authzEnvelope("AUTHZ_INVALID_AUTH_LEVEL", details), baseHeaders);
  }

  if (!LEDGER_WRITE_ALLOWED.has(authLevel)) {
    const details = {
      authLevel,
      capability: "LEDGER_WRITE",
      route: LEDGER_WRITE_ROUTE,
      method: LEDGER_WRITE_METHOD,
    };
    emitAuthzDeniedAudit(ctx, "AUTHZ_DENIED", details);
    return json(403, authzEnvelope("AUTHZ_DENIED", details), baseHeaders);
  }

  return null;
}

export async function writeLedgerEventFromJson(ctx, input, baseHeaders, cfctx) {
  // U11: explicit authorization boundary for ledger writes (fail-closed)
  const denial = enforceLedgerWriteAuthorizationOrReturn(ctx, baseHeaders);
  if (denial) return denial;

  // Existing tenant guard (kept)
  if (!ctx?.tenantId) {
    // Note: This is distinct from authz; tenant is required for any write.
    return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);
  }

  // Existing validation (kept)
  if (!input || typeof input !== "object") {
    return json(400, { error: "BAD_REQUEST", code: "INVALID_BODY_OBJECT", details: null }, baseHeaders);
  }

  if (typeof input.itemId !== "string") {
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

  const event = {
    ledgerEventId: crypto.randomUUID(),
    tenantId: ctx.tenantId,
    createdAtUtc: nowUtcIso(),
    itemId: input.itemId,
    hubId: typeof input.hubId === "string" ? input.hubId : null,
    binId: typeof input.binId === "string" ? input.binId : null,
    qtyDelta: input.qtyDelta,
    reasonCode: typeof input.reasonCode === "string" ? input.reasonCode : "UNSPECIFIED",
    referenceType: typeof input.referenceType === "string" ? input.referenceType : null,
    referenceId: typeof input.referenceId === "string" ? input.referenceId : null,
    note: typeof input.note === "string" ? input.note : null,
  };

  const events = (await loadTenantCollection(ctx.tenantId, "ledger_events", [])) || [];
  events.push(event);
  await saveTenantCollection(ctx.tenantId, "ledger_events", events);

  emitAudit(ctx, {
    eventCategory: "INVENTORY",
    eventType: "LEDGER_EVENT_APPEND",
    objectType: "ledger_event",
    objectId: event.ledgerEventId,
    decision: "ALLOW",
    reasonCode: "APPENDED",
    factsSnapshot: { itemId: event.itemId, qtyDelta: event.qtyDelta, hubId: event.hubId, binId: event.binId },
  });

  // Non-blocking alert evaluation: reliable in Workers via waitUntil
  try {
    const p = evaluateAlertsOnce(ctx.tenantId, "LEDGER_EVENT_COMMITTED");
    if (cfctx && typeof cfctx.waitUntil === "function") cfctx.waitUntil(p);
  } catch {
    // swallow
  }

  return json(201, { event }, baseHeaders);
}
