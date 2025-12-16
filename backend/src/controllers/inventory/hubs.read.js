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

module.exports.listHubs = async function listHubs(req, res) {
  const tenantId = tenantOr403(req, res);
  if (!tenantId) return;

  const hubs = store.listHubs(tenantId);
  if (!hubs) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Not found", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  res.json({ data: hubs, meta: getMeta(req) });
};

module.exports.getHub = async function getHub(req, res) {
  const tenantId = tenantOr403(req, res);
  if (!tenantId) return;

  const hubId = req.params?.hubId;
  if (!hubId) {
    res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Invalid hubId", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  const hub = store.getHub(tenantId, hubId);
  if (!hub) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Hub not found", requestId: req.ctx?.requestId || null }
    });
    return;
  }

  res.json({ data: hub, meta: getMeta(req) });
};
