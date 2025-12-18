// backend/src/auth/requireAuth.js
"use strict";

const { unauthorized } = require("../api/_errors");

/**
 * Semantics:
 * - 401 for missing/invalid auth
 * - 403 is reserved for authenticated but forbidden (tenant missing/role denied/plan denied)
 */
function requireAuth(req, res, session) {
  if (!session || session.ok !== true) {
    unauthorized(res, "AUTH_REQUIRED", null);
    return { ok: false, status: 401, code: "AUTH_REQUIRED" };
  }
  return { ok: true, status: 200, code: null };
}

module.exports = { requireAuth };
