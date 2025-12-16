const { PlaceholderInventoryReadStore } = require("../../stores/placeholderInventoryReadStore.js");

const store = new PlaceholderInventoryReadStore();

const ALLOWED_FILTERS = new Set(["hubId", "binId", "itemId"]);

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

module.exports.listStock = async function listStock(req, res) {
  const tenantId = tenantOr403(req, res);
  if (!tenantId) return;

  const query = req.query || {};
  const filters = {};

  for (const key of Object.keys(query)) {
    if (!ALLOWED_FILTERS.has(key)) {
      res.status(400).json({
        error: {
          code: "BAD_REQUEST",
          message: "Invalid stock filter",
          requestId: req.ctx?.requestId || null
        }
      });
      return;
    }
    if (query[key]) filters[key] = query[key];
  }

  const rows = store.listStock(tenantId, filters);
  if (!rows) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Stock not found", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  const asOfUtc = new Date().toISOString();
  const data = rows.map((r) => ({ ...r, asOfUtc }));

  res.json({
    data,
    meta: {
      asOfUtc,
      requestId: req.ctx?.requestId || null
    }
  });
};
