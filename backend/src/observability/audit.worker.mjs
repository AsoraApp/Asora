// backend/src/observability/audit.worker.mjs
import { nowUtcIso } from "../domain/time/utc.mjs";
import { loadTenantCollection, saveTenantCollection } from "../storage/jsonStore.worker.mjs";

/**
 * Deterministic FNV-1a 32-bit hash.
 * - Pure + deterministic
 * - Returns lowercase 8-hex string (no randomness)
 */
function fnv1a32Hex(input) {
  const str = String(input ?? "");
  let h = 0x811c9dc5; // offset basis
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    // h *= 16777619 with 32-bit overflow
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function stableAuditId(ctx, evt) {
  // Build a stable fingerprint from fields that should not change for the same action.
  const tenantId = ctx?.tenantId ?? "";
  const requestId = ctx?.requestId ?? "";
  const eventCategory = evt?.eventCategory ?? "";
  const eventType = evt?.eventType ?? "";
  const objectType = evt?.objectType ?? "";
  const objectId = evt?.objectId ?? "";

  // factsSnapshot can be large. Don’t stringify full object into ID; use a short stable projection.
  const reasonCode = evt?.reasonCode ?? "";
  const decision = evt?.decision ?? "";

  const fp = `${tenantId}|${requestId}|${eventCategory}|${eventType}|${objectType}|${objectId}|${decision}|${reasonCode}`;
  return `a_${fnv1a32Hex(fp)}`;
}

const AUDIT_MAX_EVENTS = 5000; // U13: deterministic retention cap per tenant

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

async function persistAudit(env, tenantId, record) {
  try {
    const arr = (await loadTenantCollection(env, tenantId, "audit_events", [])) || [];
    const out = safeArray(arr);

    out.push(record);

    // U13: cap growth deterministically (keep newest N)
    if (out.length > AUDIT_MAX_EVENTS) {
      // drop oldest; preserve insertion order (append-only semantics within retained window)
      out.splice(0, out.length - AUDIT_MAX_EVENTS);
    }

    await saveTenantCollection(env, tenantId, "audit_events", out);
  } catch {
    // swallow — observability must never block
  }
}

/**
 * Worker-safe, non-blocking audit emit.
 *
 * Requirements satisfied:
 * - No setTimeout
 * - No randomness
 * - No globalThis env storage
 * - Uses cfctx.waitUntil for async persistence when available
 */
export function emitAudit(ctx, evt, env, cfctx) {
  try {
    const tenantId = ctx?.tenantId || null;
    if (!tenantId) return;

    const record = {
      auditEventId: stableAuditId(ctx, evt),
      createdAtUtc: nowUtcIso(),
      tenantId,
      ...evt,
      correlationId: ctx?.requestId || null,
    };

    // Never block request execution.
    if (cfctx && typeof cfctx.waitUntil === "function") {
      cfctx.waitUntil(persistAudit(env, tenantId, record));
      return;
    }

    // Fallback (should be rare): still don't throw outward.
    persistAudit(env, tenantId, record);
  } catch {
    // swallow
  }
}
