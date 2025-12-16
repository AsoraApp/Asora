import crypto from "crypto";
import { AppError } from "../../../errors/AppError.js";
import { LedgerErrorCodes } from "../../../contracts/inventory/ledger/ledgerErrorCodes.js";
import { validateLedgerEventInput } from "../../../contracts/inventory/ledger/ledgerEvent.schema.js";
import { getByIdempotencyKey, appendEvent } from "../../../stores/ledger/ledgerEvent.store.js";

function stableStringify(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function hashPayload(payload) {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function writeLedgerEvent({ tenantId, actorUserId, correlationId, input }) {
  if (!tenantId) {
    throw new AppError({
      status: 403,
      code: LedgerErrorCodes.TENANT_UNRESOLVED,
      message: "Tenant unresolved.",
    });
  }

  const v = validateLedgerEventInput(input);
  if (!v.ok) {
    throw new AppError({
      status: 400,
      code: LedgerErrorCodes.LEDGER_VALIDATION_FAILED,
      message: "Ledger event validation failed.",
      details: { validationError: v.error },
    });
  }

  const { idempotencyKey } = input;

  // Canonical payload for idempotency comparison (exclude server-derived fields)
  const canonicalPayload = { ...input };
  const canonicalHash = hashPayload(canonicalPayload);

  const existing = getByIdempotencyKey(tenantId, idempotencyKey);
  if (existing) {
    if (existing.canonicalHash === canonicalHash) {
      return {
        status: 200,
        code: LedgerErrorCodes.IDEMPOTENT_REPLAY,
        event: existing,
        replay: true,
      };
    }

    throw new AppError({
      status: 409,
      code: LedgerErrorCodes.IDEMPOTENCY_KEY_REUSE_MISMATCH,
      message: "Idempotency key reuse with mismatched payload.",
    });
  }

  const event = {
    eventId: crypto.randomUUID(),
    tenantId,
    actorUserId,
    correlationId: correlationId || null,
    createdAtUtc: new Date().toISOString(),

    // Client-supplied fields
    ...input,

    // Deterministic idempotency comparison artifact
    canonicalHash,
  };

  const appended = appendEvent(event);

  return {
    status: 201,
    event: appended,
    replay: false,
  };
}
