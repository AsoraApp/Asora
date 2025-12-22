// backend/src/domain/ledgerEvent.identity.mjs
// U16: Canonical ledger event identity + tenant-scoped deterministic ordering.
// - No randomness
// - Pure/deterministic
// - Centralizes event_id + sequence strategy

/**
 * Deterministic FNV-1a 32-bit hash.
 * - Pure + deterministic
 * - Returns lowercase 8-hex string
 */
function fnv1a32Hex(input) {
  const str = String(input ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function toStr(v) {
  return String(v ?? "");
}

/**
 * Canonical event_id strategy (U16.1):
 * - Globally referenceable, immutable
 * - Replay-safe stability preference:
 *   If referenceType+referenceId exist, use them as idempotency basis.
 *   Else, use requestId as the best available uniqueness basis.
 *
 * IMPORTANT:
 * - This does not interpret semantics; it fingerprints facts.
 */
export function computeLedgerEventId(ctx, eventCore) {
  const tenantId = ctx?.tenantId ?? "";
  const requestId = ctx?.requestId ?? "";

  const refType = toStr(eventCore?.referenceType);
  const refId = toStr(eventCore?.referenceId);
  const hasStableRef = !!(refType && refId);

  const fp = [
    tenantId,
    hasStableRef ? "REF" : "REQ",
    hasStableRef ? `${refType}:${refId}` : requestId,
    toStr(eventCore?.itemId),
    toStr(eventCore?.hubId),
    toStr(eventCore?.binId),
    toStr(eventCore?.qtyDelta),
    toStr(eventCore?.reasonCode),
    toStr(eventCore?.note),
    // U16 optional lineage + opaque context pointers should contribute to uniqueness
    // only insofar as they exist in the write payload (still no interpretation).
    toStr(eventCore?.parent_event_id),
    toStr(eventCore?.causal_chain_id),
    toStr(eventCore?.authorization_ref),
    toStr(eventCore?.decision_ref),
    // external_context_refs can be large; include a stable shallow projection
    // to avoid embedding massive strings in fp.
    stableExternalRefsProjection(eventCore?.external_context_refs),
  ].join("|");

  return `le_${fnv1a32Hex(fp)}`;
}

function stableExternalRefsProjection(external_context_refs) {
  if (!Array.isArray(external_context_refs) || external_context_refs.length === 0) return "";
  // Keep deterministic ordering in the projection.
  // Each ref is projected to id|uri|hash only (no interpretation).
  const parts = [];
  for (const r of external_context_refs) {
    if (!r || typeof r !== "object") continue;
    const id = toStr(r.id);
    const uri = toStr(r.uri);
    const hash = toStr(r.hash);
    // Compact canonical string; empty refs still produce separators deterministically.
    parts.push(`${id}|${uri}|${hash}`);
  }
  // Sorting ensures stable fingerprint regardless of input ordering.
  parts.sort();
  return parts.join(",");
}

/**
 * Tenant-scoped deterministic sequence (U16.1):
 * - Monotonic within a tenant based on currently stored events.
 * - No rewriting: sequence is stamped on write.
 *
 * NOTE:
 * - Cloudflare KV does not provide atomic increments; concurrency could cause collisions.
 * - Determinism is still guaranteed for a given persisted state; callers must treat
 *   (sequence, event_id) as the deterministic total order.
 */
export function computeNextLedgerSequence(existingRows) {
  const rows = Array.isArray(existingRows) ? existingRows : [];
  let maxSeq = 0;

  for (const e of rows) {
    const s = e?.sequence;
    if (Number.isInteger(s) && s > maxSeq) maxSeq = s;
  }

  return maxSeq + 1;
}
