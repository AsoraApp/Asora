// backend/src/observability/redact.js
"use strict";

const REDACTED = "__REDACTED__";

function isPlainObject(v) {
  return !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
}

function shouldRedactKey(key) {
  const k = String(key || "").toLowerCase();
  if (!k) return false;

  return (
    k === "authorization" ||
    k === "cookie" ||
    k === "set-cookie" ||
    k.includes("token") ||
    k.includes("secret") ||
    k.includes("apikey") ||
    k.includes("api_key") ||
    k.includes("api-key") ||
    k.includes("password") ||
    k.includes("passphrase") ||
    k.includes("privatekey") ||
    k.includes("private_key") ||
    k.includes("clientsecret") ||
    k.includes("client_secret")
  );
}

function redactAny(value, depth = 0) {
  if (depth > 12) return REDACTED;

  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;

  if (Array.isArray(value)) return value.map((v) => redactAny(v, depth + 1));

  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = shouldRedactKey(k) ? REDACTED : redactAny(value[k], depth + 1);
    }
    return out;
  }

  return REDACTED;
}

function redactHeaders(headers) {
  if (!headers || typeof headers !== "object") return null;
  return redactAny(headers);
}

module.exports = { REDACTED, redactAny, redactHeaders };
