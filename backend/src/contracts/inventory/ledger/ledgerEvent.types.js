// Closed, explicit ledger event taxonomy (B3). No free-text types.

export const LedgerEventTypes = Object.freeze({
  OPENING_BALANCE: "OPENING_BALANCE",
  ADJUSTMENT: "ADJUSTMENT",
  MOVE: "MOVE",
  RECEIPT: "RECEIPT",
});

export const LedgerReasonCodes = Object.freeze({
  DAMAGE: "DAMAGE",
  LOSS: "LOSS",
  FOUND: "FOUND",
  CORRECTION: "CORRECTION",
  OTHER: "OTHER",
});

// Convenience arrays (deterministic ordering)
export const LEDGER_EVENT_TYPES = Object.freeze([
  LedgerEventTypes.OPENING_BALANCE,
  LedgerEventTypes.ADJUSTMENT,
  LedgerEventTypes.MOVE,
  LedgerEventTypes.RECEIPT,
]);

export const LEDGER_REASON_CODES = Object.freeze([
  LedgerReasonCodes.DAMAGE,
  LedgerReasonCodes.LOSS,
  LedgerReasonCodes.FOUND,
  LedgerReasonCodes.CORRECTION,
  LedgerReasonCodes.OTHER,
]);
