const url = require("url");

const { emitAudit } = require("../observability/audit");
const {
  listVendors,
  getVendor,
  createVendor,
  replaceVendor,
  patchVendorStatus,
  getRules,
  getEvidence,
  replaceEvidence,
} = require("../domain/vendors/store");
const { isVendorEligible } = require("../domain/vendors/eligibility");

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function errorJson(res, status, code, message, ctx, details) {
  return sendJson(res, status, {
    error: {
      code,
      message,
      requestId: ctx?.requestId || null,
      details: details || null,
    },
  });
}

function normalizePath(u) {
  const q = u.indexOf("?");
  return q >= 0 ? u.slice(0, q) : u;
}

function nowUtcIso() {
  return new Date().toISOString();
}

// Central enforcement hook for procurement phases.
// B5 uses it for: eligible list + any “selectable/eligible” view.
function eligibilityGateOrFail({ tenantId, vendor, evidence, ctx }) {
  const rules = getRules(tenantId);
  const evalInput = { ...vendor, complianceEvidence: evidence || null };
  const decision = isVendorEligible(evalInput, rules, nowUtcIso());

  return {
    rules: rules || null,
    decision,
  };
}

module.exports = function vendorsRouter(req, res, ctx) {
  const parsedUrl = url.parse(req.url, true);
  const path = normalizePath(req.url);

  // GET /api/vendors (optional ?eligible=true filter)
  if (req.method === "GET" && path === "/api/vendors") {
    const eligibleFilter = parsedUrl.query && parsedUrl.query.eligible === "true";

    const vendors = listVendors(ctx.tenantId);

    if (!eligibleFilter) {
      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "VENDORS_LIST",
        objectType: "vendor",
        objectId: null,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: { eligibleFilter: false },
        correlationId: ctx.requestId,
      });
      return sendJson(res, 200, { vendors });
    }

    // Enforcement: eligible list must be computed via gate
    const rules = getRules(ctx.tenantId);
    if (!rules) {
      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "VENDORS_LIST_ELIGIBLE",
        objectType: "vendor",
        objectId: null,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "DENY",
        reasonCode: "RULES_MISSING",
        factsSnapshot: {},
        correlationId: ctx.requestId,
      });
      return errorJson(
        res,
        409,
        "CONFLICT",
        "Compliance rules are not configured.",
        ctx,
        { reason: "RULES_MISSING" }
      );
    }

    const eligibleVendors = [];
    for (const v of vendors) {
      const evidence = getEvidence(ctx.tenantId, v.vendorId) || null;
      const decision = isVendorEligible({ ...v, complianceEvidence: evidence }, rules, nowUtcIso());
      if (decision.eligible) eligibleVendors.push(v);
    }

    emitAudit({
      tenantId: ctx.tenantId,
      eventCategory: "VENDOR",
      eventType: "VENDORS_LIST_ELIGIBLE",
      objectType: "vendor",
      objectId: null,
      actorUserId: ctx.userId,
      actorRoleIds: ctx.roleIds || [],
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { eligibleFilter: true, returned: eligibleVendors.length },
      correlationId: ctx.requestId,
    });

    return sendJson(res, 200, { vendors: eligibleVendors });
  }

  // POST /api/vendors
  if (req.method === "POST" && path === "/api/vendors") {
    if (!ctx.body || typeof ctx.body !== "object") {
      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "VENDOR_CREATE",
        objectType: "vendor",
        objectId: null,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "DENY",
        reasonCode: "VALIDATION_ERROR",
        factsSnapshot: { detail: "body_required" },
        correlationId: ctx.requestId,
      });
      return errorJson(res, 400, "VALIDATION_ERROR", "Body is required.", ctx, { detail: "body_required" });
    }

    const result = createVendor(ctx.tenantId, ctx.body);
    if (!result.ok) {
      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "VENDOR_CREATE",
        objectType: "vendor",
        objectId: null,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "DENY",
        reasonCode: result.code || "VALIDATION_ERROR",
        factsSnapshot: { detail: result.detail },
        correlationId: ctx.requestId,
      });
      return errorJson(res, result.status || 400, result.code || "VALIDATION_ERROR", "Invalid vendor.", ctx, {
        detail: result.detail || null,
      });
    }

    emitAudit({
      tenantId: ctx.tenantId,
      eventCategory: "VENDOR",
      eventType: "VENDOR_CREATE",
      objectType: "vendor",
      objectId: result.vendor.vendorId,
      actorUserId: ctx.userId,
      actorRoleIds: ctx.roleIds || [],
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { vendorId: result.vendor.vendorId },
      correlationId: ctx.requestId,
    });

    return sendJson(res, 201, { vendor: result.vendor });
  }

  // Match vendorId routes:
  // GET  /api/vendors/:vendorId
  // PUT  /api/vendors/:vendorId
  // PATCH /api/vendors/:vendorId/status
  // GET  /api/vendors/:vendorId/compliance
  // PUT  /api/vendors/:vendorId/compliance
  // GET  /api/vendors/:vendorId/eligibility
  const m = path.match(/^\/api\/vendors\/([^/]+)(?:\/(status|compliance|eligibility))?$/);
  if (!m) return errorJson(res, 404, "NOT_FOUND", "Not found.", ctx);

  const vendorId = m[1];
  const sub = m[2] || null;

  // Base vendor resource
  if (!sub) {
    if (req.method === "GET") {
      const v = getVendor(ctx.tenantId, vendorId);
      if (!v) {
        emitAudit({
          tenantId: ctx.tenantId,
          eventCategory: "VENDOR",
          eventType: "VENDOR_READ",
          objectType: "vendor",
          objectId: vendorId,
          actorUserId: ctx.userId,
          actorRoleIds: ctx.roleIds || [],
          decision: "DENY",
          reasonCode: "NOT_FOUND",
          factsSnapshot: {},
          correlationId: ctx.requestId,
        });
        return errorJson(res, 404, "NOT_FOUND", "Vendor not found.", ctx);
      }

      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "VENDOR_READ",
        objectType: "vendor",
        objectId: vendorId,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: {},
        correlationId: ctx.requestId,
      });

      return sendJson(res, 200, { vendor: v });
    }

    if (req.method === "PUT") {
      if (!ctx.body || typeof ctx.body !== "object") {
        emitAudit({
          tenantId: ctx.tenantId,
          eventCategory: "VENDOR",
          eventType: "VENDOR_REPLACE",
          objectType: "vendor",
          objectId: vendorId,
          actorUserId: ctx.userId,
          actorRoleIds: ctx.roleIds || [],
          decision: "DENY",
          reasonCode: "VALIDATION_ERROR",
          factsSnapshot: { detail: "body_required" },
          correlationId: ctx.requestId,
        });
        return errorJson(res, 400, "VALIDATION_ERROR", "Body is required.", ctx, { detail: "body_required" });
      }

      const result = replaceVendor(ctx.tenantId, vendorId, ctx.body);
      if (!result.ok) {
        emitAudit({
          tenantId: ctx.tenantId,
          eventCategory: "VENDOR",
          eventType: "VENDOR_REPLACE",
          objectType: "vendor",
          objectId: vendorId,
          actorUserId: ctx.userId,
          actorRoleIds: ctx.roleIds || [],
          decision: "DENY",
          reasonCode: result.code || "VALIDATION_ERROR",
          factsSnapshot: { detail: result.detail },
          correlationId: ctx.requestId,
        });
        return errorJson(res, result.status || 400, result.code || "VALIDATION_ERROR", "Vendor update failed.", ctx, {
          detail: result.detail || null,
        });
      }

      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "VENDOR_REPLACE",
        objectType: "vendor",
        objectId: vendorId,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: {},
        correlationId: ctx.requestId,
      });

      return sendJson(res, 200, { vendor: result.vendor });
    }

    return errorJson(res, 409, "METHOD_NOT_ALLOWED", "Method not allowed.", ctx);
  }

  // PATCH /api/vendors/:vendorId/status
  if (sub === "status") {
    if (req.method !== "PATCH") return errorJson(res, 409, "METHOD_NOT_ALLOWED", "Method not allowed.", ctx);

    if (!ctx.body || typeof ctx.body !== "object") {
      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "VENDOR_STATUS_PATCH",
        objectType: "vendor",
        objectId: vendorId,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "DENY",
        reasonCode: "VALIDATION_ERROR",
        factsSnapshot: { detail: "body_required" },
        correlationId: ctx.requestId,
      });
      return errorJson(res, 400, "VALIDATION_ERROR", "Body is required.", ctx, { detail: "body_required" });
    }

    const result = patchVendorStatus(ctx.tenantId, vendorId, ctx.body.status);
    if (!result.ok) {
      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "VENDOR_STATUS_PATCH",
        objectType: "vendor",
        objectId: vendorId,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "DENY",
        reasonCode: result.code || "VALIDATION_ERROR",
        factsSnapshot: { detail: result.detail },
        correlationId: ctx.requestId,
      });
      return errorJson(res, result.status || 400, result.code || "VALIDATION_ERROR", "Status update failed.", ctx, {
        detail: result.detail || null,
      });
    }

    emitAudit({
      tenantId: ctx.tenantId,
      eventCategory: "VENDOR",
      eventType: "VENDOR_STATUS_PATCH",
      objectType: "vendor",
      objectId: vendorId,
      actorUserId: ctx.userId,
      actorRoleIds: ctx.roleIds || [],
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { status: result.vendor.status },
      correlationId: ctx.requestId,
    });

    return sendJson(res, 200, { vendor: result.vendor });
  }

  // GET/PUT /api/vendors/:vendorId/compliance (replace evidence deterministically)
  if (sub === "compliance") {
    if (req.method === "GET") {
      const v = getVendor(ctx.tenantId, vendorId);
      if (!v) return errorJson(res, 404, "NOT_FOUND", "Vendor not found.", ctx);

      const evidence = getEvidence(ctx.tenantId, vendorId) || null;

      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "VENDOR_COMPLIANCE_READ",
        objectType: "vendor_compliance",
        objectId: vendorId,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: {},
        correlationId: ctx.requestId,
      });

      return sendJson(res, 200, { vendorId, evidence });
    }

    if (req.method === "PUT") {
      if (!ctx.body || typeof ctx.body !== "object") {
        emitAudit({
          tenantId: ctx.tenantId,
          eventCategory: "VENDOR",
          eventType: "VENDOR_COMPLIANCE_REPLACE",
          objectType: "vendor_compliance",
          objectId: vendorId,
          actorUserId: ctx.userId,
          actorRoleIds: ctx.roleIds || [],
          decision: "DENY",
          reasonCode: "VALIDATION_ERROR",
          factsSnapshot: { detail: "body_required" },
          correlationId: ctx.requestId,
        });
        return errorJson(res, 400, "VALIDATION_ERROR", "Body is required.", ctx, { detail: "body_required" });
      }

      const result = replaceEvidence(ctx.tenantId, vendorId, ctx.body);
      if (!result.ok) {
        emitAudit({
          tenantId: ctx.tenantId,
          eventCategory: "VENDOR",
          eventType: "VENDOR_COMPLIANCE_REPLACE",
          objectType: "vendor_compliance",
          objectId: vendorId,
          actorUserId: ctx.userId,
          actorRoleIds: ctx.roleIds || [],
          decision: "DENY",
          reasonCode: result.code || "VALIDATION_ERROR",
          factsSnapshot: { detail: result.detail },
          correlationId: ctx.requestId,
        });
        return errorJson(res, result.status || 400, result.code || "VALIDATION_ERROR", "Compliance update failed.", ctx, {
          detail: result.detail || null,
        });
      }

      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "VENDOR_COMPLIANCE_REPLACE",
        objectType: "vendor_compliance",
        objectId: vendorId,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "ALLOW",
        reasonCode: "OK",
        factsSnapshot: {},
        correlationId: ctx.requestId,
      });

      return sendJson(res, 200, { vendorId, evidence: result.evidence });
    }

    return errorJson(res, 409, "METHOD_NOT_ALLOWED", "Method not allowed.", ctx);
  }

  // GET /api/vendors/:vendorId/eligibility
  if (sub === "eligibility") {
    if (req.method !== "GET") return errorJson(res, 409, "METHOD_NOT_ALLOWED", "Method not allowed.", ctx);

    const v = getVendor(ctx.tenantId, vendorId);
    if (!v) return errorJson(res, 404, "NOT_FOUND", "Vendor not found.", ctx);

    const evidence = getEvidence(ctx.tenantId, vendorId) || null;

    const { rules, decision } = eligibilityGateOrFail({
      tenantId: ctx.tenantId,
      vendor: v,
      evidence,
      ctx,
    });

    emitAudit({
      tenantId: ctx.tenantId,
      eventCategory: "VENDOR",
      eventType: "VENDOR_ELIGIBILITY_EVAL",
      objectType: "vendor",
      objectId: vendorId,
      actorUserId: ctx.userId,
      actorRoleIds: ctx.roleIds || [],
      decision: "ALLOW",
      reasonCode: decision.eligible ? "ELIGIBLE" : "INELIGIBLE",
      factsSnapshot: { reasons: decision.reasons, asOfUtc: decision.asOfUtc },
      correlationId: ctx.requestId,
    });

    return sendJson(res, 200, {
      vendorId,
      rules: rules || null,
      eligibility: decision,
    });
  }

  return errorJson(res, 404, "NOT_FOUND", "Not found.", ctx);
};
