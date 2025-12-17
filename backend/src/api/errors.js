// backend/src/api/errors.js
const { sendJson } = require("./http");

const ERROR = {
  INVALID_REQUEST: { status: 400, code: "INVALID_REQUEST" },
  INVALID_JSON: { status: 400, code: "INVALID_JSON" },

  UNAUTHORIZED: { status: 401, code: "UNAUTHORIZED" },

  FORBIDDEN: { status: 403, code: "FORBIDDEN" },
  TENANT_UNRESOLVED: { status: 403, code: "TENANT_UNRESOLVED" },

  NOT_FOUND: { status: 404, code: "NOT_FOUND" },

  CONFLICT: { status: 409, code: "CONFLICT" },
  STATE_CONFLICT: { status: 409, code: "STATE_CONFLICT" },
  IDEMPOTENCY_REPLAY_MISMATCH: { status: 409, code: "IDEMPOTENCY_REPLAY_MISMATCH" },
  VENDOR_INELIGIBLE: { status: 409, code: "VENDOR_INELIGIBLE" },
};

function fail(res, code, message, details) {
  const meta = ERROR[code] || { status: 400, code: "INVALID_REQUEST" };
  const payload = { error: { code: meta.code, message: message || meta.code } };
  if (details !== undefined) payload.error.details = details;
  return sendJson(res, meta.status, payload);
}

function assert(condition, code, message, details) {
  if (!condition) {
    const err = new Error(message || code);
    err.code = code;
    err.details = details;
    throw err;
  }
}

module.exports = { ERROR, fail, assert };
