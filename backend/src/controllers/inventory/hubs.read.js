import { PlaceholderInventoryReadStore } from "../../stores/placeholderInventoryReadStore.js";

const store = new PlaceholderInventoryReadStore();

function meta(req) {
  return {
    asOfUtc: new Date().toISOString(),
    requestId: req.ctx?.requestId || null
  };
}

export async function listHubs(req, res) {
  const tenantId = req.ctx?.tenantId;
  if (!tenantId) {
    return res.status(403).json({
      error: { code: "TENANT_UNRESOLVED", message: "Tenant unresolved", requestId: req.ctx?.requestId || null }
    });
  }

  const hubs = store.listHubs(tenantId);
  if (!hubs) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Not found", requestId: req.ctx?.requestId || null }
    });
  }

  return res.json({ data: hubs, meta: meta(req) });
}

export async function getHub(req, res) {
  const tenantId = req.ctx?.tenantId;
  const { hubId } = req.params;

  if (!tenantId) {
    return res.status(403).json({
      error: { code: "TENANT_UNRESOLVED", message: "Tenant unresolved", requestId: req.ctx?.requestId || null }
    });
  }

  if (!hubId) {
    return res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Invalid hubId", requestId: req.ctx?.requestId || null }
    });
  }

  const hub = store.getHub(tenantId, hubId);
  if (!hub) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Hub not found", requestId: req.ctx?.requestId || null }
    });
  }

  return res.json({ data: hub, meta: meta(req) });
}

