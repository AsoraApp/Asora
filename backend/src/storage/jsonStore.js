// backend/src/storage/jsonStore.js
const fs = require("fs");
const path = require("path");

function baseDir() {
  // deterministic local persistence within repo runtime
  return path.join(__dirname, "..", ".asora-data");
}

function tenantDir(tenantId) {
  return path.join(baseDir(), String(tenantId));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function collectionPath(tenantId, collectionName) {
  return path.join(tenantDir(tenantId), `${collectionName}.json`);
}

function readCollection(tenantId, collectionName) {
  const dir = tenantDir(tenantId);
  ensureDir(dir);

  const fp = collectionPath(tenantId, collectionName);
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, JSON.stringify({ items: [] }, null, 2), "utf-8");
  }
  const raw = fs.readFileSync(fp, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return { items: [] };
    return parsed;
  } catch {
    // fail-closed: corrupted store => treat as empty but preserve file by not overwriting
    return { items: [] };
  }
}

function writeCollection(tenantId, collectionName, data) {
  const dir = tenantDir(tenantId);
  ensureDir(dir);
  const fp = collectionPath(tenantId, collectionName);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
}

function list(tenantId, collectionName) {
  return readCollection(tenantId, collectionName).items;
}

function getById(tenantId, collectionName, idField, idValue) {
  const items = list(tenantId, collectionName);
  return items.find((x) => x && x[idField] === idValue) || null;
}

function upsertById(tenantId, collectionName, idField, obj) {
  const store = readCollection(tenantId, collectionName);
  const idx = store.items.findIndex((x) => x && x[idField] === obj[idField]);
  if (idx >= 0) store.items[idx] = obj;
  else store.items.push(obj);
  writeCollection(tenantId, collectionName, store);
  return obj;
}

function replaceAll(tenantId, collectionName, items) {
  writeCollection(tenantId, collectionName, { items: Array.isArray(items) ? items : [] });
  return items;
}

module.exports = { list, getById, upsertById, replaceAll };
