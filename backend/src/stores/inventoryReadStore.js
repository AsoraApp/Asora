/*
  Inventory Read Store Contract (B2)

  All functions are READ-ONLY.
  All functions are tenant-scoped.
  tenantId MUST be the first argument for every call.
*/

export class InventoryReadStore {
  listHubs(tenantId) {
    throw new Error("listHubs not implemented");
  }

  getHub(tenantId, hubId) {
    throw new Error("getHub not implemented");
  }

  listBinsByHub(tenantId, hubId) {
    throw new Error("listBinsByHub not implemented");
  }

  getBin(tenantId, binId) {
    throw new Error("getBin not implemented");
  }

  listItems(tenantId) {
    throw new Error("listItems not implemented");
  }

  getItem(tenantId, itemId) {
    throw new Error("getItem not implemented");
  }

  getItemBySku(tenantId, skuUpper) {
    throw new Error("getItemBySku not implemented");
  }

  listStock(tenantId, filters) {
    throw new Error("listStock not implemented");
  }
}
