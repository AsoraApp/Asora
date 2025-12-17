function kv() {
  const e = globalThis.__ASORA_ENV__ || {};
  return e.ASORA_KV || null;
}

function key(tenantId, name) {
  if (!tenantId) return null;
  if (!name || typeof name !== "string") return null;
  return `${String(tenantId)}::${name}`;
}

export async function loadTenantCollection(tenantId, name, defaultValue) {
  const store = kv();
  if (!store) throw new Error("KV_NOT_BOUND");
  const k = key(tenantId, name);
  if (!k) return null;

  const raw = await store.get(k);
  if (raw === null || raw === undefined) return defaultValue;

  try {
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

export async function saveTenantCollection(tenantId, name, value) {
  const store = kv();
  if (!store) throw new Error("KV_NOT_BOUND");
  if (!tenantId) throw new Error("TENANT_NOT_RESOLVED");

  const k = key(tenantId, name);
  if (!k) throw new Error("INVALID_STORAGE_KEY");

  await store.put(k, JSON.stringify(value, null, 2));
}
