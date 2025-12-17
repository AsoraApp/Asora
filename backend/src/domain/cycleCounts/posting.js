// backend/src/domain/cycleCounts/posting.js
//
// B4 Cycle Counts — deterministic helpers
// - Deterministic line ordering
// - Freeze snapshot computation (systemQtyAtFreeze + deltaPlanned)
// - No HTTP concerns here

const AppError = require("../../errors/AppError");

// Ledger read seam (B3)
// EXPECTED exports:
// - getCursorAsOfNow({ tenantId }) -> cursor (opaque string/number)
// - getQtyAsOf({ tenantId, hubId, binId, skuId, cursor }) -> number
const ledgerRead = require("../../ledger/ledger.read");

function conflict(reasonCode, message, facts) {
  return new AppError(message || reasonCode, 409, reasonCode, facts);
}

function requireTenant(tenantId) {
  if (!tenantId) throw conflict("TENANT_UNRESOLVED", "Tenant unresolved (fail-closed).");
}

function sortLinesDeterministically(lines) {
  return [...lines].sort((a, b) => {
    const A = `${a.hubId}\u0000${a.binId}\u0000${a.skuId}\u0000${a.cycleCountLineId}`;
    const B = `${b.hubId}\u0000${b.binId}\u0000${b.skuId}\u0000${b.cycleCountLineId}`;
    return A.localeCompare(B);
  });
}

async function computeFreezeSnapshot({ tenantId, lines }) {
  requireTenant(tenantId);
  if (!Array.isArray(lines)) {
    throw conflict("LINES_REQUIRED", "Lines required (fail-closed).");
  }
  if (lines.length === 0) {
    throw new AppError("At least one line is required to submit.", 400, "SUBMIT_REQUIRES_LINES");
  }

  const freezeAtUtc = new Date().toISOString();

  const freezeLedgerCursor = await ledgerRead.getCursorAsOfNow({ tenantId });
  if (freezeLedgerCursor === null || freezeLedgerCursor === undefined || freezeLedgerCursor === "") {
    throw conflict("LEDGER_DERIVATION_FAILED", "Cannot derive ledger cursor (fail-closed).");
  }

  const ordered = sortLinesDeterministically(lines);

  const linesSnapshot = [];
  for (const line of ordered) {
    const systemQtyAtFreeze = await ledgerRead.getQtyAsOf({
      tenantId,
      hubId: line.hubId,
      binId: line.binId,
      skuId: line.skuId,
      cursor: freezeLedgerCursor,
    });

    if (typeof systemQtyAtFreeze !== "number" || !Number.isFinite(systemQtyAtFreeze)) {
      throw conflict("LEDGER_DERIVATION_FAILED", "Cannot derive systemQtyAtFreeze (fail-closed).", {
        hubId: line.hubId,
        binId: line.binId,
        skuId: line.skuId,
      });
    }

    const deltaPlanned = line.countedQty - systemQtyAtFreeze;

    linesSnapshot.push({
      cycleCountLineId: line.cycleCountLineId,
      systemQtyAtFreeze,
      deltaPlanned,
    });
  }

  return {
    freezeAtUtc,
    freezeLedgerCursor,
    freezeDerivationRule: "LEDGER_AS_OF_CURSOR",
    linesSnapshot,
  };
}

module.exports = {
  sortLinesDeterministically,
  computeFreezeSnapshot,
};
