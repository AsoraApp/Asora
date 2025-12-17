const crypto = require("crypto");
const url = require("url");

const { emitAudit } = require("../observability/audit");
const { loadTenantCollection, saveTenantCollection } = require("../storage/jsonStore");

function nowUtcIso() {
  return new Date().toISOString();
}

function send(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function badRequest(res, code, details) {
  return send(res, 400, { error: "BAD_REQUEST", code, details: details || null });
}
function forbidden(res, code, details) {
  return send(res, 403, { error: "FORBIDDEN", code, details: details || null });
}
function notFound(res, code, details) {
  return send(res, 404, { error: "NOT_FOUND", code, details: details || null });
}
function conflict(res, code, details) {
  return send(res, 409, { error: "CONFLICT", code, details: details || null });
}

function isPlainObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function isIsoUtcString(s) {
  if (typeof s !== "string") return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  // Deterministic UTC check: must serialize back to the same ISO string.
  return d.toISOString() === s;
}

function stableHashJson(obj) {
  const json = JSON.stringify(obj);
  return crypto.createHash("sha256").update(json).digest("hex");
}

function stableDraftId(tenantId, draftType, clientDraftId) {
  return crypto
    .createHash("sha256")
    .update(`${tenantId}|${draftType}|${clientDraftId}`)
    .digest("hex");
}

async function collectionOrFailClosed(tenantId, name) {
  const col = await loadTenantCollection(tenantId, name);
  // jsonStore should return [] for missing; if it returns null/undefined, fail-closed.
  if (!Array.isArray(col)) return "__AMBIG__";
  return col;
}

async function validateRefsOrFailClosed(tenantId, refs) {
  // refs: { hubId?, binId?, itemIds?:[], poId? }
  // Fail-closed: if any referenced collection is ambiguous, reject.
  const hubs = await collectionOrFailClosed(tenantId, "hubs");
  const bins = await collectionOrFailClosed(tenantId, "bins");
  const items = await collectionOrFailClosed(tenantId, "items");
  const pos = await collectionOrFailClosed(tenantId, "purchase_orders");

  if (hubs === "__AMBIG__" || bins === "__AMBIG__" || items === "__AMBIG__" || pos === "__AMBIG__") {
    return { ok: false, status: 409, code: "AMBIGUOUS_STATE", details: { reason: "COLLECTION_NOT_ARRAY" } };
  }

  if (refs.hubId) {
    const ok = hubs.some((h) => h && (h.hubId === refs.hubId || h.id === refs.hubId));
    if (!ok) return { ok: false, status: 404, code: "HUB_NOT_FOUND", details: { hubId: refs.hubId } };
  }

  if (refs.binId) {
    const ok = bins.some((b) => b && (b.binId === refs.binId || b.id === refs.binId));
    if (!ok) return { ok: false, status: 404, code: "BIN_NOT_FOUND", details: { binId: refs.binId } };
  }

  if (refs.poId) {
    const ok = pos.some((p) => p && (p.poId === refs.poId || p.id === refs.poId));
    if (!ok) return { ok: false, status: 404, code: "PO_NOT_FOUND", details: { poId: refs.poId } };
  }

  if (Array.isArray(refs.itemIds)) {
    for (const itemId of refs.itemIds) {
      const ok = items.some((it) => it && (it.itemId === itemId || it.id === itemId));
      if (!ok) return { ok: false, status: 404, code: "ITEM_NOT_FOUND", details: { itemId } };
    }
  }

  return { ok: true };
}

async function upsertDraftAsDRAFT(ctx, draftType, draftBody) {
  const { tenantId, userId, correlationId } = ctx;

  if (!isPlainObject(draftBody)) {
    return { ok: false, status: 400, code: "INVALID_JSON_OBJECT", details: null };
  }

  const { clientDraftId, capturedAtUtc, deviceId } = draftBody;

  if (typeof clientDraftId !== "string" || clientDraftId.trim().length < 6 || clientDraftId.trim().length > 128) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_CLIENT_DRAFT_ID",
      details: { minLen: 6, maxLen: 128 },
    };
  }
  if (!isIsoUtcString(capturedAtUtc)) {
    return { ok: false, status: 400, code: "INVALID_CAPTURED_AT_UTC", details: { expected: "ISO_8601_UTC" } };
  }
  if (typeof deviceId !== "string" || deviceId.trim().length < 4 || deviceId.trim().length > 128) {
    return { ok: false, status: 400, code: "INVALID_DEVICE_ID", details: { minLen: 4, maxLen: 128 } };
  }

  // Type-specific schema + refs
  let refs = { itemIds: [] };
  if (draftType === "CYCLE_COUNT") {
    const { hubId, binId, counts } = draftBody;

    if (typeof hubId !== "string" || hubId.trim().length === 0) {
      return { ok: false, status: 400, code: "MISSING_HUB_ID", details: null };
    }
    if (typeof binId !== "string" || binId.trim().length === 0) {
      return { ok: false, status: 400, code: "MISSING_BIN_ID", details: null };
    }
    if (!Array.isArray(counts) || counts.length === 0) {
      return { ok: false, status: 400, code: "MISSING_COUNTS", details: { expected: "non-empty array" } };
    }
    for (let i = 0; i < counts.length; i++) {
      const row = counts[i];
      if (!isPlainObject(row)) {
        return { ok: false, status: 400, code: "INVALID_COUNT_ROW", details: { index: i } };
      }
      if (typeof row.itemId !== "string" || row.itemId.trim().length === 0) {
        return { ok: false, status: 400, code: "MISSING_ITEM_ID", details: { index: i } };
      }
      if (typeof row.qty !== "number" || !Number.isFinite(row.qty) || row.qty < 0) {
        return { ok: false, status: 400, code: "INVALID_QTY", details: { index: i, rule: "qty must be finite number >= 0" } };
      }
      refs.itemIds.push(row.itemId);
    }
    refs.hubId = hubId;
    refs.binId = binId;
  } else if (draftType === "RECEIPT") {
    const { poId, lines } = draftBody;

    if (typeof poId !== "string" || poId.trim().length === 0) {
      return { ok: false, status: 400, code: "MISSING_PO_ID", details: null };
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return { ok: false, status: 400, code: "MISSING_LINES", details: { expected: "non-empty array" } };
    }
    for (let i = 0; i < lines.length; i++) {
      const row = lines[i];
      if (!isPlainObject(row)) {
        return { ok: false, status: 400, code: "INVALID_RECEIPT_LINE", details: { index: i } };
      }
      if (typeof row.itemId !== "string" || row.itemId.trim().length === 0) {
        return { ok: false, status: 400, code: "MISSING_ITEM_ID", details: { index: i } };
      }
      if (typeof row.qtyReceived !== "number" || !Number.isFinite(row.qtyReceived) || row.qtyReceived <= 0) {
        return {
          ok: false,
          status: 400,
          code: "INVALID_QTY_RECEIVED",
          details: { index: i, rule: "qtyReceived must be finite number > 0" },
        };
      }
      refs.itemIds.push(row.itemId);
    }
    refs.poId = poId;
  } else {
    return { ok: false, status: 400, code: "UNSUPPORTED_DRAFT_TYPE", details: { draftType } };
  }

  const refCheck = await validateRefsOrFailClosed(tenantId, refs);
  if (!refCheck.ok) return refCheck;

  const drafts = await collectionOrFailClosed(tenantId, "offline_drafts");
  if (drafts === "__AMBIG__") {
    return { ok: false, status: 409, code: "AMBIGUOUS_STATE", details: { reason: "DRAFTS_COLLECTION_NOT_ARRAY" } };
  }

  const draftId = stableDraftId(tenantId, draftType, clientDraftId.trim());
  const existing = drafts.find((d) => d && d.draftId === draftId);

  if (existing) {
    // Deterministic idempotency: same (tenant,type,clientDraftId) is a hard duplicate.
    return {
      ok: false,
      status: 409,
      code: "DRAFT_ALREADY_EXISTS",
      details: { draftId, clientDraftId: clientDraftId.trim(), draftType },
    };
  }

  const receivedAtUtc = nowUtcIso();

  const record = {
    draftId,
    tenantId,
    draftType,
    state: "DRAFT",
    clientDraftId: clientDraftId.trim(),
    capturedAtUtc,
    deviceId: deviceId.trim(),
    receivedAtUtc,
    receivedByUserId: userId || null,
    correlationId: correlationId || null,
    // Store the full draft payload for later revalidation/submit (B9 only stores draft).
    payload: draftBody,
    payloadHash: stableHashJson(draftBody),
  };

  drafts.push(record);
  await saveTenantCollection(tenantId, "offline_drafts", drafts);

  return { ok: true, record };
}

