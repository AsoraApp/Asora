const fs = require("fs");
const path = require("path");

function tenantRootDir(tenantId) {
  if (!tenantId) return null;
  return path.join(process.cwd(), "data", "tenants", String(tenantId));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function readJsonOrNull(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadTenantCollection(tenantId, fileName, defaultValue) {
  const root = tenantRootDir(tenantId);
  if (!root) return null;
  const filePath = path.join(root, fileName);
  const existing = readJsonOrNull(filePath);
  if (existing === null || existing === undefined) return defaultValue;
  return existing;
}

function saveTenantCollection(tenantId, fileName, value) {
  const root = tenantRootDir(tenantId);
  if (!root) throw new Error("TENANT_NOT_RESOLVED");
  const filePath = path.join(root, fileName);
  atomicWriteJson(filePath, value);
}

module.exports = {
  tenantRootDir,
  loadTenantCollection,
  saveTenantCollection,
};
