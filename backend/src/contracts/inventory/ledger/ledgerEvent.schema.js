import {
  LEDGER_EVENT_TYPES,
  LEDGER_REASON_CODES,
  LedgerEventTypes,
} from "./ledgerEvent.types.js";

/**
 * Validation rules for B3 ledger writes.
 * No side effects. Deterministic only.
 */

export function validateLedgerEventInput(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "INVALID_BODY" };
  }

  const { idempotencyKey, eventType } = input;

  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return { ok: false, error: "IDEMPOTENCY_KEY_REQUIRED" };
  }

  if (!LEDGER_EVENT_TYPES.includes(eventType)) {
    return { ok: false, error: "EVENT_TYPE_INVALID" };
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

  // Common required fields
  if (!skuId || !hubId) {
    return { ok: false, error: "SKU_OR_HUB_REQUIRED" };
  }

  // Quantity rules
  if (!Number.isInteger(quantity)) {
    return { ok: false, error: "QUANTITY_NOT_INTEGER" };
  }

  if (
    eventType === LedgerEventTypes.OPENING_BALANCE ||
    eventType === LedgerEventTypes.RECEIPT ||
    eventType === LedgerEventTypes.MOVE
  ) {
    if (quantity <= 0) {
      return { ok: false, error: "QUANTITY_MUST_BE_POSITIVE" };
    }
  }

  if (eventType === LedgerEventTypes.ADJUSTMENT) {
    if (quantity === 0) {
      return { ok: false, error: "QUANTITY_ZERO_INVALID" };
    }
    if (!LEDGER_REASON_CODES.includes(reasonCode)) {
      return { ok: false, error: "REASON_CODE_REQUIRED" };
    }
  }

  // MOVE-specific rules
  if (eventType === LedgerEventTypes.MOVE) {
    if (!fromHubId || !fromBinId || !toHubId || !toBinId) {
      return { ok: false, error: "MOVE_FIELDS_REQUIRED" };
    }
    if (fromHubId === toHubId && fromBinId === toBinId) {
      return { ok: false, error: "MOVE_NOOP_INVALID" };
    }
  } else {
    // Non-MOVE requires binId
    if (!binId) {
      return { ok: false, error: "BIN_REQUIRED" };
    }
  }

  return { ok: true };
}