function buildOfflineManifest() {
  // Deterministic ordering + stable fields only.
  const resources = [
    { key: "inventory_hubs", method: "GET", path: "/api/inventory/hubs", ttlSeconds: 3600 },
    { key: "inventory_bins_by_hub", method: "GET", path: "/api/inventory/hubs/:hubId/bins", ttlSeconds: 3600 },
    { key: "inventory_items", method: "GET", path: "/api/inventory/items", ttlSeconds: 3600 },
    { key: "inventory_stock", method: "GET", path: "/api/inventory/stock", ttlSeconds: 300 },
    { key: "vendors", method: "GET", path: "/api/vendors", ttlSeconds: 3600 },
    { key: "requisitions", method: "GET", path: "/api/procurement/requisitions", ttlSeconds: 900 },
    { key: "purchase_orders", method: "GET", path: "/api/procurement/purchase-orders", ttlSeconds: 900 },
    { key: "rfqs", method: "GET", path: "/api/rfqs", ttlSeconds: 900 },
  ];

  const version = stableHashJson(resources);
  return { version, resources };
}

async function handleGetManifest(req, res, ctx) {
  const { tenantId, correlationId, userId } = ctx;

  const manifest = buildOfflineManifest();
  const body = {
    tenantId,
    asOfUtc: nowUtcIso(),
    manifestVersion: manifest.version,
    resources: manifest.resources,
    cacheRules: {
      tenantScoped: true,
      cacheKeyFormat: "tenant:{tenantId}:resource:{key}:params:{paramsHash}",
      explicitStalenessAcknowledgementRequired: true,
    },
  };

  emitAudit(ctx, {
    eventCategory: "OFFLINE",
    eventType: "OFFLINE_MANIFEST_READ",
    objectType: "offline_manifest",
    objectId: manifest.version,
    decision: "ALLOW",
    reasonCode: "OK",
    factsSnapshot: { tenantId, userId: userId || null, correlationId: correlationId || null },
  });

  return send(res, 200, body);
}

