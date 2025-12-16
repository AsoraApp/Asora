import { PlaceholderInventoryReadStore } from "../../stores/placeholderInventoryReadStore.js";

const store = new PlaceholderInventoryReadStore();

function meta(req) {
  return {
    asOfUtc: new Date().toISOString(),
    requestId: req.ctx?.requestId || null
  };
}

function isValidSku(sku) {
  if (!sku) return false;
  if (sku.length > 64) return false;
  if (/\s/.test(sku)) return false;
  return true;
}

export async function listItems(req, res) {
  const tenantId = req.ctx?.tenantId;

  if (!tenantId) {
    return res.status(403).json({
      error: {
        code: "TENANT_UNRESOLVED",
        message: "Tenant unresolved",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  const items = store.listItems(tenantId);
  if (!items) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Items not found",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  return res.json({ data: items, meta: meta(req) });
}

export async function getItem(req, res) {
  const tenantId = req.ctx?.tenantId;
  const { itemId } = req.params;

  if (!tenantId) {
    return res.status(403).json({
      error: {
        code: "TENANT_UNRESOLVED",
        message: "Tenant unresolved",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  if (!itemId) {
    return res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Invalid itemId",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  const item = store.getItem(tenantId, itemId);
  if (!item) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Item not found",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  return res.json({ data: item, meta: meta(req) });
}

export async function getItemBySku(req, res) {
  const tenantId = req.ctx?.tenantId;
  const { sku } = req.params;

  if (!tenantId) {
    return res.status(403).json({
      error: {
        code: "TENANT_UNRESOLVED",
        message: "Tenant unresolved",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  if (!isValidSku(sku)) {
    return res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Invalid SKU format",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  const normalizedSku = sku.toUpperCase();
  const item = store.getItemBySku(tenantId, normalizedSku);

  if (!item) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Item not found",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  return res.json({ data: item, meta: meta(req) });
}

