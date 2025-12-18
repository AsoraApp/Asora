// backend/src/middleware/rejectTenantOverride.js
"use strict";

const url = require("url");
const { forbidden } = require("../api/_errors");

/**
 * Reject any client attempt to provide/override tenant identity.
 * This is intentionally conservative (fail-closed).
 *
 * Checks:
 * - headers: x-tenant-id, x-tenant, tenant-id, tenantid
 * - query: tenantId, tenant_id, tenant
 */
function rejectTenantOverride(req, res) {
  const h = (req && req.headers) || {};
  const headerKeys = Object.keys(h).map((k) => k.toLowerCase());

  const headerHit =
    headerKeys.includes("x-tenant-id") ||
    headerKeys.includes("x-tenant") ||
    headerKeys.includes("tenant-id") ||
    headerKeys.includes("tenantid");

  const parsed = url.parse(req.url || "/", true);
  const q = (parsed && parsed.query) || {};
  const queryHit = q.tenantId !== undefined || q.tenant_id !== undefined || q.tenant !== undefined;

  if (headerHit || queryHit) {
    forbidden(res, "TENANT_OVERRIDE_REJECTED", null);
    return true;
  }
  return false;
}

module.exports = rejectTenantOverride;
