// backend/src/api/auth.js
"use strict";

const { json } = require("./_errors");

/**
 * GET /api/auth/me (auth-gated by server)
 * Returns only safe session facts for diagnostics.
 */
function handleAuthMe(req, res, ctx) {
  return json(res, 200, {
    ok: true,
    tenantId: ctx && typeof ctx.tenantId === "string" ? ctx.tenantId : null,
    userId: ctx && ctx.actor && typeof ctx.actor.id === "string" ? ctx.actor.id : null,
    requestId: ctx && typeof ctx.requestId === "string" ? ctx.requestId : null,
  });
}

module.exports = { handleAuthMe };
