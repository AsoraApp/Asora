const crypto = require("crypto");
const { emitAudit } = require("../observability/audit");
const { validateLedgerEventInput } = require("./validate");
const { getByIdempotencyKey, appendEvent } = require("./store");

function stableStringify(obj) {
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function writeLedgerEventHttp(req, res, ctx, requestId) {
  const tenantId = ctx && ctx.tenantId;
  const actorUserId = ctx && ctx.userId;

  if (!tenantId) {
    emitAudit({
      category: "TENANT",
      eventType: "LEDGER.WRITE_DENY",
      requestId,
      tenantId: null,
      userId: actorUserId || null,
      error: { code: "TENANT_UNRESOLVED", message: "Tenant unresolved." },
    });

    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "TENANT_UNRESOLVED", message: "Tenant unresolved." }, requestId }));
    return true;
  }

  const input = req.body || {};
  const v = validateLedgerEventInput(input);
  if (!v.ok) {
    emitAudit({
      category: "INVENTORY",
      eventType: "LEDGER.WRITE_REJECTED",
      requestId,
      tenantId,
      userId: actorUserId,
      details: { errorCode: v.code, validation: v.details, eventType: input.eventType || null },
    });

    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: v.code, message: "Ledger validation failed.", details: v.details }, requestId }));
    return true;
  }

  const canonicalPayload = { ...input };
  const canonicalHash = sha256(stableStringify(canonicalPayload));

  const existing = getByIdempotencyKey(tenantId, input.idempotencyKey);
  if (existing) {
    if (existing.canonicalHash === canonicalHash) {
      emitAudit({
        category: "INVENTORY",
        eventType: "LEDGER.IDEMPOTENT_REPLAY",
        requestId,
        tenantId,
        userId: actorUserId,
        eventId: existing.eventId,
        idempotencyKey: existing.idempotencyKey,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, replay: true, event: existing, code: "IDEMPOTENT_REPLAY", requestId }));
      return true;
    }

    emitAudit({
      category: "INVENTORY",
      eventType: "LEDGER.IDEMPOTENCY_MISMATCH_REJECTED",
      requestId,
      tenantId,
      userId: actorUserId,
      idempotencyKey: input.idempotencyKey,
    });

    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          code: "IDEMPOTENCY_KEY_REUSE_MISMATCH",
          message: "Idempotency key reuse with mismatched payload.",
        },
        requestId,
      })
    );
    return true;
  }

  const event = {
    eventId: crypto.randomUUID(),
    tenantId,
    actorUserId,
    correlationId: ctx && ctx.requestId ? ctx.requestId : requestId,
    createdAtUtc: new Date().toISOString(),
    ...input,
    canonicalHash,
  };

  try {
    const appended = appendEvent(event);

    emitAudit({
      category: "INVENTORY",
      eventType: "LEDGER_WRITE_ACCEPTED",
      requestId,
      tenantId,
      userId: actorUserId,
      eventId: appended.eventId,
      details: { eventType: appended.eventType, skuId: appended.skuId, quantity: appended.quantity, idempotencyKey: appended.idempotencyKey },
    });

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, replay: false, event: appended, requestId }));
    return true;
  } catch (e) {
    emitAudit({
      category: "INVENTORY",
      eventType: "LEDGER.WRITE_STORE_FAIL",
      requestId,
      tenantId,
      userId: actorUserId,
      error: { code: "LEDGER_STORE_APPEND_FAILED", message: "Store append failed." },
    });

    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "LEDGER_STORE_APPEND_FAILED", message: "Store append failed." }, requestId }));
    return true;
  }
}

module.exports = { writeLedgerEventHttp };
