// backend/src/domain/integrations/outboundQueue.worker.mjs
import { nowUtcIso } from "../time/utc.mjs";
import { loadTenantCollection, saveTenantCollection } from "../../storage/jsonStore.worker.mjs";
import { stableOutboundId, stablePayloadHash } from "./integrationIds.worker.mjs";
import { redactObjectDeterministically } from "./redaction.worker.mjs";

const COLLECTION = "outboundQueue";
const STATUS = new Set(["pending", "sent", "failed"]);

export async function listOutbound(ctx, integrationId, status) {
  const col = await loadTenantCollection(ctx, COLLECTION);
  const items = Array.isArray(col?.items) ? col.items : [];
  let out = items.filter((x) => x.integrationId === integrationId);

  if (status) out = out.filter((x) => x.status === status);

  // Deterministic ordering: createdAtUtc then outboundId
  out.sort((a, b) => {
    const ca = String(a.createdAtUtc || "");
    const cb = String(b.createdAtUtc || "");
    if (ca !== cb) return ca.localeCompare(cb);
    return String(a.outboundId || "").localeCompare(String(b.outboundId || ""));
  });

  return out;
}

export async function enqueueOutbound(ctx, integrationId, eventType, payloadObj) {
  const et = String(eventType || "").trim();
  if (!et) {
    const err = new Error("EVENT_TYPE_REQUIRED");
    err.code = "EVENT_TYPE_REQUIRED";
    throw err;
  }

  const createdAtUtc = nowUtcIso();

  const sanitizedPayload = redactObjectDeterministically(payloadObj || {});
  const payloadHash = stablePayloadHash(sanitizedPayload);

  const outboundId = stableOutboundId(ctx.tenantId, integrationId, et, createdAtUtc, payloadHash);

  const col = await loadTenantCollection(ctx, COLLECTION);
  const items = Array.isArray(col?.items) ? col.items : [];

  // Allow multiple queued payloads, but do not allow ID collision.
  if (items.some((x) => x.outboundId === outboundId)) {
    const err = new Error("OUTBOUND_ID_COLLISION");
    err.code = "OUTBOUND_ID_COLLISION";
    throw err;
  }

  const rec = {
    outboundId,
    integrationId,
    eventType: et,
    payload: sanitizedPayload,
    payloadHash,
    createdAtUtc,
    status: "pending",
    attemptCount: 0,
    lastAttemptAtUtc: null,
    lastErrorCode: null,
    attempts: [],
  };

  items.push(rec);
  await saveTenantCollection(ctx, COLLECTION, { items });

  return rec;
}

export async function recordDispatchAttempt(ctx, outboundId, result) {
  const col = await loadTenantCollection(ctx, COLLECTION);
  const items = Array.isArray(col?.items) ? col.items : [];
  const idx = items.findIndex((x) => x.outboundId === outboundId);

  if (idx < 0) {
    const err = new Error("OUTBOUND_NOT_FOUND");
    err.code = "OUTBOUND_NOT_FOUND";
    throw err;
  }

  const now = nowUtcIso();
  const r = items[idx];

  const nextAttemptCount = Number(r.attemptCount || 0) + 1;

  const ok = !!result?.ok;
  const errorCode = ok ? null : String(result?.errorCode || "DISPATCH_FAILED");

  const nextStatus = ok ? "sent" : "failed";
  if (!STATUS.has(nextStatus)) {
    const err = new Error("INVALID_OUTBOUND_STATUS");
    err.code = "INVALID_OUTBOUND_STATUS";
    throw err;
  }

  const attemptRec = {
    attemptAtUtc: now,
    ok,
    errorCode,
    httpStatus: Number.isFinite(Number(result?.httpStatus)) ? Number(result.httpStatus) : null,
  };

  const attempts = Array.isArray(r.attempts) ? r.attempts.slice() : [];
  attempts.push(attemptRec);

  const next = {
    ...r,
    status: nextStatus,
    attemptCount: nextAttemptCount,
    lastAttemptAtUtc: now,
    lastErrorCode: errorCode,
    attempts,
  };

  items[idx] = next;
  await saveTenantCollection(ctx, COLLECTION, { items });
  return next;
}
