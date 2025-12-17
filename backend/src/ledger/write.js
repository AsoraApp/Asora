const crypto = require("crypto");

const { emitAudit } = require("../observability/audit");
const { loadTenantCollection, saveTenantCollection } = require("../storage/jsonStore");
const { nowUtcIso } = require("../domain/time/utc");
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

/**
 * B3 write: append-only. Ledger is authoritative for quantity truth.
 * B10 addition: alerts are observers only; evaluation must be non-blocking and replay-safe.
 */
async function writeLedgerEventHttp(ctx, req, res) {
  if (!ctx || !ctx.tenantId) return forbidden(res, "TENANT_REQUIRED");

  const body = await readJsonBody(req);
  if (body === "__INVALID_JSON__") return badRequest(res, "INVALID_JSON");

  const input = body || {};
  if (typeof input.itemId !== "string") return badRequest(res, "MISSING_ITEM_ID");
  if (typeof input.qtyDelta !== "number" || !Number.isFinite(input.qtyDelta)) return badRequest(res, "INVALID_QTY_DELTA");

  // Optional IDs: hubId, binId must be strings if present.
  if (input.hubId !== undefined && typeof input.hubId !== "string") return badRequest(res, "INVALID_HUB_ID");
  if (input.binId !== undefined && typeof input.binId !== "string") return badRequest(res, "INVALID_BIN_ID");

  const now = nowUtcIso();
  const event = {
    ledgerEventId: crypto.randomUUID(),
    tenantId: ctx.tenantId,
    createdAtUtc: now,
    // Deterministic payload (explicit fields only)
    itemId: input.itemId,
    hubId: input.hubId || null,
    binId: input.binId || null,
    qtyDelta: input.qtyDelta,
    reasonCode: typeof input.reasonCode === "string" ? input.reasonCode : "UNSPECIFIED",
    referenceType: typeof input.referenceType === "string" ? input.referenceType : null,
    referenceId: typeof input.referenceId === "string" ? input.referenceId : null,
    note: typeof input.note === "string" ? input.note : null,
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
      referenceId: event.referenceId,
    },
  });

  // B10: alerts observe committed facts; never block writes.
  evaluateAlertsAsync(ctx.tenantId, "LEDGER_EVENT_COMMITTED");

  return send(res, 201, { event });
}

module.exports = { writeLedgerEventHttp };
