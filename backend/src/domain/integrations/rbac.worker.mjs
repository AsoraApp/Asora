// backend/src/domain/integrations/rbac.worker.mjs
// Fail-closed: if permissions cannot be resolved, deny.
export function requirePermissionOrThrow(ctx, perm) {
  const p = String(perm || "").trim();
  const perms =
    ctx?.session?.permissions ||
    ctx?.permissions ||
    ctx?.actor?.permissions ||
    ctx?.rbac?.permissions ||
    null;

  if (!Array.isArray(perms)) {
    const err = new Error("RBAC_PERMISSIONS_REQUIRED");
    err.code = "RBAC_PERMISSIONS_REQUIRED";
    throw err;
  }
  if (!perms.includes(p) && !perms.includes("*")) {
    const err = new Error("FORBIDDEN");
    err.code = "FORBIDDEN";
    err.details = { required: p };
    throw err;
  }
}
