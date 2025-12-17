import { loadTenantCollection, saveTenantCollection } from "../storage/jsonStore.worker.mjs";
import { nowUtcIso } from "../domain/time/utc.mjs";

export function emitAudit(ctx, evt) {
  try {
    const tenantId = ctx?.tenantId || null;
    const record = {
      auditEventId: crypto.randomUUID(),
      createdAtUtc: nowUtcIso(),
      tenantId,
      ...evt,
      correlationId: ctx?.requestId || null
    };

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
