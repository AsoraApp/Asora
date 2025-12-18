// backend/src/auth/session.js
"use strict";

/**
 * Deterministic session resolver.
 * - NEVER logs or returns raw Authorization header
 * - Returns null when missing/invalid
 *
 * Dev token (for builds):
 *   Authorization: Bearer dev-tenant
 */
function resolveSession(req) {
  const h = req && req.headers ? req.headers : {};
  const auth = typeof h.authorization === "string" ? h.authorization : "";

  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;

  const token = auth.slice(7).trim();
  if (!token) return null;

  // Dev-only deterministic session for build verification
  if (token === "dev-tenant") {
    return {
      ok: true,
      tenantId: "dev-tenant",
      actor: { type: "user", id: "dev-user", roles: ["admin"] },
    };
  }

  return null;
}

module.exports = { resolveSession };
