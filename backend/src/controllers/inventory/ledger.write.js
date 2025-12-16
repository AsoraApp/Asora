import { writeLedgerEvent } from "../../services/inventory/ledger/ledgerWrite.service.js";

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

    return res.status(result.status).json({
      ok: true,
      replay: result.replay,
      event: result.event,
      code: result.code || null,
    });
  } catch (err) {
    return next(err);
  }
}
