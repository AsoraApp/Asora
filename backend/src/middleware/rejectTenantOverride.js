module.exports = function rejectTenantOverride(req, res) {
  const q = req.url || "";
  const hasTenantInQuery = /[?&]tenantId=/.test(q);

  const body = req.body || null;
  const hasTenantInBody = body && Object.prototype.hasOwnProperty.call(body, "tenantId");

  const h = req.headers || {};
  const hasTenantInHeaders = !!(h["x-tenant-id"] || h["tenantid"]);

  if (hasTenantInQuery || hasTenantInBody || hasTenantInHeaders) {
    return {
      ok: false,
      status: 400,
      error: { code: "BAD_REQUEST", message: "Tenant override is not permitted" }
    };
  }

  return { ok: true };
};
