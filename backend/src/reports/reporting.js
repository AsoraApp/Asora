"use strict";

const { loadTenantCollection } = require("../storage/jsonStore");

function safeArray(x) {
  return Array.isArray(x) ? x : [];
}

function isIsoUtc(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(s);
}

function normalizeLedgerLines(ev) {
  // Supported shapes:
  // - ev.lines: [{ itemId, hubId, binId, qtyDelta, unitCost, unitPrice, reasonCode, ... }]
  // - ev.line: single line object (legacy)
  // - ev.payload.lines (legacy)
  const lines =
    safeArray(ev && ev.lines).length
      ? ev.lines
      : safeArray(ev && ev.payload && ev.payload.lines).length
        ? ev.payload.lines
        : ev && ev.line
          ? [ev.line]
          : [];

  return lines
    .map((l) => ({
      itemId: l && (l.itemId || l.skuId || l.item_id) ? String(l.itemId || l.skuId || l.item_id) : null,
      hubId: l && l.hubId ? String(l.hubId) : null,
      binId: l && l.binId ? String(l.binId) : null,
      qtyDelta: Number(l && (l.qtyDelta ?? l.delta ?? l.quantityDelta ?? l.qty ?? 0)) || 0,
      unitCost: l && l.unitCost !== undefined && l.unitCost !== null ? Number(l.unitCost) : null,
      reasonCode: l && l.reasonCode ? String(l.reasonCode) : null,
      uom: l && l.uom ? String(l.uom) : null,
      notes: l && l.notes ? String(l.notes) : null,
    }))
    .filter((l) => l.itemId && Number.isFinite(l.qtyDelta));
}

function normalizeLedgerEvent(ev) {
  const ledgerEventId = ev && (ev.ledgerEventId || ev.eventId || ev.id) ? String(ev.ledgerEventId || ev.eventId || ev.id) : null;
  const occurredAtUtc =
    ev && (ev.occurredAtUtc || ev.createdAtUtc || ev.atUtc || ev.timestampUtc)
      ? String(ev.occurredAtUtc || ev.createdAtUtc || ev.atUtc || ev.timestampUtc)
      : null;

  return {
    ledgerEventId,
    occurredAtUtc,
    eventType: ev && ev.eventType ? String(ev.eventType) : "UNKNOWN",
    actorUserId: ev && ev.actorUserId ? String(ev.actorUserId) : null,
    sourceType: ev && ev.sourceType ? String(ev.sourceType) : null,
    sourceId: ev && ev.sourceId ? String(ev.sourceId) : null,
    lines: normalizeLedgerLines(ev),
  };
}

