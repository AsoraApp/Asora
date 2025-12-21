// backend/src/api/integrations.worker.mjs
import { emitAudit } from "../observability/audit.worker.mjs";
import { listIntegrations, getIntegration, createIntegration, setIntegrationStatus } from "../domain/integrations/registry.worker.mjs";
import { enqueueOutbound, listOutbound, recordDispatchAttempt } from "../domain/integrations/outboundQueue.worker.mjs";
import { buildSnapshot } from "../domain/integrations/snapshots.worker.mjs";
import { redactObjectDeterministically } from "../domain/integrations/redaction.worker.mjs";
import { requirePermissionOrThrow } from "../domain/integrations/rbac.worker.mjs";
import { enforcePlanIntegrationCountOrThrow } from "../domain/integrations/planEnforcement.worker.mjs";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function badRequest(code, details, baseHeaders) {
  return json(400, { error: "BAD_REQUEST", code, details: details || null }, baseHeaders);
}
function forbidden(code, details, baseHeaders) {
  return json(403, { error: "FORBIDDEN", code, details: details || null }, baseHeaders);
}
function notFound(code, baseHeaders) {
  return json(404, { error: "NOT_FOUND", code }, baseHeaders);
}
function conflict(code, details, baseHeaders) {
  return json(409, { error: "CONFLICT", code, details: details || null }, baseHeaders);
}
function serverError(code, details, baseHeaders) {
  return json(500, { error: "INTERNAL_ERROR", code, details: details || null }, baseHeaders);
}

async function readJson(request) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) return null;
  try {
    return await request.json();
  } catch {
    return "__INVALID_JSON__";
  }
}

function safeAudit(ctx, type, details, cfctx) {
  const redacted = redactObjectDeterministically(details || {});
  try {
    return emitAudit(ctx, type, redacted, cfctx);
  } catch {
    // Fail-closed posture is handled by callers; audit failure should not leak secrets.
    return null;
  }
}

function pathParts(url) {
  const u = new URL(url);
  return u.pathname.split("/").filter(Boolean);
}

