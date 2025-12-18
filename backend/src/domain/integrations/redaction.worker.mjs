// backend/src/domain/integrations/redaction.worker.mjs
const SECRET_KEY_LIKE = /token|secret|authorization|api[-_]?key|password|cookie|set-cookie/i;

export function redactObjectDeterministically(obj) {
  return redact(obj);
}

function redact(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(redact);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (SECRET_KEY_LIKE.test(k)) out[k] = "__REDACTED__";
      else out[k] = redact(v[k]);
    }
    return out;
  }
  return v;
}
