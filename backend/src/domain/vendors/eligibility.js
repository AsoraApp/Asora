const { loadTenantCollection } = require("../../storage/jsonStore");

/**
 * B5 eligibility gate (fail-closed):
 * - If vendor does not exist -> ineligible
 * - If eligibility cannot be determined from stored compliance facts -> ineligible
 *
 * Storage expectations (tenant-scoped):
 * - vendors.json: [{ vendorId, status, ... }]
 * - vendor_compliance.json: [{ vendorId, eligible, status, ... }]
 *
 * NOTE: If your B5 implementation uses a different filename, update it here only.
 */
function getVendorRecord(tenantId, vendorId) {
  const vendors = loadTenantCollection(tenantId, "vendors.json", []);
  return (vendors || []).find((v) => String(v.vendorId) === String(vendorId)) || null;
}

function getVendorCompliance(tenantId, vendorId) {
  const compliance = loadTenantCollection(tenantId, "vendor_compliance.json", []);
  return (compliance || []).find((c) => String(c.vendorId) === String(vendorId)) || null;
}

function isVendorEligible(tenantId, vendorId) {
  if (!tenantId || !vendorId) return false;

  const v = getVendorRecord(tenantId, vendorId);
  if (!v) return false;

  // Vendor record must be ACTIVE (or equivalent) to proceed (fail-closed)
  if (String(v.status || "").toUpperCase() !== "ACTIVE") return false;

  const c = getVendorCompliance(tenantId, vendorId);
  if (!c) return false;

  // Eligibility must be explicitly true (fail-closed)
  if (c.eligible === true) return true;

  // Alternate explicit status allowlist (fail-closed otherwise)
  if (String(c.status || "").toUpperCase() === "ELIGIBLE") return true;

  return false;
}

module.exports = {
  isVendorEligible,
};
