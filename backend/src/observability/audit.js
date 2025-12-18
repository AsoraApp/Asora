// backend/src/observability/audit.js
"use strict";

const { redactAny } = require("./redact");
const { nowUtcIso } = require("../domain/time/utc");

/**
 * Standard audit envelope:
 * {
 *   eventType, ts, tenantId,
 *   actor: { type, id, roles },
 *   request: { requestId, method, path },
 *   outcome: { ok, status, code },
 *   details: object|null
 * }
 *
 * Never include secrets/tokens/Authorization.
 * Deterministic ordering is enforced at write time via redact+stable stringify.
 */

function stableStringify(obj) {
  // Deterministic JSON stringify with sorted keys
  const seen = new WeakSet();
  const replacer = (key, value) => {
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
  const a = (ctx && ctx.actor) || null;
  if (!a || typeof a !== "object") return { type: "unknown", id: null, roles: [] };
  return {
    type: typeof a.type === "string" ? a.type : "unknown",
    id: typeof a.id === "string" ? a.id : null,
    roles: Array.isArray(a.roles) ? a.roles.filter((r) => typeof r === "string").sort() : [],
  };
}

function normalizeRequest(ctx) {
  const r = (ctx && ctx.request) || null;
  const reqId = (ctx && ctx.requestId) || (r && r.requestId) || null;
  const method = (r && r.method) || null;
  const path = (r && r.path) || null;
  return {
    requestId: typeof reqId === "string" ? reqId : null,
    method: typeof method === "string" ? method : null,
    path: typeof path === "string" ? path : null,
  };
}

function normalizeOutcome(outcome) {
  const o = outcome && typeof outcome === "object" ? outcome : {};
  const status = Number.isInteger(o.status) ? o.status : null;
  const code = typeof o.code === "string" ? o.code : null;
  const ok = o.ok === true;
  return { ok, status, code };
}

/**
 * emitAudit(ctx, eventType, outcome, details)
 * - ctx.tenantId is authoritative (session-derived only)
 * - details must be object|null (never string)
 */
function emitAudit(ctx, eventType, outcome, details) {
  const ts = nowUtcIso();
  const tenantId = (ctx && typeof ctx.tenantId === "string" && ctx.tenantId) || null;

  const d = details === null || details === undefined ? null : details;
  const safeDetails = d === null ? null : redactAny(d);

  const payload = {
    eventType: typeof eventType === "string" ? eventType : "audit.unknown",
    ts,
    tenantId,
    actor: normalizeActor(ctx),
    request: normalizeRequest(ctx),
    outcome: normalizeOutcome(outcome),
    details: safeDetails,
  };

  // Non-bypassable emission target: stdout (or whatever log sink exists).
  // Deterministic JSON line.
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
          outcome: normalizeOutcome({ ok: false, status: 500, code: "AUDIT_EMIT_FAILED" }),
          details: null,
        })
      );
    } catch {
      // swallow
    }
  }
}

module.exports = {
  emitAudit,
};
