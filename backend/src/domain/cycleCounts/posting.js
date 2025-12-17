// backend/src/domain/cycleCounts/posting.js
//
// Deterministic cycle count freeze snapshot computation.
// Reads ledger quantities "as-of" a freeze cursor.
//
// Requires ledger read seam: backend/src/ledger/read.js
// Exports expected:
// - getCursorAsOfNow({ tenantId }) -> cursor (opaque)
// - getQtyAsOf({ tenantId, hubId, binId, skuId, cursor }) -> number

const ledgerRead = require("../../ledger/read");

function sortLinesDeterministically(lines) {
  return [...lines].sort((a, b) => {
    const A = `${a.hubId}\u0000${a.binId}\u0000${a.skuId}\u0000${a.cycleCountLineId}`;
    const B = `${b.hubId}\u0000${b.binId}\u0000${b.skuId}\u0000${b.cycleCountLineId}`;
    return A.localeCompare(B);
  });
}

async function computeFreezeSnapshot({ tenantId, lines }) {
  const freezeAtUtc = new Date().toISOString();

  const freezeLedgerCursor = await ledgerRead.getCursorAsOfNow({ tenantId });
  if (freezeLedgerCursor === null || freezeLedgerCursor === undefined || freezeLedgerCursor === "") {
    const err = new Error("Cannot derive ledger cursor (fail-closed).");
    err.statusCode = 409;
    err.reasonCode = "LEDGER_DERIVATION_FAILED";
    throw err;
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
      const err = new Error("Cannot derive systemQtyAtFreeze (fail-closed).");
      err.statusCode = 409;
      err.reasonCode = "LEDGER_DERIVATION_FAILED";
      throw err;
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
