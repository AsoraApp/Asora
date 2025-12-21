// backend/src/storage/jsonStore.worker.mjs
// U13: Tenant-scoped JSON storage on Cloudflare KV.
// Goals:
// - Deterministic keying
// - Fail-closed when tenantId missing
// - Deterministic errors when KV binding missing (no silent nulls)
// - Never invent bindings: must use env.ASORA_KV

function kv(env) {
  const e = env || {};
  return e.ASORA_KV || null;
}

function assertKvBound(env) {
  const store = kv(env);
  if (!store) {
    const err = new Error("KV_NOT_BOUND");
    err.code = "KV_NOT_BOUND";
    throw err;
  }
  return store;
}

function assertTenantId(tenantId) {
  if (!tenantId || typeof tenantId !== "string") {
    const err = new Error("TENANT_NOT_RESOLVED");
    err.code = "TENANT_NOT_RESOLVED";
    throw err;
  }
  return tenantId;
}

function assertName(name) {
  if (!name || typeof name !== "string") {
    const err = new Error("INVALID_COLLECTION_NAME");
    err.code = "INVALID_COLLECTION_NAME";
    throw err;
  }
  return name;
}

function key(tenantId, name) {
  // tenantId is already validated; name is already validated
  return `${tenantId}::${name}`;
}

export async function loadTenantCollection(env, tenantId, name, defaultValue) {
  const store = assertKvBound(env);
  const t = assertTenantId(tenantId);
  const n = assertName(name);

  const k = key(t, n);

  const raw = await store.get(k);
  if (raw === null || raw === undefined) return defaultValue;

  try {
    return JSON.parse(raw);
  } catch {
    // Fail-closed to defaultValue for corrupted JSON (deterministic)
    return defaultValue;
  }
}

export async function saveTenantCollection(env, tenantId, name, value) {
  const store = assertKvBound(env);
  const t = assertTenantId(tenantId);
  const n = assertName(name);

  const k = key(t, n);

  // Keep compact JSON; pretty-print increases KV usage.
  await store.put(k, JSON.stringify(value));
}
