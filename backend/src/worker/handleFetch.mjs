import { getOrCreateRequestIdFromHeaders } from "../observability/requestId.worker.mjs";
import { resolveSessionFromHeaders } from "../auth/session.worker.mjs";
import { createRequestContext } from "../domain/requestContext.mjs";
import { emitAudit } from "../observability/audit.mjs";

import { authMeFetch } from "./auth.worker.mjs";
import { writeLedgerEventFromJson } from "./ledger.write.worker.mjs";
import { alertsFetchRouter } from "./alerts.worker.mjs";
import { notificationsFetchRouter } from "./notifications.worker.mjs";

function json(statusCode, body, headersObj) {
  const h = new Headers(headersObj || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function parsePath(pathname) {
  return (pathname || "/").replace(/\/+$/g, "") || "/";
}

function methodNotAllowed(baseHeaders) {
  return json(405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED" }, baseHeaders);
}
function notFound(baseHeaders) {
  return json(404, { error: "NOT_FOUND", code: "ROUTE_NOT_FOUND" }, baseHeaders);
}

function requireAuth(ctx, baseHeaders) {
  if (!ctx || !ctx.session || ctx.session.isAuthenticated !== true) {
    return json(401, { error: "UNAUTHORIZED", code: "AUTH_REQUIRED", details: null }, baseHeaders);
  }
  if (!ctx.tenantId) {
    return json(403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, baseHeaders);
  }
  return null;
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return "__INVALID_JSON__";
  }
}

export default async function handleFetch(request, env, cfctx) {
  globalThis.__ASORA_ENV__ = env || {};

  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  const requestId = getOrCreateRequestIdFromHeaders(request.headers);
  const session = resolveSessionFromHeaders(request.headers, u);
  const ctx = createRequestContext({ requestId, session });

  const baseHeaders = { "X-Request-Id": requestId };

  // Root health (public)
  if (pathname === "/") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(200, { ok: true, service: "asora", runtime: "cloudflare-worker", requestId }, baseHeaders);
  }

  emitAudit(ctx, {
    eventCategory: "SYSTEM",
    eventType: "HTTP_REQUEST",
    objectType: "http_request",
    objectId: null,
    decision: "SYSTEM",
    reasonCode: "RECEIVED",
    factsSnapshot: { method, path: pathname }
  });

  // Public
  if (pathname === "/api/auth/me") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return authMeFetch(ctx, baseHeaders);
  }

  // Auth gate for /api/*
  if (pathname.startsWith("/api/")) {
    const denied = requireAuth(ctx, baseHeaders);
    if (denied) return denied;
  }

  // DEV-ONLY helpers (browser friendly). Keep under /api/dev/*
  // Create LOW_STOCK ITEM rule:
  // /api/dev/alerts/rule/low-stock?dev_token=tenant:demo%7Cuser:admin&itemId=item-1&thresholdQty=5&enabled=true&note=abc
  if (pathname === "/api/dev/alerts/rule/low-stock") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);

    const itemId = u.searchParams.get("itemId");
    const thresholdQtyRaw = u.searchParams.get("thresholdQty");
    const enabledRaw = u.searchParams.get("enabled");
    const note = u.searchParams.get("note");

    const thresholdQty = thresholdQtyRaw === null ? null : Number(thresholdQtyRaw);
    if (!itemId || typeof itemId !== "string") {
      return json(400, { error: "BAD_REQUEST", code: "MISSING_ITEM_ID", details: null }, baseHeaders);
    }
    if (thresholdQtyRaw === null || !Number.isFinite(thresholdQty) || thresholdQty < 0) {
      return json(400, { error: "BAD_REQUEST", code: "INVALID_THRESHOLD_QTY", details: { thresholdQty: thresholdQtyRaw } }, baseHeaders);
    }

    const enabled = enabledRaw === null ? true : String(enabledRaw).toLowerCase() !== "false";

    // Create via same store shape the rule router expects
    const body = {
      type: "LOW_STOCK",
      scope: "ITEM",
      target: { itemId },
      params: { thresholdQty },
      enabled,
      note: note || null
    };

    // Reuse the POST handler by calling alerts router with a synthetic Request
    const req = new Request(u.origin + "/api/alerts/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const r = await alertsFetchRouter(ctx, req, baseHeaders);
    return r || notFound(baseHeaders);
  }

  // Append ledger event:
  // /api/dev/ledger/append?dev_token=tenant:demo%7Cuser:admin&itemId=item-1&qtyDelta=3&reasonCode=RECEIPT
  if (pathname === "/api/dev/ledger/append") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);

    const itemId = u.searchParams.get("itemId");
    const qtyDeltaRaw = u.searchParams.get("qtyDelta");
    const reasonCode = u.searchParams.get("reasonCode");

    const qtyDelta = qtyDeltaRaw === null ? null : Number(qtyDeltaRaw);

    if (!itemId || typeof itemId !== "string") {
      return json(400, { error: "BAD_REQUEST", code: "MISSING_ITEM_ID", details: null }, baseHeaders);
    }
    if (qtyDeltaRaw === null || !Number.isFinite(qtyDelta)) {
      return json(400, { error: "BAD_REQUEST", code: "INVALID_QTY_DELTA", details: { qtyDelta: qtyDeltaRaw } }, baseHeaders);
    }

    const body = {
      itemId,
      qtyDelta,
      reasonCode: typeof reasonCode === "string" ? reasonCode : "UNSPECIFIED"
    };

    return writeLedgerEventFromJson(ctx, body, baseHeaders);
  }

  // Ledger write (B3) normal API
  if (pathname === "/api/ledger/events") {
    if (method !== "POST") return methodNotAllowed(baseHeaders);
    const body = await readJson(request);
    if (body === "__INVALID_JSON__") {
      return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);
    }
    return writeLedgerEventFromJson(ctx, body, baseHeaders);
  }

  // B10 Alerts
  {
    const r = await alertsFetchRouter(ctx, request, baseHeaders);
    if (r) return r;
  }

  // B10 Notifications
  {
    const r = await notificationsFetchRouter(ctx, request, baseHeaders);
    if (r) return r;
  }

  return notFound(baseHeaders);
}
