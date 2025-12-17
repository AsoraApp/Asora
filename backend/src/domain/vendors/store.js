const crypto = require("crypto");

const TENANT = new Map(); // tenantId -> { vendors: Map, rules: object|null, evidence: Map }

function nowUtcIso() {
  return new Date().toISOString();
}

function getTenantBucket(tenantId) {
  if (!tenantId) throw new Error("tenantId_required");
  if (!TENANT.has(tenantId)) {
    TENANT.set(tenantId, {
      vendors: new Map(),
      rules: null,
      evidence: new Map(), // vendorId -> evidence object
    });
  }
  return TENANT.get(tenantId);
}

function newId() {
  return crypto.randomUUID();
}

function normalizeVendorInput(body) {
  const b = body || {};
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "name_required" };

  const status = b.status ? String(b.status) : "ACTIVE";
  if (!["ACTIVE", "INACTIVE", "SUSPENDED"].includes(status)) {
    return { ok: false, error: "invalid_status" };
  }

  const contact = b.contact && typeof b.contact === "object" ? b.contact : {};
  const email = typeof contact.email === "string" ? contact.email.trim() : null;
  const phone = typeof contact.phone === "string" ? contact.phone.trim() : null;

  const identifiers = b.identifiers && typeof b.identifiers === "object" ? b.identifiers : {};
  const taxIdLast4 =
    typeof identifiers.taxIdLast4 === "string" ? identifiers.taxIdLast4.trim() : null;
  if (taxIdLast4 && !/^\d{4}$/.test(taxIdLast4)) return { ok: false, error: "invalid_taxIdLast4" };

  return {
    ok: true,
    value: {
      name,
      status,
      contact: { email, phone },
      identifiers: { taxIdLast4 },
    },
  };
}

function listVendors(tenantId) {
  const t = getTenantBucket(tenantId);
  return Array.from(t.vendors.values()).sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc));
}

function getVendor(tenantId, vendorId) {
  const t = getTenantBucket(tenantId);
  return t.vendors.get(vendorId) || null;
}

function createVendor(tenantId, body) {
  const parsed = normalizeVendorInput(body);
  if (!parsed.ok) return { ok: false, status: 400, code: "VALIDATION_ERROR", detail: parsed.error };

  const t = getTenantBucket(tenantId);
  const vendorId = newId();
  const ts = nowUtcIso();

  const vendor = {
    vendorId,
    tenantId,
    ...parsed.value,
    createdAtUtc: ts,
    updatedAtUtc: ts,
  };

  t.vendors.set(vendorId, vendor);
  if (!t.evidence.has(vendorId)) t.evidence.set(vendorId, {});
  return { ok: true, vendor };
}

function replaceVendor(tenantId, vendorId, body) {
  const t = getTenantBucket(tenantId);
  const existing = t.vendors.get(vendorId);
  if (!existing) return { ok: false, status: 404, code: "NOT_FOUND", detail: "vendor_not_found" };

  const parsed = normalizeVendorInput(body);
  if (!parsed.ok) return { ok: false, status: 400, code: "VALIDATION_ERROR", detail: parsed.error };

  const ts = nowUtcIso();
  const vendor = {
    vendorId,
    tenantId,
    ...parsed.value,
    createdAtUtc: existing.createdAtUtc,
    updatedAtUtc: ts,
  };

  t.vendors.set(vendorId, vendor);
  if (!t.evidence.has(vendorId)) t.evidence.set(vendorId, {});
  return { ok: true, vendor };
}

function patchVendorStatus(tenantId, vendorId, status) {
  const t = getTenantBucket(tenantId);
  const existing = t.vendors.get(vendorId);
  if (!existing) return { ok: false, status: 404, code: "NOT_FOUND", detail: "vendor_not_found" };

  const next = String(status || "");
  if (!["ACTIVE", "INACTIVE", "SUSPENDED"].includes(next)) {
    return { ok: false, status: 400, code: "VALIDATION_ERROR", detail: "invalid_status" };
  }

  const updated = { ...existing, status: next, updatedAtUtc: nowUtcIso() };
  t.vendors.set(vendorId, updated);
  return { ok: true, vendor: updated };
}

function normalizeRulesInput(body) {
  const b = body || {};
  const insuranceRequired = !!b.insuranceRequired;
  const w9Required = !!b.w9Required;
  const licenseRequired = !!b.licenseRequired;

  // Explicit, deterministic booleans only.
  return {
    ok: true,
    value: { insuranceRequired, w9Required, licenseRequired },
  };
}

function getRules(tenantId) {
  const t = getTenantBucket(tenantId);
  return t.rules;
}

function replaceRules(tenantId, body) {
  const parsed = normalizeRulesInput(body);
  if (!parsed.ok) return { ok: false, status: 400, code: "VALIDATION_ERROR", detail: parsed.error };
  const t = getTenantBucket(tenantId);
  t.rules = { ...parsed.value, updatedAtUtc: nowUtcIso() };
  return { ok: true, rules: t.rules };
}

function normalizeEvidenceInput(body) {
  const b = body || {};
  if (typeof b !== "object" || Array.isArray(b)) return { ok: false, error: "evidence_must_be_object" };

  function normDoc(doc) {
    if (doc == null) return null;
    if (typeof doc !== "object" || Array.isArray(doc)) return "__INVALID__";
    const receivedAtUtc = typeof doc.receivedAtUtc === "string" ? doc.receivedAtUtc : null;
    const expiresAtUtc = typeof doc.expiresAtUtc === "string" ? doc.expiresAtUtc : null;
    const documentType = typeof doc.documentType === "string" ? doc.documentType : null;

    // Metadata only. Dates validated later by eligibility (fail-closed).
    return { receivedAtUtc, expiresAtUtc, documentType };
  }

  const insurance = normDoc(b.insurance);
  const w9 = normDoc(b.w9);
  const license = normDoc(b.license);

  if (insurance === "__INVALID__" || w9 === "__INVALID__" || license === "__INVALID__") {
    return { ok: false, error: "invalid_evidence_shape" };
  }

  return { ok: true, value: { insurance, w9, license, updatedAtUtc: nowUtcIso() } };
}

function getEvidence(tenantId, vendorId) {
  const t = getTenantBucket(tenantId);
  return t.evidence.get(vendorId) || null;
}

function replaceEvidence(tenantId, vendorId, body) {
  const t = getTenantBucket(tenantId);
  const existingVendor = t.vendors.get(vendorId);
  if (!existingVendor) return { ok: false, status: 404, code: "NOT_FOUND", detail: "vendor_not_found" };

  const parsed = normalizeEvidenceInput(body);
  if (!parsed.ok) return { ok: false, status: 400, code: "VALIDATION_ERROR", detail: parsed.error };

  t.evidence.set(vendorId, parsed.value);
  return { ok: true, evidence: parsed.value };
}

module.exports = {
  listVendors,
  getVendor,
  createVendor,
  replaceVendor,
  patchVendorStatus,
  getRules,
  replaceRules,
  getEvidence,
  replaceEvidence,
};