export async function integrationsFetchRouter(ctx, request, baseHeaders, cfctx) {
  if (!ctx?.tenantId) return forbidden("TENANT_REQUIRED", null, baseHeaders);

  const parts = pathParts(request.url);

  // Expect: /api/integrations/...
  const i = parts.indexOf("integrations");
  if (i < 0) return notFound("ROUTE_NOT_FOUND", baseHeaders);

  const rest = parts.slice(i + 1);
  const method = request.method.toUpperCase();

  // GET /api/integrations
  if (method === "GET" && rest.length === 0) {
    try {
      requirePermissionOrThrow(ctx, "integrations.read");
      const items = await listIntegrations(ctx);
      return json(200, { integrations: items }, baseHeaders);
    } catch (e) {
      const code = e?.code || "FORBIDDEN";
      return forbidden(code, e?.details || null, baseHeaders);
    }
  }

  // POST /api/integrations (create)
  if (method === "POST" && rest.length === 0) {
    const body = await readJson(request);
    if (body === "__INVALID_JSON__") return badRequest("INVALID_JSON", null, baseHeaders);
    if (!body || typeof body !== "object") return badRequest("INVALID_BODY_OBJECT", null, baseHeaders);

    try {
      requirePermissionOrThrow(ctx, "integrations.manage");

      const existing = await listIntegrations(ctx);
      enforcePlanIntegrationCountOrThrow(ctx, existing.length);

      const rec = await createIntegration(ctx, body);

      safeAudit(ctx, "integration.created", { integrationId: rec.integrationId, type: rec.type, status: rec.status }, cfctx);

      return json(201, { ok: true, integration: rec }, baseHeaders);
    } catch (e) {
      const code = e?.code || "INTERNAL_ERROR";
      safeAudit(ctx, "integration.created", { ok: false, errorCode: code }, cfctx);
      if (code.startsWith("PLAN_")) return forbidden(code, e?.details || null, baseHeaders);
      if (code === "INTEGRATION_ALREADY_EXISTS") return conflict(code, null, baseHeaders);
      if (code === "INVALID_INTEGRATION_TYPE" || code === "INTEGRATION_KEY_REQUIRED" || code === "INVALID_INTEGRATION_STATUS") {
        return badRequest(code, e?.details || null, baseHeaders);
      }
      if (code === "RBAC_PERMISSIONS_REQUIRED" || code === "FORBIDDEN") return forbidden(code, e?.details || null, baseHeaders);
      return serverError(code, e?.details || null, baseHeaders);
    }
  }

  // /api/integrations/:integrationId/enable|disable
  if (method === "POST" && rest.length === 2 && (rest[1] === "enable" || rest[1] === "disable")) {
    const integrationId = rest[0];
    try {
      requirePermissionOrThrow(ctx, "integrations.manage");
      const existing = await getIntegration(ctx, integrationId);
      if (!existing) return notFound("INTEGRATION_NOT_FOUND", baseHeaders);

      const next = await setIntegrationStatus(ctx, integrationId, rest[1] === "enable" ? "enabled" : "disabled");

      safeAudit(ctx, rest[1] === "enable" ? "integration.enabled" : "integration.disabled", { integrationId }, cfctx);

      return json(200, { ok: true, integration: next }, baseHeaders);
    } catch (e) {
      const code = e?.code || "INTERNAL_ERROR";
      safeAudit(ctx, "integration.status.changed", { ok: false, integrationId, errorCode: code }, cfctx);
      if (code === "INTEGRATION_NOT_FOUND") return notFound(code, baseHeaders);
      if (code === "RBAC_PERMISSIONS_REQUIRED" || code === "FORBIDDEN") return forbidden(code, e?.details || null, baseHeaders);
      if (code === "INVALID_INTEGRATION_STATUS") return badRequest(code, null, baseHeaders);
      return serverError(code, e?.details || null, baseHeaders);
    }
  }

  // POST /api/integrations/:integrationId/enqueue
  if (method === "POST" && rest.length === 2 && rest[1] === "enqueue") {
    const integrationId = rest[0];
    const body = await readJson(request);
    if (body === "__INVALID_JSON__") return badRequest("INVALID_JSON", null, baseHeaders);
    if (!body || typeof body !== "object") return badRequest("INVALID_BODY_OBJECT", null, baseHeaders);

    try {
      requirePermissionOrThrow(ctx, "integrations.manage");

      const integ = await getIntegration(ctx, integrationId);
      if (!integ) return notFound("INTEGRATION_NOT_FOUND", baseHeaders);
      if (integ.status !== "enabled") return conflict("INTEGRATION_DISABLED", null, baseHeaders);

      const snapshotType = String(body?.snapshotType || "").trim();
      const eventType = String(body?.eventType || snapshotType || "").trim();
      if (!eventType) return badRequest("EVENT_TYPE_REQUIRED", null, baseHeaders);
      if (!snapshotType) return badRequest("SNAPSHOT_TYPE_REQUIRED", null, baseHeaders);

      const snap = await buildSnapshot(ctx, snapshotType, body?.input || null);

      const payload = {
        integrationId,
        eventType,
        snapshot: snap,
      };

      const rec = await enqueueOutbound(ctx, integrationId, eventType, payload);

      safeAudit(ctx, "integration.payload.enqueued", { integrationId, outboundId: rec.outboundId, eventType }, cfctx);

      return json(201, { ok: true, outbound: rec }, baseHeaders);
    } catch (e) {
      const code = e?.code || "INTERNAL_ERROR";
      safeAudit(ctx, "integration.payload.enqueued", { ok: false, integrationId, errorCode: code }, cfctx);
      if (code === "INTEGRATION_NOT_FOUND") return notFound(code, baseHeaders);
      if (code === "INTEGRATION_DISABLED") return conflict(code, null, baseHeaders);
      if (code === "UNKNOWN_SNAPSHOT_TYPE" || code === "SNAPSHOT_TYPE_REQUIRED" || code === "EVENT_TYPE_REQUIRED") {
        return badRequest(code, e?.details || null, baseHeaders);
      }
      if (code === "RBAC_PERMISSIONS_REQUIRED" || code === "FORBIDDEN") return forbidden(code, e?.details || null, baseHeaders);
      return serverError(code, e?.details || null, baseHeaders);
    }
  }

  // POST /api/integrations/:integrationId/dispatch
  if (method === "POST" && rest.length === 2 && rest[1] === "dispatch") {
    const integrationId = rest[0];
    const body = await readJson(request);
    if (body === "__INVALID_JSON__") return badRequest("INVALID_JSON", null, baseHeaders);
    const limit = Number(body?.limit ?? 50);
    const headers = body?.headers && typeof body.headers === "object" ? body.headers : null;

    try {
      requirePermissionOrThrow(ctx, "integrations.dispatch");

      const integ = await getIntegration(ctx, integrationId);
      if (!integ) return notFound("INTEGRATION_NOT_FOUND", baseHeaders);
      if (integ.status !== "enabled") return conflict("INTEGRATION_DISABLED", null, baseHeaders);

      const type = String(integ.type || "");
      if (type !== "webhook") return badRequest("DISPATCH_UNSUPPORTED_FOR_TYPE", { type }, baseHeaders);

      const url = String(integ?.config?.url || "").trim();
      if (!url) return badRequest("WEBHOOK_URL_REQUIRED", null, baseHeaders);

      const pending = await listOutbound(ctx, integrationId, "pending");
      const batch = pending.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50);

      safeAudit(ctx, "integration.dispatch.attempted", { integrationId, count: batch.length }, cfctx);

      const results = [];
      for (const o of batch) {
        let ok = false;
        let httpStatus = null;
        let errorCode = null;

        try {
          const reqHeaders = new Headers();
          reqHeaders.set("Content-Type", "application/json; charset=utf-8");

          // Accept transient headers (NOT stored; redacted in audit).
          if (headers) {
            for (const k of Object.keys(headers)) {
              const v = headers[k];
              if (typeof v === "string") reqHeaders.set(k, v);
            }
          }

          const resp = await fetch(url, {
            method: "POST",
            headers: reqHeaders,
            body: JSON.stringify({
              outboundId: o.outboundId,
              integrationId: o.integrationId,
              eventType: o.eventType,
              createdAtUtc: o.createdAtUtc,
              payload: o.payload,
            }),
          });

          httpStatus = resp.status;
          ok = resp.ok;
          if (!ok) errorCode = "HTTP_NON_2XX";
        } catch (e) {
          ok = false;
          errorCode = "NETWORK_ERROR";
        }

        const updated = await recordDispatchAttempt(ctx, o.outboundId, { ok, httpStatus, errorCode });

        if (ok) safeAudit(ctx, "integration.dispatch.succeeded", { integrationId, outboundId: o.outboundId, httpStatus }, cfctx);
        else safeAudit(ctx, "integration.dispatch.failed", { integrationId, outboundId: o.outboundId, httpStatus, errorCode }, cfctx);

        results.push({
          outboundId: o.outboundId,
          ok: updated.status === "sent",
          httpStatus: updated.lastErrorCode ? updated.attempts?.slice(-1)?.[0]?.httpStatus ?? httpStatus : httpStatus,
          errorCode: updated.lastErrorCode,
        });
      }

      return json(200, { ok: true, integrationId, dispatched: results }, baseHeaders);
    } catch (e) {
      const code = e?.code || "INTERNAL_ERROR";
      safeAudit(ctx, "integration.dispatch.failed", { ok: false, integrationId, errorCode: code }, cfctx);
      if (code === "INTEGRATION_NOT_FOUND") return notFound(code, baseHeaders);
      if (code === "INTEGRATION_DISABLED") return conflict(code, null, baseHeaders);
      if (code === "RBAC_PERMISSIONS_REQUIRED" || code === "FORBIDDEN") return forbidden(code, e?.details || null, baseHeaders);
      if (code === "DISPATCH_UNSUPPORTED_FOR_TYPE" || code === "WEBHOOK_URL_REQUIRED") return badRequest(code, e?.details || null, baseHeaders);
      return serverError(code, e?.details || null, baseHeaders);
    }
  }

  return notFound("ROUTE_NOT_FOUND", baseHeaders);
}
