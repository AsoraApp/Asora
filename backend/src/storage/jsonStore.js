/**
 * Cloudflare Worker-compatible JSON store.
 * Tenant-scoped collections stored in KV as JSON blobs.
 *
 * Determinism rules:
 * - Keys are stable: `${tenantId}::${fileName}`
 * - Writes overwrite the whole collection deterministically
 * - Fail-closed when tenantId missing
 *
 * Requires Worker env binding: ASORA_KV
 */

function kvFromEnv() {
  // In Workers, env is accessed in the fetch handler. We attach it to globalThis.
  // Fail-closed if not bound.
  const kv = globalThis.__ASORA_ENV__ && globalThis.__ASORA_ENV__.ASORA_KV;
  return kv || null;
}

function makeKey(tenantId, fileName) {
  if (!tenantId) return null;
  if (!fileName || typeof fileName !== "string") return null;
  return `${String(tenantId)}::${fileName}`;
}

async function loadTenantCollection(tenantId, fileName, defaultValue) {
  const kv = kvFromEnv();
  const key = makeKey(tenantId, fileName);
  if (!kv) throw new Error("KV_NOT_BOUND");
  if (!key) return null;

  const raw = await kv.get(key);
  if (raw === null || raw === undefined) return defaultValue;

  try {
    return JSON.parse(raw);
  } catch {
    // Fail-closed on corrupt data: return defaultValue rather than guessing.
    return defaultValue;
  }
}

async function saveTenantCollection(tenantId, fileName, value) {
  const kv = kvFromEnv();
  const key = makeKey(tenantId, fileName);
  if (!kv) throw new Error("KV_NOT_BOUND");
  if (!tenantId) throw new Error("TENANT_NOT_RESOLVED");
  if (!key) throw new Error("INVALID_STORAGE_KEY");

  const raw = JSON.stringify(value, null, 2);
  await kv.put(key, raw);
}

module.exports = {
  loadTenantCollection,
  saveTenantCollection,
};
