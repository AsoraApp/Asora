export function auditLedgerEvent({
  decision, // ALLOW | DENY | SYSTEM
  eventType,
  tenantId,
  eventId,
  idempotencyKey,
  errorCode,
  correlationId,
}) {
  // B3 minimal audit: append-only, no side effects
  // Placeholder: console only (replace later with real audit store)
  console.info("AUDIT", {
    category: "INVENTORY",
    decision,
    eventType,
    tenantId,
    eventId,
    idempotencyKey,
    errorCode,
    correlationId,
    atUtc: new Date().toISOString(),
  });
}
