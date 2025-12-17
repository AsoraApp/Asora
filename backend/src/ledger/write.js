// backend/src/ledger/write.js
const { fail } = require("../api/errors");
const { appendLedgerEvent } = require("./append");

/**
 * B3 HTTP: POST /api/ledger/events
 * - Append-only
 * - Tenant-scoped (ctx.tenantId)
 * - Idempotent via Idempotency-Key header
 */
async function writeLedgerEventHttp(req, res, ctx) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (req.method !== "POST" || path !== "/api/ledger/events") return false;

  const idempotencyKey = req.headers["idempotency-key"] || req.headers["Idempotency-Key"];
  if (!idempotencyKey) return fail(res, "INVALID_REQUEST", "Missing Idempotency-Key header");

  const body = ctx.body || null;
  if (!body || typeof body !== "object") {
    return fail(res, "INVALID_REQUEST", "Body must be an object");
  }
  if (!body.eventType) return fail(res, "INVALID_REQUEST", "Missing eventType");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return fail(res, "INVALID_REQUEST", "Missing lines");
  }

  try {
    const out = appendLedgerEvent(ctx, {
      namespace: "ledger.write",
      idempotencyKey: String(idempotencyKey),
      event: body,
    });
    res.statusCode = 201;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(out));
    return true;
  } catch (e) {
    return fail(res, e.code || "INVALID_REQUEST", e.message, e.details);
  }
}

module.exports = { writeLedgerEventHttp };
