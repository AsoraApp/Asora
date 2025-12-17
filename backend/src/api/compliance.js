const { emitAudit } = require("../observability/audit");
const { getRules, replaceRules } = require("../domain/vendors/store");

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

function normalizePath(url) {
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

module.exports = function complianceRouter(req, res, ctx) {
  const path = normalizePath(req.url);

  // GET /api/compliance/rules
  if (req.method === "GET" && path === "/api/compliance/rules") {
    const rules = getRules(ctx.tenantId);
    emitAudit({
      tenantId: ctx.tenantId,
      eventCategory: "VENDOR",
      eventType: "COMPLIANCE_RULES_READ",
      objectType: "compliance_rules",
      objectId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorRoleIds: ctx.roleIds || [],
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: {},
      correlationId: ctx.requestId,
    });
    return sendJson(res, 200, { rules: rules || null });
  }

  // PUT /api/compliance/rules (replace whole ruleset)
  if (req.method === "PUT" && path === "/api/compliance/rules") {
    if (!ctx.body || typeof ctx.body !== "object") {
      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "COMPLIANCE_RULES_REPLACE",
        objectType: "compliance_rules",
        objectId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "DENY",
        reasonCode: "VALIDATION_ERROR",
        factsSnapshot: { detail: "body_required" },
        correlationId: ctx.requestId,
      });
      return errorJson(res, 400, "VALIDATION_ERROR", "Body is required.", ctx, {
        detail: "body_required",
      });
    }

    const result = replaceRules(ctx.tenantId, ctx.body);
    if (!result.ok) {
      emitAudit({
        tenantId: ctx.tenantId,
        eventCategory: "VENDOR",
        eventType: "COMPLIANCE_RULES_REPLACE",
        objectType: "compliance_rules",
        objectId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorRoleIds: ctx.roleIds || [],
        decision: "DENY",
        reasonCode: result.code || "VALIDATION_ERROR",
        factsSnapshot: { detail: result.detail },
        correlationId: ctx.requestId,
      });
      return errorJson(res, result.status || 400, result.code || "VALIDATION_ERROR", "Invalid rules.", ctx, {
        detail: result.detail || null,
      });
    }

    emitAudit({
      tenantId: ctx.tenantId,
      eventCategory: "VENDOR",
      eventType: "COMPLIANCE_RULES_REPLACE",
      objectType: "compliance_rules",
      objectId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorRoleIds: ctx.roleIds || [],
      decision: "ALLOW",
      reasonCode: "OK",
      factsSnapshot: { rules: result.rules },
      correlationId: ctx.requestId,
    });

    return sendJson(res, 200, { rules: result.rules });
  }

  return errorJson(res, 404, "NOT_FOUND", "Not found.", ctx);
};
