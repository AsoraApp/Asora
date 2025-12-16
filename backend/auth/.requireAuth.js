function requireAuth(req, ctx) {
  // B1: no real auth yet → fail closed unless explicitly marked public
  // Public routes will bypass this by not calling requireAuth
  if (!ctx || ctx.userId === "anonymous") {
    return {
      ok: false,
      status: 401,
      error: "UNAUTHENTICATED"
    };
  }

  if (!ctx.tenantId || ctx.tenantId === "unresolved") {
    return {
      ok: false,
      status: 403,
      error: "TENANT_UNRESOLVED"
    };
  }

  return { ok: true };
}

module.exports = {
  requireAuth
};
