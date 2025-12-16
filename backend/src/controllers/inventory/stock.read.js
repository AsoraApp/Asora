import { PlaceholderInventoryReadStore } from "../../stores/placeholderInventoryReadStore.js";

const store = new PlaceholderInventoryReadStore();

function meta(req) {
  return {
    asOfUtc: new Date().toISOString(),
    requestId: req.ctx?.requestId || null
  };
}

const ALLOWED_FILTERS = new Set(["hubId", "binId", "itemId"]);

export async function listStock(req, res) {
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

  const filters = {};
  for (const key of Object.keys(req.query || {})) {
    if (!ALLOWED_FILTERS.has(key)) {
      return res.status(400).json({
        error: {
          code: "BAD_REQUEST",
          message: "Invalid stock filter",
          requestId: req.ctx?.requestId || null
        }
      });
    }
    filters[key] = req.query[key];
  }

  const rows = store.listStock(tenantId, filters);

  if (!rows) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Stock not found",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  const asOfUtc = meta(req).asOfUtc;
  const data = rows.map(r => ({ ...r, asOfUtc }));

  return res.json({
    data,
    meta: {
      asOfUtc,
      requestId: req.ctx?.requestId || null
    }
  });
}

