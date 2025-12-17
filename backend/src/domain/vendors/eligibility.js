function isIsoDateString(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

function toMillisOrNull(s) {
  if (!isIsoDateString(s)) return null;
  return Date.parse(s);
}

function isVendorEligible(vendor, tenantRules, nowUtcIso) {
  const nowIso = typeof nowUtcIso === "string" ? nowUtcIso : new Date().toISOString();
  const nowMs = toMillisOrNull(nowIso);

  const reasons = [];

  // Fail-closed on missing context
  if (!vendor || typeof vendor !== "object") {
    return { eligible: false, reasons: ["VENDOR_MISSING"], asOfUtc: nowIso };
  }
  if (!tenantRules || typeof tenantRules !== "object") {
    return { eligible: false, reasons: ["RULES_MISSING"], asOfUtc: nowIso };
  }
  if (!nowMs) {
    return { eligible: false, reasons: ["NOW_UTC_INVALID"], asOfUtc: nowIso };
  }

  if (vendor.status !== "ACTIVE") {
    reasons.push("VENDOR_STATUS_NOT_ACTIVE");
  }

  // Evidence container expected on vendor (passed in by caller) or separate.
  const evidence = vendor.complianceEvidence || null;

  function requireReceived(doc, missingCode, invalidCode) {
    if (!doc) return { ok: false, reason: missingCode };
    if (!doc.receivedAtUtc || !isIsoDateString(doc.receivedAtUtc)) {
      return { ok: false, reason: invalidCode };
    }
    return { ok: true };
  }

  function requireNotExpired(doc, missingCode, invalidCode, expiredCode) {
    if (!doc) return { ok: false, reason: missingCode };
    if (!doc.expiresAtUtc || !isIsoDateString(doc.expiresAtUtc)) {
      return { ok: false, reason: invalidCode };
    }
    const expMs = toMillisOrNull(doc.expiresAtUtc);
    if (!expMs) return { ok: false, reason: invalidCode };
    if (expMs <= nowMs) return { ok: false, reason: expiredCode };
    return { ok: true };
  }

  // Insurance
  if (tenantRules.insuranceRequired) {
    const doc = evidence && evidence.insurance ? evidence.insurance : null;

    const rec = requireReceived(doc, "INSURANCE_REQUIRED_MISSING", "INSURANCE_RECEIVED_AT_INVALID");
    if (!rec.ok) reasons.push(rec.reason);

    const exp = requireNotExpired(
      doc,
      "INSURANCE_REQUIRED_MISSING",
      "INSURANCE_EXPIRES_AT_INVALID",
      "INSURANCE_EXPIRED"
    );
    if (!exp.ok) reasons.push(exp.reason);
  }

  // W9
  if (tenantRules.w9Required) {
    const doc = evidence && evidence.w9 ? evidence.w9 : null;
    const rec = requireReceived(doc, "W9_REQUIRED_MISSING", "W9_RECEIVED_AT_INVALID");
    if (!rec.ok) reasons.push(rec.reason);
  }

  // License
  if (tenantRules.licenseRequired) {
    const doc = evidence && evidence.license ? evidence.license : null;

    const rec = requireReceived(doc, "LICENSE_REQUIRED_MISSING", "LICENSE_RECEIVED_AT_INVALID");
    if (!rec.ok) reasons.push(rec.reason);

    const exp = requireNotExpired(
      doc,
      "LICENSE_REQUIRED_MISSING",
      "LICENSE_EXPIRES_AT_INVALID",
      "LICENSE_EXPIRED"
    );
    if (!exp.ok) reasons.push(exp.reason);
  }

  // Deduplicate deterministically
  const uniq = Array.from(new Set(reasons)).sort();

  return {
    eligible: uniq.length === 0,
    reasons: uniq,
    asOfUtc: nowIso,
  };
}

module.exports = { isVendorEligible };
