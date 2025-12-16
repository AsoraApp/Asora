const { InventoryReadStore } = require("./inventoryReadStore.js");

const CREATED_AT = "2025-01-01T00:00:00.000Z";

const DATA = {
  tenantA: {
    hubs: [
      { hubId: "hub-a-1", displayName: "Main Hub", code: "MAIN", status: "ACTIVE", createdAtUtc: CREATED_AT }
    ],
    bins: [
      { binId: "bin-a-1", hubId: "hub-a-1", label: "A1", path: "MAIN/A1", status: "ACTIVE", createdAtUtc: CREATED_AT },
      { binId: "bin-a-2", hubId: "hub-a-1", label: "A2", path: "MAIN/A2", status: "ACTIVE", createdAtUtc: CREATED_AT }
    ],
    items: [
      { itemId: "item-a-1", sku: "SKU-001", displayName: "Item One", uom: "EA", status: "ACTIVE", createdAtUtc: CREATED_AT },
      { itemId: "item-a-2", sku: "SKU-002", displayName: "Item Two", uom: "EA", status: "ACTIVE", createdAtUtc: CREATED_AT }
    ],
    stock: [
      { hubId: "hub-a-1", binId: "bin-a-1", itemId: "item-a-1", sku: "SKU-001", qtyOnHand: 10, qtyAvailable: 10 },
      { hubId: "hub-a-1", binId: "bin-a-2", itemId: "item-a-2", sku: "SKU-002", qtyOnHand: 5, qtyAvailable: 5 }
    ]
  },
  tenantB: {
    hubs: [
      { hubId: "hub-b-1", displayName: "Secondary Hub", code: "SEC", status: "ACTIVE", createdAtUtc: CREATED_AT }
    ],
    bins: [
      { binId: "bin-b-1", hubId: "hub-b-1", label: "B1", path: "SEC/B1", status: "ACTIVE", createdAtUtc: CREATED_AT }
    ],
    items: [
      { itemId: "item-b-1", sku: "SKU-101", displayName: "Item Alpha", uom: "EA", status: "ACTIVE", createdAtUtc: CREATED_AT }
    ],
    stock: [
      { hubId: "hub-b-1", binId: "bin-b-1", itemId: "item-b-1", sku: "SKU-101", qtyOnHand: 7, qtyAvailable: 7 }
    ]
  }
};

function requireTenant(tenantId) {
  if (!tenantId || !DATA[tenantId]) return null;
  return DATA[tenantId];
}

class PlaceholderInventoryReadStore extends InventoryReadStore {
  listHubs(tenantId) {
    const t = requireTenant(tenantId);
    if (!t) return null;
    return [...t.hubs].sort(
      (a, b) => a.displayName.localeCompare(b.displayName) || a.hubId.localeCompare(b.hubId)
    );
  }

  getHub(tenantId, hubId) {
    const t = requireTenant(tenantId);
    if (!t) return null;
    return t.hubs.find((h) => h.hubId === hubId) || null;
  }

  listBinsByHub(tenantId, hubId) {
    const t = requireTenant(tenantId);
    if (!t) return null;
    const hubExists = t.hubs.some((h) => h.hubId === hubId);
    if (!hubExists) return null;
    return t.bins
      .filter((b) => b.hubId === hubId)
      .sort((a, b) => a.label.localeCompare(b.label) || a.binId.localeCompare(b.binId));
  }

  getBin(tenantId, binId) {
    const t = requireTenant(tenantId);
    if (!t) return null;
    return t.bins.find((b) => b.binId === binId) || null;
  }

  listItems(tenantId) {
    const t = requireTenant(tenantId);
    if (!t) return null;
    return [...t.items].sort((a, b) => a.sku.localeCompare(b.sku) || a.itemId.localeCompare(b.itemId));
  }

  getItem(tenantId, itemId) {
    const t = requireTenant(tenantId);
    if (!t) return null;
    return t.items.find((i) => i.itemId === itemId) || null;
  }

  getItemBySku(tenantId, skuUpper) {
    const t = requireTenant(tenantId);
    if (!t) return null;
    return t.items.find((i) => i.sku === skuUpper) || null;
  }

  listStock(tenantId, filters = {}) {
    const t = requireTenant(tenantId);
    if (!t) return null;

    let rows = [...t.stock];

    if (filters.hubId) {
      if (!t.hubs.some((h) => h.hubId === filters.hubId)) return null;
      rows = rows.filter((r) => r.hubId === filters.hubId);
    }

    if (filters.binId) {
      if (!t.bins.some((b) => b.binId === filters.binId)) return null;
      rows = rows.filter((r) => r.binId === filters.binId);
    }

    if (filters.itemId) {
      if (!t.items.some((i) => i.itemId === filters.itemId)) return null;
      rows = rows.filter((r) => r.itemId === filters.itemId);
    }

    return rows.sort(
      (a, b) =>
        a.itemId.localeCompare(b.itemId) ||
        a.hubId.localeCompare(b.hubId) ||
        a.binId.localeCompare(b.binId)
    );
  }
}

module.exports = { PlaceholderInventoryReadStore };
