// backend/src/domain/ledgerEvent.schema.mjs
// U16: Canonical ledger event shape + structural validation.
// - Types/allowed keys only
// - Fail-closed on unknown keys
// - No business rules / no semantic interpretation

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function cloneShallow(v) {
  if (!isObj(v)) return null;
  return { ...v };
}

function clampString(v, maxLen) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function assertNoUnknownKeys(obj, allowed) {
  for (const k of Object.keys(obj || {})) {
    if (!allowed.has(k)) return k;
  }
  return null;
}

/**
 * Input keys permitted for POST /api/ledger/events.
 * Shape freeze starts here (fail-closed) to prevent silent schema drift.
 */
const ALLOWED_INPUT_KEYS = new Set([
  // existing required/optional
  "itemId",
  "qtyDelta",
  "hubId",
  "binId",
  "reasonCode",
  "referenceType",
  "referenceId",
  "note",

  // U16 optional lineage / causality
  "parent_event_id",
  "causal_chain_id",

  // U16 opaque context pointers
  "authorization_ref",
  "decision_ref",
  "external_context_refs",
]);

/**
 * Canonical stored event keys (U16 event shape freeze).
 * NOTE: We keep ledgerEventId as a compatibility alias, but canonical is event_id.
 */
const ALLOWED_STORED_EVENT_KEYS = new Set([
  "event_id",
  "ledgerEventId", // compatibility alias = event_id
  "sequence",

  "tenantId",
  "createdAtUtc",

  "itemId",
  "hubId",
  "binId",
  "qtyDelta",

  "reasonCode",
  "referenceType",
  "referenceId",
  "note",

  // optional lineage / causality
  "parent_event_id",
  "causal_chain_id",

  // opaque context refs
  "authorization_ref",
  "decision_ref",
  "external_context_refs",
]);

function normalizeExternalContextRefs(v) {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return "__INVALID__";

  const out = [];
  for (const r of v) {
    if (!isObj(r)) return "__INVALID__";

    // Reference-only: allow id/uri/hash; discard unknown keys to freeze shape.
    const allowedRefKeys = new Set(["id", "uri", "hash"]);
    const unknown = assertNoUnknownKeys(r, allowedRefKeys);
    if (unknown) return "__INVALID__";

    const id = clampString(r.id, 256);
    const uri = clampString(r.uri, 2048);
    const hash = clampString(r.hash, 256);

    // Do not enforce "at least one present" (that would be a business rule).
    out.push({
      id: id || null,
      uri: uri || null,
      hash: hash || null,
    });
  }

  return out;
}

/**
 * Validate + normalize the write input.
 * Returns: { ok: true, value } or { ok: false, code, details }
 */
export function validateLedgerEventWriteInput(input) {
  if (!isObj(input)) {
    return { ok: false, code: "INVALID_BODY_OBJECT", details: { gotType: typeof input } };
  }

  const unknownKey = assertNoUnknownKeys(input, ALLOWED_INPUT_KEYS);
  if (unknownKey) {
    return { ok: false, code: "UNKNOWN_FIELDS", details: { field: unknownKey } };
  }

  // Required
  if (typeof input.itemId !== "string" || !input.itemId) {
    return { ok: false, code: "MISSING_ITEM_ID", details: null };
  }
  if (typeof input.qtyDelta !== "number" || !Number.isFinite(input.qtyDelta)) {
    return { ok: false, code: "INVALID_QTY_DELTA", details: null };
  }

  // Optional basic fields
  if (input.hubId !== undefined && input.hubId !== null && typeof input.hubId !== "string") {
    return { ok: false, code: "INVALID_HUB_ID", details: null };
  }
  if (input.binId !== undefined && input.binId !== null && typeof input.binId !== "string") {
    return { ok: false, code: "INVALID_BIN_ID", details: null };
  }

  // U16 optional fields (types only)
  const parent_event_id = clampString(input.parent_event_id, 128);
  const causal_chain_id = clampString(input.causal_chain_id, 128);

  const authorization_ref = clampString(input.authorization_ref, 256);
  const decision_ref = clampString(input.decision_ref, 256);

  const external_context_refs = normalizeExternalContextRefs(input.external_context_refs);
  if (external_context_refs === "__INVALID__") {
    return { ok: false, code: "INVALID_EXTERNAL_CONTEXT_REFS", details: null };
  }

  // Produce a normalized value.
  return {
    ok: true,
    value: {
      itemId: input.itemId,
      qtyDelta: input.qtyDelta,
      hubId: typeof input.hubId === "string" ? input.hubId : null,
      binId: typeof input.binId === "string" ? input.binId : null,

      reasonCode: clampString(input.reasonCode, 64) || "UNSPECIFIED",
      referenceType: clampString(input.referenceType, 64),
      referenceId: clampString(input.referenceId, 128),
      note: clampString(input.note, 512),

      parent_event_id,
      causal_chain_id,

      authorization_ref,
      decision_ref,
      external_context_refs: Array.isArray(external_context_refs) ? external_context_refs : null,
    },
  };
}

/**
 * Stored event structural validation (defensive, write-time).
 * - Ensures no unknown keys leak into persistence.
 * - Ensures required canonical keys exist.
 */
export function validateStoredLedgerEventShape(event) {
  if (!isObj(event)) return { ok: false, code: "INVALID_EVENT_OBJECT", details: null };

  const unknownKey = assertNoUnknownKeys(event, ALLOWED_STORED_EVENT_KEYS);
  if (unknownKey) return { ok: false, code: "UNKNOWN_EVENT_FIELDS", details: { field: unknownKey } };

  if (typeof event.event_id !== "string" || !event.event_id) {
    return { ok: false, code: "MISSING_EVENT_ID", details: null };
  }
  if (!Number.isInteger(event.sequence) || event.sequence <= 0) {
    return { ok: false, code: "MISSING_SEQUENCE", details: null };
  }
  if (typeof event.tenantId !== "string" || !event.tenantId) {
    return { ok: false, code: "MISSING_TENANT_ID", details: null };
  }
  if (typeof event.createdAtUtc !== "string" || !event.createdAtUtc) {
    return { ok: false, code: "MISSING_CREATED_AT", details: null };
  }
  if (typeof event.itemId !== "string" || !event.itemId) {
    return { ok: false, code: "MISSING_ITEM_ID", details: null };
  }
  if (typeof event.qtyDelta !== "number" || !Number.isFinite(event.qtyDelta)) {
    return { ok: false, code: "INVALID_QTY_DELTA", details: null };
  }

  return { ok: true };
}

