// backend/src/domain/vendorEligibilityGate.js
const { getById } = require("../storage/jsonStore");

/**
 * B5 enforcement hook (fail-closed).
 * Expected vendor record shape (tenant-scoped):
 *   { vendorId, status: "ACTIVE"|"INACTIVE", eligibility: { eligible: true|false, reasonCode? } }
 *
 * If B5 uses a richer model, this gate still fails-closed unless it can positively confirm eligibility.
 */
function vendorEligibilityGate(ctx, vendorId) {
  const vendor = getById(ctx.tenantId, "vendors", "vendorId", String(vendorId));
  if (!vendor) {
    const err = new Error("Vendor not found");
    err.code = "VENDOR_INELIGIBLE";
    err.details = { reasonCode: "VENDOR_NOT_FOUND", vendorId: String(vendorId) };
    throw err;
  }

  // Fail-closed unless explicitly eligible
  const eligibleFlag =
    vendor &&
    vendor.status === "ACTIVE" &&
    vendor.eligibility &&
    vendor.eligibility.eligible === true;

  if (!eligibleFlag) {
    const err = new Error("Vendor is not eligible");
    err.code = "VENDOR_INELIGIBLE";
    err.details = {
      reasonCode:
        (vendor.eligibility && vendor.eligibility.reasonCode) ||
        (vendor.status !== "ACTIVE" ? "VENDOR_INACTIVE" : "VENDOR_NOT_ELIGIBLE"),
      vendorId: String(vendorId),
    };
    throw err;
  }

  return true;
}

module.exports = { vendorEligibilityGate };
