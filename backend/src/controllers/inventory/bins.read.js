import { PlaceholderInventoryReadStore } from "../../stores/placeholderInventoryReadStore.js";

const store = new PlaceholderInventoryReadStore();

function meta(req) {
  return {
    asOfUtc: new Date().toISOString(),
    requestId: req.ctx?.requestId || null
  };
}

export async function listBinsByHub(req, res) {
  const tenantId = req.ctx?.tenantId;
  const { hubId } = req.params;

  if (!tenantId) {
    return res.status(403).json({
      error: {
        code: "TENANT_UNRESOLVED",
        message: "Tenant unresolved",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  if (!hubId) {
    return res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Invalid hubId",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  const bins = store.listBinsByHub(tenantId, hubId);
  if (!bins) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Hub not found",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  return res.json({ data: bins, meta: meta(req) });
}

export async function getBin(req, res) {
  const tenantId = req.ctx?.tenantId;
  const { binId } = req.params;

  if (!tenantId) {
    return res.status(403).json({
      error: {
        code: "TENANT_UNRESOLVED",
        message: "Tenant unresolved",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  if (!binId) {
    return res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Invalid binId",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  const bin = store.getBin(tenantId, binId);
  if (!bin) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Bin not found",
        requestId: req.ctx?.requestId || null
      }
    });
  }

  return res.json({ data: bin, meta: meta(req) });
}

