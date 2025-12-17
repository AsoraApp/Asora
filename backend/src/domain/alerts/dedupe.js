const crypto = require("crypto");

/**
 * Deterministic dedupe key:
 * sha256( tenantId | ruleId | conditionKey )
 *
 * conditionKey MUST be stable and fully explicit:
 * e.g., "LOW_STOCK|ITEM|item:abc|threshold:5|onHand:3"
 */
function dedupeKey(tenantId, ruleId, conditionKey) {
  const raw = `${tenantId}|${ruleId}|${conditionKey}`;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

module.exports = { dedupeKey };
