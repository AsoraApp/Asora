/**
 * Minimal audit emitter for Worker runtime.
 * Observer-only. Best-effort. Never throws.
 *
 * Storage is optional; if KV is available, append to an audit collection.
 * This preserves "append-only" spirit without blocking requests.
 */
import { loadTenantCollection, saveTenantCollection } from "../storage/jsonStore.mjs";
import { nowUtcIso } from "../domain/time/utc.mjs";

export function emitAudit(ctx, evt) {
  try {
    const tenantId = ctx && ctx.tenantId ? ctx.tenantId : null;
    const record = {
      auditEventId: crypto.randomUUID(),
      createdAtUtc: nowUtcIso(),
      tenantId,
      ...evt,
      correlationId: ctx && ctx.requestId ? ctx.requestId : null
    };

    // Best-effort persistence (tenant-scoped when tenant exists).
    if (!tenantId) return;

    setTimeout(async () => {
      try {
        const arr = (await loadTenantCollection(tenantId, "audit_events", [])) || [];
        arr.push(record);
        await saveTenantCollection(tenantId, "audit_events", arr);
      } catch {
        // swallow
      }
    }, 0);
  } catch {
    // swallow
  }
}
