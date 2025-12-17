function kvFromEnv() {
  const kv = globalThis.__ASORA_ENV__ && globalThis.__ASORA_ENV__.ASORA_KV;
  return kv || null;
}

function makeKey(tenantId, fileName) {
  if (!tenantId) return null;
  if (!fileName || typeof fileName !== "string") return null;
  return `${String(tenantId)}::${fileName}`;
}

export async function loadTenantCollection(tenantId, fileName, defaultValue) {
  const kv = kvFromEnv();
  const key = makeKey(tenantId, fileName);
  if (!kv) throw new Error("KV_NOT_BOUND");
  if (!key) return null;

  const raw = await kv.get(key);
  if (raw === null || raw === undefined) return defaultValue;

  try {
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

export async function saveTenantCollection(tenantId, fileName, value) {
  const kv = kvFromEnv();
  const key = makeKey(tenantId, fileName);
  if (!kv) throw new Error("KV_NOT_BOUND");
  if (!tenantId) throw new Error("TENANT_NOT_RESOLVED");
  if (!key) throw new Error("INVALID_STORAGE_KEY");

  await kv.put(key, JSON.stringify(value, null, 2));
}
