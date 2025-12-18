// backend/src/observability/audit.js
"use strict";

const { redactAny } = require("./redact");
const { nowUtcIso } = require("../domain/time/utc");

function stableStringify(obj) {
  const seen = new WeakSet();
  const replacer = (_k, value) => {
    if (value && typeof value === "object") {
      if (seen.has(value)) return "__CIRCULAR__";
      seen.add(value);
      if (Array.isArray(value)) return value;
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = value[k];
      return out;
    }
    return value;
  };
  return JSON.stringify(obj, replacer);
}

function normalizeActor(ctx) {
  const a = ctx && ctx.actor && typeof ctx.actor === "object" ? ctx.actor : null;
  return {
    type: typeof (a && a.type) === "string" ? a.type : "unknown",
    id: typeof (a && a.id) === "string" ? a.id : null,
    roles: Array.isArray(a && a.roles) ? a.roles.filter((r) => typeof r === "string").sort() : [],
  };
}

function normalizeRequest(ctx) {
  const r = (ctx && ctx.request) || {};
  return {
    requestId: typeof (ctx && ctx.requestId) === "string" ? ctx.requestId : null,
    method: typeof r.method === "string" ? r.method : null,
    path: typeof r.path === "string" ? r.path : null,
  };
}

function normalizeOutcome(outcome) {
  const o = outcome && typeof outcome === "object" ? outcome : {};
  return {
    ok: o.ok === true,
    status: Number.isInteger(o.status) ? o.status : null,
    code: typeof o.code === "string" ? o.code : null,
  };
}

/**
 * Standard audit envelope:
 * { eventType, ts, tenantId, actor, request, outcome, details }
 *
 * details: object|null only (never string)
 * secrets: always redacted
 */
function emitAudit(ctx, eventType, outcome, details) {
  const ts = nowUtcIso();
  const tenantId = ctx && typeof ctx.tenantId === "string" ? ctx.tenantId : null;

  let safeDetails = null;
  if (details === null || details === undefined) {
    safeDetails = null;
  } else if (typeof details === "object") {
    safeDetails = redactAny(details);
  } else {
    safeDetails = redactAny({ info: String(details) });
  }

  const payload = {
    eventType: typeof eventType === "string" ? eventType : "audit.unknown",
    ts,
    tenantId,
    actor: normalizeActor(ctx),
    request: normalizeRequest(ctx),
    outcome: normalizeOutcome(outcome),
    details: safeDetails,
  };

  try {
    // eslint-disable-next-line no-console
    console.log(stableStringify(payload));
  } catch {
    try {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          eventType: "audit.emit_failed",
          ts,
          tenantId,
          actor: normalizeActor(ctx),
          request: normalizeRequest(ctx),
          outcome: { ok: false, status: 500, code: "AUDIT_EMIT_FAILED" },
          details: null,
        })
      );
    } catch {
      // swallow
    }
  }
}

module.exports = { emitAudit };
