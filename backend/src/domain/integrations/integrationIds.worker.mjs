// backend/src/domain/integrations/integrationIds.worker.mjs
import crypto from "crypto";

export function stableIntegrationId(tenantId, type, key) {
  const t = String(tenantId || "").trim();
  const ty = String(type || "").trim();
  const k = String(key || "").trim();
  const h = crypto.createHash("sha256").update(`asora|integration|${t}|${ty}|${k}`).digest("hex").slice(0, 24);
  return `int_${h}`;
}

export function stableOutboundId(tenantId, integrationId, eventType, createdAtUtc, payloadHash) {
  const t = String(tenantId || "").trim();
  const i = String(integrationId || "").trim();
  const e = String(eventType || "").trim();
  const c = String(createdAtUtc || "").trim();
  const p = String(payloadHash || "").trim();
  const h = crypto.createHash("sha256").update(`asora|outbound|${t}|${i}|${e}|${c}|${p}`).digest("hex").slice(0, 28);
  return `out_${h}`;
}

export function stablePayloadHash(payloadObj) {
  const json = stableStringify(payloadObj);
  return crypto.createHash("sha256").update(json).digest("hex");
}

function stableStringify(v) {
  return JSON.stringify(sortKeysDeep(v));
}

function sortKeysDeep(x) {
  if (x === null || x === undefined) return null;
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  if (typeof x === "object") {
    const out = {};
    for (const k of Object.keys(x).sort()) out[k] = sortKeysDeep(x[k]);
    return out;
  }
  if (typeof x === "number" && !Number.isFinite(x)) return null;
  return x;
}
