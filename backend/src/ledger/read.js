// backend/src/ledger/read.js
//
// B4 support: deterministic ledger reads for cycle count freeze snapshots.
// Exposes:
// - getCursorAsOfNow({ tenantId }) -> opaque cursor
// - getQtyAsOf({ tenantId, hubId, binId, skuId, cursor }) -> number
//
// Cursor strategy (deterministic, local):
// - Cursor is the count of events visible "now" for that tenant (events.length)
// - getQtyAsOf sums deltas for matching keys for events[0:cursor)
//
// This stays append-only and fail-closed: tenantId required.

const store = require("./store");

function requireTenant(tenantId) {
  if (!tenantId) {
    const err = new Error("Tenant unresolved (fail-closed).");
    err.statusCode = 403;
    err.reasonCode = "TENANT_UNRESOLVED";
    throw err;
  }
}

// Best-effort adapter: supports different store APIs without guessing outside this module.
function readAllEventsForTenant(tenantId) {
  // Prefer explicit tenant-scoped methods if they exist.
  if (typeof store.listEventsByTenant === "function") return store.listEventsByTenant(tenantId);
  if (typeof store.getEventsByTenant === "function") return store.getEventsByTenant(tenantId);

  // Otherwise, get all and filter.
  if (typeof store.listEvents === "function") {
    const all = store.listEvents();
    return Array.isArray(all) ? all.filter((e) => e && e.tenantId === tenantId) : [];
  }

  if (typeof store.getAll === "function") {
    const all = store.getAll();
    return Array.isArray(all) ? all.filter((e) => e && e.tenantId === tenantId) : [];
  }

  // Hard fail-closed if store API is unknown.
  const err = new Error("Ledger store read API not found (fail-closed).");
  err.statusCode = 500;
  err.reasonCode = "LEDGER_READ_UNAVAILABLE";
  throw err;
}

async function getCursorAsOfNow({ tenantId }) {
  requireTenant(tenantId);
  const events = readAllEventsForTenant(tenantId);
  // Opaque cursor: integer count is sufficient for deterministic as-of on a local append-only list.
  return events.length;
}

async function getQtyAsOf({ tenantId, hubId, binId, skuId, cursor }) {
  requireTenant(tenantId);

  if (!hubId || !binId || !skuId) {
    const err = new Error("hubId/binId/skuId are required (fail-closed).");
    err.statusCode = 400;
    err.reasonCode = "LINE_KEYS_REQUIRED";
    throw err;
  }

  if (cursor === null || cursor === undefined || cursor === "") {
    const err = new Error("cursor is required (fail-closed).");
    err.statusCode = 409;
    err.reasonCode = "LEDGER_CURSOR_REQUIRED";
    throw err;
  }

  const events = readAllEventsForTenant(tenantId);

  const n = Number(cursor);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error("cursor is invalid (fail-closed).");
    err.statusCode = 409;
    err.reasonCode = "LEDGER_CURSOR_INVALID";
    throw err;
  }

  const end = Math.min(events.length, Math.floor(n));

  let qty = 0;

  for (let i = 0; i < end; i += 1) {
    const e = events[i];
    if (!e) continue;

    // Expected canonical keys (B3): tenantId + hubId + binId + skuId + deltaQty
    // Be tolerant to naming variations while staying deterministic.
    const eHub = e.hubId ?? e.hub ?? e.locationHubId ?? null;
    const eBin = e.binId ?? e.bin ?? e.locationBinId ?? null;
    const eSku = e.skuId ?? e.sku ?? e.itemSkuId ?? null;

    if (eHub !== hubId || eBin !== binId || eSku !== skuId) continue;

    const delta =
      e.deltaQty ??
      e.delta ??
      e.qtyDelta ??
      e.quantityDelta ??
      e.quantity_change ??
      0;

    if (typeof delta === "number" && Number.isFinite(delta)) {
      qty += delta;
    }
  }

  return qty;
}

module.exports = {
  getCursorAsOfNow,
  getQtyAsOf,
};
