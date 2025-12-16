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

module.exports.listBinsByHub = async function listBinsByHub(req, res) {
  const tenantId = tenantOr403(req, res);
  if (!tenantId) return;

  const hubId = req.params?.hubId;
  if (!hubId) {
    res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Invalid hubId", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  const bins = store.listBinsByHub(tenantId, hubId);
  if (!bins) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Hub not found", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  res.json({ data: bins, meta: getMeta(req) });
};

module.exports.getBin = async function getBin(req, res) {
  const tenantId = tenantOr403(req, res);
  if (!tenantId) return;

  const binId = req.params?.binId;
  if (!binId) {
    res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Invalid binId", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  const bin = store.getBin(tenantId, binId);
  if (!bin) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Bin not found", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  res.json({ data: bin, meta: getMeta(req) });
};
