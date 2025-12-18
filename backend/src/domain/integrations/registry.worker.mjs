// backend/src/domain/integrations/registry.worker.mjs
import { nowUtcIso } from "../time/utc.mjs";
import { loadTenantCollection, saveTenantCollection } from "../../storage/jsonStore.worker.mjs";
import { stableIntegrationId } from "./integrationIds.worker.mjs";
import { redactObjectDeterministically } from "./redaction.worker.mjs";

const COLLECTION = "integrations";
const ALLOWED_TYPES = new Set(["webhook", "accounting", "edi", "custom"]);
const ALLOWED_STATUS = new Set(["disabled", "enabled"]);

export async function listIntegrations(ctx) {
  const col = await loadTenantCollection(ctx, COLLECTION);
  const items = Array.isArray(col?.items) ? col.items : [];
  return items
    .slice()
    .sort((a, b) => String(a.integrationId).localeCompare(String(b.integrationId)));
}

export async function getIntegration(ctx, integrationId) {
  const all = await listIntegrations(ctx);
  return all.find((x) => x.integrationId === integrationId) || null;
}

export async function createIntegration(ctx, input) {
  const type = String(input?.type || "").trim();
  if (!ALLOWED_TYPES.has(type)) {
    const err = new Error("INVALID_INTEGRATION_TYPE");
    err.code = "INVALID_INTEGRATION_TYPE";
    throw err;
  }

  const key = String(input?.key || input?.name || type).trim();
  if (!key) {
    const err = new Error("INTEGRATION_KEY_REQUIRED");
    err.code = "INTEGRATION_KEY_REQUIRED";
    throw err;
  }

  const status = String(input?.status || "disabled").trim();
  if (!ALLOWED_STATUS.has(status)) {
    const err = new Error("INVALID_INTEGRATION_STATUS");
    err.code = "INVALID_INTEGRATION_STATUS";
    throw err;
  }

  const integrationId = stableIntegrationId(ctx.tenantId, type, key);
  const now = nowUtcIso();

  const col = await loadTenantCollection(ctx, COLLECTION);
  const items = Array.isArray(col?.items) ? col.items : [];

  if (items.some((x) => x.integrationId === integrationId)) {
    const err = new Error("INTEGRATION_ALREADY_EXISTS");
    err.code = "INTEGRATION_ALREADY_EXISTS";
    throw err;
  }

  // Store ONLY non-secret config. Redact deterministically on write as a safety net.
  const config = redactObjectDeterministically(input?.config || {});

  const rec = {
    integrationId,
    type,
    status,
    config,
    createdAtUtc: now,
    updatedAtUtc: now,
  };

  items.push(rec);

  await saveTenantCollection(ctx, COLLECTION, { items });
  return rec;
}

export async function setIntegrationStatus(ctx, integrationId, newStatus) {
  const ns = String(newStatus || "").trim();
  if (!ALLOWED_STATUS.has(ns)) {
    const err = new Error("INVALID_INTEGRATION_STATUS");
    err.code = "INVALID_INTEGRATION_STATUS";
    throw err;
  }

  const col = await loadTenantCollection(ctx, COLLECTION);
  const items = Array.isArray(col?.items) ? col.items : [];
  const idx = items.findIndex((x) => x.integrationId === integrationId);

  if (idx < 0) {
    const err = new Error("INTEGRATION_NOT_FOUND");
    err.code = "INTEGRATION_NOT_FOUND";
    throw err;
  }

  const now = nowUtcIso();
  const existing = items[idx];

  const next = {
    ...existing,
    status: ns,
    updatedAtUtc: now,
  };

  items[idx] = next;
  await saveTenantCollection(ctx, COLLECTION, { items });
  return next;
}
