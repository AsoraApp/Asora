// B3 ledger validation (closed taxonomy, deterministic).

const LedgerEventTypes = Object.freeze({
  OPENING_BALANCE: "OPENING_BALANCE",
  ADJUSTMENT: "ADJUSTMENT",
  MOVE: "MOVE",
  RECEIPT: "RECEIPT",
});

const LedgerReasonCodes = Object.freeze({
  DAMAGE: "DAMAGE",
  LOSS: "LOSS",
  FOUND: "FOUND",
  CORRECTION: "CORRECTION",
  OTHER: "OTHER",
});

const LEDGER_EVENT_TYPES = Object.freeze([
  LedgerEventTypes.OPENING_BALANCE,
  LedgerEventTypes.ADJUSTMENT,
  LedgerEventTypes.MOVE,
  LedgerEventTypes.RECEIPT,
]);

const LEDGER_REASON_CODES = Object.freeze([
  LedgerReasonCodes.DAMAGE,
  LedgerReasonCodes.LOSS,
  LedgerReasonCodes.FOUND,
  LedgerReasonCodes.CORRECTION,
  LedgerReasonCodes.OTHER,
]);

function validateLedgerEventInput(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, code: "LEDGER_VALIDATION_FAILED", details: { reason: "INVALID_BODY" } };
  }

  const { idempotencyKey, eventType } = input;

  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return { ok: false, code: "LEDGER_VALIDATION_FAILED", details: { reason: "IDEMPOTENCY_KEY_REQUIRED" } };
  }

  if (!LEDGER_EVENT_TYPES.includes(eventType)) {
    return { ok: false, code: "LEDGER_EVENTTYPE_INVALID", details: { reason: "EVENT_TYPE_INVALID" } };
  }

  const {
    skuId,
    hubId,
    binId,
    quantity,
    reasonCode,
    fromHubId,
    fromBinId,
    toHubId,
    toBinId,
  } = input;

  if (!skuId || !hubId) {
    return { ok: false, code: "LEDGER_VALIDATION_FAILED", details: { reason: "SKU_OR_HUB_REQUIRED" } };
  }

  if (!Number.isInteger(quantity)) {
    return { ok: false, code: "LEDGER_QUANTITY_INVALID", details: { reason: "QUANTITY_NOT_INTEGER" } };
  }

  if (
    eventType === LedgerEventTypes.OPENING_BALANCE ||
    eventType === LedgerEventTypes.RECEIPT ||
    eventType === LedgerEventTypes.MOVE
  ) {
    if (quantity <= 0) {
      return { ok: false, code: "LEDGER_QUANTITY_INVALID", details: { reason: "QUANTITY_MUST_BE_POSITIVE" } };
    }
  }

  if (eventType === LedgerEventTypes.ADJUSTMENT) {
    if (quantity === 0) {
      return { ok: false, code: "LEDGER_QUANTITY_INVALID", details: { reason: "QUANTITY_ZERO_INVALID" } };
    }
    if (!LEDGER_REASON_CODES.includes(reasonCode)) {
      return { ok: false, code: "LEDGER_VALIDATION_FAILED", details: { reason: "REASON_CODE_REQUIRED" } };
    }
  }

  if (eventType === LedgerEventTypes.MOVE) {
    if (!fromHubId || !fromBinId || !toHubId || !toBinId) {
      return { ok: false, code: "LEDGER_MOVE_INVALID", details: { reason: "MOVE_FIELDS_REQUIRED" } };
    }
    if (fromHubId === toHubId && fromBinId === toBinId) {
      return { ok: false, code: "LEDGER_MOVE_INVALID", details: { reason: "MOVE_NOOP_INVALID" } };
    }
  } else {
    if (!binId) {
      return { ok: false, code: "LEDGER_VALIDATION_FAILED", details: { reason: "BIN_REQUIRED" } };
    }
  }

  return { ok: true };
}

module.exports = {
  LedgerEventTypes,
  LedgerReasonCodes,
  LEDGER_EVENT_TYPES,
  LEDGER_REASON_CODES,
  validateLedgerEventInput,
};
