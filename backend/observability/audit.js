// Minimal audit emitter (B1)
// Append-only, in-memory stub. Replace with durable store later.

const auditLog = [];

function emitAudit(event) {
  auditLog.push({
    ...event,
    occurredAtUtc: new Date().toISOString()
  });
}

function getAuditLog() {
  return auditLog.slice();
}

module.exports = {
  emitAudit,
  getAuditLog
};