async function handlePostCycleCountDraft(req, res, ctx) {
  const r = await upsertDraftAsDRAFT(ctx, "CYCLE_COUNT", req.body);
  if (!r.ok) {
    emitAudit(ctx, {
      eventCategory: "OFFLINE",
      eventType: "OFFLINE_DRAFT_CYCLE_COUNT_REJECT",
      objectType: "offline_draft",
      objectId: null,
      decision: "DENY",
      reasonCode: r.code,
      factsSnapshot: { details: r.details || null },
    });
    if (r.status === 400) return badRequest(res, r.code, r.details);
    if (r.status === 403) return forbidden(res, r.code, r.details);
    if (r.status === 404) return notFound(res, r.code, r.details);
    if (r.status === 409) return conflict(res, r.code, r.details);
    return conflict(res, "AMBIGUOUS_STATE", r.details);
  }

  emitAudit(ctx, {
    eventCategory: "OFFLINE",
    eventType: "OFFLINE_DRAFT_CYCLE_COUNT_ACCEPT",
    objectType: "offline_draft",
    objectId: r.record.draftId,
    decision: "ALLOW",
    reasonCode: "DRAFT_STORED",
    factsSnapshot: { draftType: "CYCLE_COUNT", clientDraftId: r.record.clientDraftId, deviceId: r.record.deviceId },
  });

  return send(res, 201, {
    draftId: r.record.draftId,
    state: r.record.state,
    draftType: r.record.draftType,
    receivedAtUtc: r.record.receivedAtUtc,
  });
}

async function handlePostReceiptDraft(req, res, ctx) {
  const r = await upsertDraftAsDRAFT(ctx, "RECEIPT", req.body);
  if (!r.ok) {
    emitAudit(ctx, {
      eventCategory: "OFFLINE",
      eventType: "OFFLINE_DRAFT_RECEIPT_REJECT",
      objectType: "offline_draft",
      objectId: null,
      decision: "DENY",
      reasonCode: r.code,
      factsSnapshot: { details: r.details || null },
    });
    if (r.status === 400) return badRequest(res, r.code, r.details);
    if (r.status === 403) return forbidden(res, r.code, r.details);
    if (r.status === 404) return notFound(res, r.code, r.details);
    if (r.status === 409) return conflict(res, r.code, r.details);
    return conflict(res, "AMBIGUOUS_STATE", r.details);
  }

  emitAudit(ctx, {
    eventCategory: "OFFLINE",
    eventType: "OFFLINE_DRAFT_RECEIPT_ACCEPT",
    objectType: "offline_draft",
    objectId: r.record.draftId,
    decision: "ALLOW",
    reasonCode: "DRAFT_STORED",
    factsSnapshot: { draftType: "RECEIPT", clientDraftId: r.record.clientDraftId, deviceId: r.record.deviceId },
  });

  return send(res, 201, {
    draftId: r.record.draftId,
    state: r.record.state,
    draftType: r.record.draftType,
    receivedAtUtc: r.record.receivedAtUtc,
  });
}

function match(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

async function offlineRouter(req, res, ctx) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "";

  // Only handle /api/offline/*
  if (!match(pathname, "/api/offline")) return false;

  // Routes
  if (req.method === "GET" && pathname === "/api/offline/manifest") {
    await handleGetManifest(req, res, ctx);
    return true;
  }

  if (req.method === "POST" && pathname === "/api/offline/drafts/cycle-count") {
    await handlePostCycleCountDraft(req, res, ctx);
    return true;
  }

  if (req.method === "POST" && pathname === "/api/offline/drafts/receipt") {
    await handlePostReceiptDraft(req, res, ctx);
    return true;
  }

  return notFound(res, "OFFLINE_ROUTE_NOT_FOUND", { pathname, method: req.method });
}

module.exports = offlineRouter;
