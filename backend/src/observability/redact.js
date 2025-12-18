// backend/src/observability/redact.js
"use strict";

/**
 * Deterministic redaction for any payload that could include secrets.
 * Rules:
 * - Never emit raw Authorization headers
 * - Never emit tokens/secrets/api keys/password-like fields
 * - Preserve shape deterministically
 */

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
  if (depth > 12) return REDACTED; // deterministic safety cap

  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((v) => redactAny(v, depth + 1));
  }

  if (isPlainObject(value)) {
    const out = {};
    const keys = Object.keys(value).sort(); // deterministic ordering
    for (const k of keys) {
      if (shouldRedactKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactAny(value[k], depth + 1);
      }
    }
    return out;
  }

  // For Headers, Maps, Errors, Dates, Buffers, etc: stringify deterministically but redact unknowns
  try {
    return REDACTED;
  } catch {
    return REDACTED;
  }
}

function redactHeaders(headers) {
  // headers may be Node req.headers (plain object) or user-provided
  if (!headers || typeof headers !== "object") return null;
  return redactAny(headers);
}

module.exports = {
  REDACTED,
  redactAny,
  redactHeaders,
};
