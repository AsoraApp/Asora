import { writeLedgerEvent } from "../../services/inventory/ledger/ledgerWrite.service.js";
import { auditLedgerEvent } from "../../services/audit/ledger.audit.js";

export function postLedgerEvent(req, res, next) {
  try {
    const tenantId = req.context?.tenantId || null;
    const actorUserId = req.context?.userId || null;
    const correlationId = req.context?.correlationId || req.context?.requestId || null;

    const result = writeLedgerEvent({
      tenantId,
      actorUserId,
      correlationId,
      input: req.body,
    });

    auditLedgerEvent({
      decision: result.replay ? "SYSTEM" : "ALLOW",
      eventType: result.event?.eventType,
      tenantId,
      eventId: result.event?.eventId,
      idempotencyKey: result.event?.idempotencyKey,
      errorCode: result.code || null,
      correlationId,
    });

    return res.status(result.status).json({
      ok: true,
      replay: result.replay,
      event: result.event,
      code: result.code || null,
    });
  } catch (err) {
    // audit reject here only when we can safely infer minimal facts
    auditLedgerEvent({
      decision: "DENY",
      eventType: req.body?.eventType || null,
      tenantId: req.context?.tenantId || null,
      eventId: null,
      idempotencyKey: req.body?.idempotencyKey || null,
      errorCode: err?.code || null,
      correlationId: req.context?.correlationId || req.context?.requestId || null,
    });

    return next(err);
  }
}
