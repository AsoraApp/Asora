const crypto = require("crypto");

const { emitAudit } = require("../observability/audit");
const { loadTenantCollection, saveTenantCollection } = require("../storage/jsonStore");
const { nowUtcIso } = require("../domain/time/utc");
const { evaluateAlertsAsync } = require("../domain/alerts/evaluate");

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function writeLedgerEventFromJson(ctx, input, baseHeaders) {
  if (!ctx || !ctx.tenantId) return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);
  if (!input || typeof input !== "object") return json(400, { error: "BAD_REQUEST", code: "INVALID_BODY_OBJECT", details: null }, baseHeaders);

  if (typeof input.itemId !== "string") return json(400, { error: "BAD_REQUEST", code: "MISSING_ITEM_ID", details: null }, baseHeaders);
  if (typeof input.qtyDelta !== "number" || !Number.isFinite(input.qtyDelta)) {
    return json(400, { error: "BAD_REQUEST", code: "INVALID_QTY_DELTA", details: null }, baseHeaders);
  }
  if (input.hubId !== undefined && typeof input.hubId !== "string") {
    return json(400, { error: "BAD_REQUEST", code: "INVALID_HUB_ID", details: null }, baseHeaders);
  }
  if (input.binId !== undefined && typeof input.binId !== "string") {
    return json(400, { error: "BAD_REQUEST", code: "INVALID_BIN_ID", details: null }, baseHeaders);
  }

  return (async () => {
    const now = nowUtcIso();
    const event = {
      ledgerEventId: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      createdAtUtc: now,
      itemId: input.itemId,
      hubId: input.hubId || null,
      binId: input.binId || null,
      qtyDelta: input.qtyDelta,
      reasonCode: typeof input.reasonCode === "string" ? input.reasonCode : "UNSPECIFIED",
      referenceType: typeof input.referenceType === "string" ? input.referenceType : null,
      referenceId: typeof input.referenceId === "string" ? input.referenceId : null,
      note: typeof input.note === "string" ? input.note : null
    };

    const events = (await loadTenantCollection(ctx.tenantId, "ledger_events")) || [];
    events.push(event);
    await saveTenantCollection(ctx.tenantId, "ledger_events", events);

    emitAudit(ctx, {
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
        referenceId: event.referenceId
      }
    });

    evaluateAlertsAsync(ctx.tenantId, "LEDGER_EVENT_COMMITTED");

    return json(201, { event }, baseHeaders);
  })();
}

module.exports = { writeLedgerEventFromJson };