function compareStrings(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

function inRange(occurredAtUtc, fromUtc, toUtc) {
  if (!occurredAtUtc || !isIsoUtc(occurredAtUtc)) return false;
  if (fromUtc && isIsoUtc(fromUtc) && occurredAtUtc < fromUtc) return false;
  if (toUtc && isIsoUtc(toUtc) && occurredAtUtc > toUtc) return false;
  return true;
}

async function loadLedger(tenantId) {
  const raw = await loadTenantCollection(tenantId, "ledger");
  return safeArray(raw).map(normalizeLedgerEvent).filter((e) => e.ledgerEventId && e.occurredAtUtc && isIsoUtc(e.occurredAtUtc));
}

function applyCommonFilters(lines, filters) {
  return lines.filter((l) => {
    if (filters.itemId && l.itemId !== filters.itemId) return false;
    if (filters.hubId && l.hubId !== filters.hubId) return false;
    if (filters.binId && l.binId !== filters.binId) return false;
    return true;
  });
}

function buildStock(ledgerEvents, filters) {
  // Stock on hand by item/hub/bin: sum qtyDelta across all events.
  const m = new Map(); // key = item|hub|bin
  for (const ev of ledgerEvents) {
    if (!inRange(ev.occurredAtUtc, filters.fromUtc, filters.toUtc)) continue;
    const filteredLines = applyCommonFilters(ev.lines, filters);
    for (const l of filteredLines) {
      const key = `${l.itemId}||${l.hubId || ""}||${l.binId || ""}`;
      const prev = m.get(key) || { itemId: l.itemId, hubId: l.hubId || null, binId: l.binId || null, qtyOnHand: 0 };
      prev.qtyOnHand += l.qtyDelta;
      m.set(key, prev);
    }
  }

  const rows = Array.from(m.values())
    .map((r) => ({
      itemId: r.itemId,
      hubId: r.hubId,
      binId: r.binId,
      qtyOnHand: Number(r.qtyOnHand),
    }))
    // Fail-closed: do not surface negative-zero noise
    .map((r) => ({ ...r, qtyOnHand: Object.is(r.qtyOnHand, -0) ? 0 : r.qtyOnHand }));

  rows.sort((a, b) => {
    let c = compareStrings(a.itemId, b.itemId);
    if (c) return c;
    c = compareStrings(a.hubId, b.hubId);
    if (c) return c;
    return compareStrings(a.binId, b.binId);
  });

  return rows;
}

function buildMovements(ledgerEvents, filters) {
  // One row per ledger line (ledger-backed history)
  const rows = [];
  for (const ev of ledgerEvents) {
    if (!inRange(ev.occurredAtUtc, filters.fromUtc, filters.toUtc)) continue;
    const filteredLines = applyCommonFilters(ev.lines, filters);
    for (const l of filteredLines) {
      rows.push({
        occurredAtUtc: ev.occurredAtUtc,
        ledgerEventId: ev.ledgerEventId,
        eventType: ev.eventType,
        itemId: l.itemId,
        hubId: l.hubId,
        binId: l.binId,
        qtyDelta: l.qtyDelta,
        unitCost: l.unitCost,
        sourceType: ev.sourceType,
        sourceId: ev.sourceId,
        actorUserId: ev.actorUserId,
        reasonCode: l.reasonCode,
        notes: l.notes,
      });
    }
  }

  rows.sort((a, b) => {
    let c = compareStrings(a.occurredAtUtc, b.occurredAtUtc);
    if (c) return c;
    c = compareStrings(a.ledgerEventId, b.ledgerEventId);
    if (c) return c;
    c = compareStrings(a.itemId, b.itemId);
    if (c) return c;
    c = compareStrings(a.hubId, b.hubId);
    if (c) return c;
    return compareStrings(a.binId, b.binId);
  });

  return rows;
}

function buildReceiving(ledgerEvents, filters) {
  // Receiving activity summary derived from ledger inbound lines with a procurement source marker:
  // - eventType contains "RECEIPT" or "RECEIVING" OR
  // - sourceType equals "RECEIPT" / "PO_RECEIPT"
  // Grouped by itemId (and hub/bin if present) with totals.
  const m = new Map();
  for (const ev of ledgerEvents) {
    if (!inRange(ev.occurredAtUtc, filters.fromUtc, filters.toUtc)) continue;

    const isReceiving =
      (typeof ev.eventType === "string" && (ev.eventType.includes("RECEIPT") || ev.eventType.includes("RECEIVING"))) ||
      (typeof ev.sourceType === "string" && (ev.sourceType === "RECEIPT" || ev.sourceType === "PO_RECEIPT" || ev.sourceType === "RECEIVING"));

    if (!isReceiving) continue;

    const filteredLines = applyCommonFilters(ev.lines, filters);
    for (const l of filteredLines) {
      if (!(l.qtyDelta > 0)) continue; // receiving is inbound only
      const key = `${l.itemId}||${l.hubId || ""}||${l.binId || ""}`;
      const prev =
        m.get(key) || {
          itemId: l.itemId,
          hubId: l.hubId || null,
          binId: l.binId || null,
          qtyReceived: 0,
          totalExtendedCost: 0,
          firstReceivedAtUtc: ev.occurredAtUtc,
          lastReceivedAtUtc: ev.occurredAtUtc,
        };
      prev.qtyReceived += l.qtyDelta;
      if (l.unitCost !== null && Number.isFinite(l.unitCost)) {
        prev.totalExtendedCost += l.qtyDelta * l.unitCost;
      }
      if (ev.occurredAtUtc < prev.firstReceivedAtUtc) prev.firstReceivedAtUtc = ev.occurredAtUtc;
      if (ev.occurredAtUtc > prev.lastReceivedAtUtc) prev.lastReceivedAtUtc = ev.occurredAtUtc;
      m.set(key, prev);
    }
  }

  const rows = Array.from(m.values()).map((r) => ({
    itemId: r.itemId,
    hubId: r.hubId,
    binId: r.binId,
    qtyReceived: Number(r.qtyReceived),
    totalExtendedCost: Number(r.totalExtendedCost),
    firstReceivedAtUtc: r.firstReceivedAtUtc,
    lastReceivedAtUtc: r.lastReceivedAtUtc,
  }));

  rows.sort((a, b) => {
    let c = compareStrings(a.itemId, b.itemId);
    if (c) return c;
    c = compareStrings(a.hubId, b.hubId);
    if (c) return c;
    return compareStrings(a.binId, b.binId);
  });

  return rows;
}

function buildShrink(ledgerEvents, filters) {
  // Shrink/adjustment summary derived from negative adjustments where:
  // - eventType contains "ADJUST" or "SHRINK" or "CYCLE"
  // and qtyDelta < 0
  const m = new Map();
  for (const ev of ledgerEvents) {
    if (!inRange(ev.occurredAtUtc, filters.fromUtc, filters.toUtc)) continue;

    const isAdjustment =
      (typeof ev.eventType === "string" && (ev.eventType.includes("ADJUST") || ev.eventType.includes("SHRINK") || ev.eventType.includes("CYCLE"))) ||
      (typeof ev.sourceType === "string" && (ev.sourceType === "ADJUSTMENT" || ev.sourceType === "CYCLE_COUNT"));

    if (!isAdjustment) continue;

    const filteredLines = applyCommonFilters(ev.lines, filters);
    for (const l of filteredLines) {
      if (!(l.qtyDelta < 0)) continue;
      const key = `${l.itemId}||${l.hubId || ""}||${l.binId || ""}`;
      const prev =
        m.get(key) || {
          itemId: l.itemId,
          hubId: l.hubId || null,
          binId: l.binId || null,
          qtyShrink: 0,
          eventsCount: 0,
          firstAtUtc: ev.occurredAtUtc,
          lastAtUtc: ev.occurredAtUtc,
        };
      prev.qtyShrink += Math.abs(l.qtyDelta);
      prev.eventsCount += 1;
      if (ev.occurredAtUtc < prev.firstAtUtc) prev.firstAtUtc = ev.occurredAtUtc;
      if (ev.occurredAtUtc > prev.lastAtUtc) prev.lastAtUtc = ev.occurredAtUtc;
      m.set(key, prev);
    }
  }

  const rows = Array.from(m.values()).map((r) => ({
    itemId: r.itemId,
    hubId: r.hubId,
    binId: r.binId,
    qtyShrink: Number(r.qtyShrink),
    eventsCount: Number(r.eventsCount),
    firstAtUtc: r.firstAtUtc,
    lastAtUtc: r.lastAtUtc,
  }));

  rows.sort((a, b) => {
    let c = compareStrings(a.itemId, b.itemId);
    if (c) return c;
    c = compareStrings(a.hubId, b.hubId);
    if (c) return c;
    return compareStrings(a.binId, b.binId);
  });

  return rows;
}

function buildValuation(ledgerEvents, filters) {
  // Explicit valuation method (single method):
  // Weighted Average Cost per item, derived strictly from inbound ledger lines with unitCost present and qtyDelta > 0.
  // avgCost(item) = sum(qty * unitCost) / sum(qty) over all inbound costed lines (within filters date window if provided)
  // stockQty(item, hub, bin) = sum(qtyDelta) across all ledger lines (within filters date window if provided)
  // extendedValue = stockQty * avgCost(item)  (if avgCost missing => 0, explicitly)
  //
  // Note: avgCost is computed tenant-wide per item (not per location) to remain deterministic and simple in MVP.
  const stockRows = buildStock(ledgerEvents, filters);

  const costAgg = new Map(); // itemId -> {qty, cost}
  for (const ev of ledgerEvents) {
    if (!inRange(ev.occurredAtUtc, filters.fromUtc, filters.toUtc)) continue;
    const lines = applyCommonFilters(ev.lines, { itemId: filters.itemId, hubId: null, binId: null }); // cost is item-scoped
    for (const l of lines) {
      if (!(l.qtyDelta > 0)) continue;
      if (l.unitCost === null || !Number.isFinite(l.unitCost)) continue;
      const prev = costAgg.get(l.itemId) || { qty: 0, cost: 0 };
      prev.qty += l.qtyDelta;
      prev.cost += l.qtyDelta * l.unitCost;
      costAgg.set(l.itemId, prev);
    }
  }

  const rows = stockRows.map((s) => {
    const agg = costAgg.get(s.itemId) || null;
    const avgCost = agg && agg.qty > 0 ? agg.cost / agg.qty : null;
    const extendedValue = avgCost === null ? 0 : Number(s.qtyOnHand) * avgCost;
    return {
      itemId: s.itemId,
      hubId: s.hubId,
      binId: s.binId,
      qtyOnHand: Number(s.qtyOnHand),
      avgUnitCost: avgCost === null ? null : Number(avgCost),
      extendedValue: Number(extendedValue),
      valuationMethod: "WAC_INBOUND_LEDGER_UNIT_COST",
    };
  });

  rows.sort((a, b) => {
    let c = compareStrings(a.itemId, b.itemId);
    if (c) return c;
    c = compareStrings(a.hubId, b.hubId);
    if (c) return c;
    return compareStrings(a.binId, b.binId);
  });

  return rows;
}

module.exports = {
  loadLedger,
  buildStock,
  buildMovements,
  buildReceiving,
  buildShrink,
  buildValuation,
  isIsoUtc,
};
