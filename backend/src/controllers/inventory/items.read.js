const { PlaceholderInventoryReadStore } = require("../../stores/placeholderInventoryReadStore.js");

const store = new PlaceholderInventoryReadStore();

function getMeta(req) {
  return {
    asOfUtc: new Date().toISOString(),
    requestId: req.ctx?.requestId || null
  };
}

function tenantOr403(req, res) {
  if (!req.ctx?.tenantId) {
    res.status(403).json({
      error: {
        code: "TENANT_UNRESOLVED",
        message: "Tenant unresolved",
        requestId: req.ctx?.requestId || null
      }
    });
    return null;
  }
  return req.ctx.tenantId;
}

function isValidSku(sku) {
  if (!sku) return false;
  if (sku.length > 64) return false;
  if (/\s/.test(sku)) return false;
  return true;
}

module.exports.listItems = async function listItems(req, res) {
  const tenantId = tenantOr403(req, res);
  if (!tenantId) return;

  const items = store.listItems(tenantId);
  if (!items) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Items not found", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  res.json({ data: items, meta: getMeta(req) });
};

module.exports.getItem = async function getItem(req, res) {
  const tenantId = tenantOr403(req, res);
  if (!tenantId) return;

  const itemId = req.params?.itemId;
  if (!itemId) {
    res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Invalid itemId", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  const item = store.getItem(tenantId, itemId);
  if (!item) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Item not found", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  res.json({ data: item, meta: getMeta(req) });
};

module.exports.getItemBySku = async function getItemBySku(req, res) {
  const tenantId = tenantOr403(req, res);
  if (!tenantId) return;

  const sku = req.params?.sku;
  if (!isValidSku(sku)) {
    res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Invalid SKU format", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  const item = store.getItemBySku(tenantId, sku.toUpperCase());
  if (!item) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Item not found", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  res.json({ data: item, meta: getMeta(req) });
};
