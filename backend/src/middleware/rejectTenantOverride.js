export default function rejectTenantOverride(req, res, next) {
  const hasTenantInQuery =
    req.query && Object.prototype.hasOwnProperty.call(req.query, "tenantId");

  const hasTenantInBody =
    req.body && Object.prototype.hasOwnProperty.call(req.body, "tenantId");

  const hasTenantInHeaders =
    req.headers &&
    (Object.prototype.hasOwnProperty.call(req.headers, "tenantid") ||
     Object.prototype.hasOwnProperty.call(req.headers, "x-tenant-id"));

  if (hasTenantInQuery || hasTenantInBody || hasTenantInHeaders) {
    const requestId = req.ctx?.requestId || null;

    return res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Tenant override is not permitted",
        requestId
      }
    });
  }

  next();
}
