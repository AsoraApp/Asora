// backend/src/worker/handleFetch.mjs
import { getOrCreateRequestIdFromHeaders } from "../observability/requestId.worker.mjs";
import { resolveSessionFromHeaders } from "../auth/session.worker.mjs";
import { createRequestContext } from "../domain/requestContext.mjs";
import { emitAudit } from "../observability/audit.mjs";

import { authMeFetch } from "./auth.worker.mjs";
import { writeLedgerEventFromJson } from "./ledger.write.worker.mjs";
import { alertsFetchRouter } from "./alerts.worker.mjs";
import { notificationsFetchRouter } from "./notifications.worker.mjs";

import { loadTenantCollection } from "../storage/jsonStore.worker.mjs";

const BUILD_STAMP = "u11-authorization-fix-2025-12-20T00:00Z"; // CHANGE THIS ON EACH DEPLOY

function json(statusCode, body, headersObj) {
  const h = new Headers(headersObj || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function parsePath(pathname) {
  return (pathname || "/").replace(/\/+$/g, "") || "/";
}

function normalizePath(pathname) {
  // compatibility shims
  if (pathname === "/auth/me") return "/api/auth/me";
  if (pathname.startsWith("/v1/")) return "/api/" + pathname.slice("/v1/".length);
  return pathname;
}

function methodNotAllowed(baseHeaders) {
  return json(405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED", details: null }, baseHeaders);
}

function notFound(baseHeaders) {
  return json(404, { error: "NOT_FOUND", code: "ROUTE_NOT_FOUND", details: null }, baseHeaders);
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

function isAuthedTenantScoped(ctx) {
  return !!(ctx && ctx.session && ctx.session.isAuthenticated === true && ctx.tenantId);
}

// Keep ctx creation defensive
function safeCreateCtx({ requestId, session }) {
  try {
    const c = createRequestContext({ requestId, session });
    const tenantId = c?.tenantId || session?.tenantId || null;
    return { ...(c || {}), requestId, session, tenantId };
  } catch {
    return {
      requestId,
      session: session || { isAuthenticated: false, token: null, tenantId: null, authLevel: null },
      tenantId: session?.tenantId || null,
    };
  }
}

export async function handleFetch(request, env, cfctx) {
  globalThis.__ASORA_ENV__ = env || {};

  const u = new URL(request.url);
  const rawPath = parsePath(u.pathname);
  const pathname = normalizePath(rawPath);
  const method = (request.method || "GET").toUpperCase();

  const requestId = getOrCreateRequestIdFromHeaders(request.headers);
  const baseHeaders = { "X-Request-Id": requestId };

  // Public
  if (pathname === "/__build") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(200, { ok: true, build: BUILD_STAMP, requestId }, baseHeaders);
  }
  if (pathname === "/") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(200, { ok: true, service: "asora", runtime: "cloudflare-worker", requestId }, baseHeaders);
  }

  // Session (THIS is the correct call shape)
  const session = resolveSessionFromHeaders(request.headers, u);

  // Context
  const ctx = safeCreateCtx({ requestId, session });

  // Audit base request
  emitAudit(ctx, {
    eventCategory: "SYSTEM",
    eventType: "HTTP_REQUEST",
    objectType: "http_request",
    objectId: null,
    decision: "SYSTEM",
    reasonCode: "RECEIVED",
    factsSnapshot: { method, path: pathname },
  });

  // Auth route
  if (pathname === "/api/auth/me") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);

    const denied = requireAuth(ctx, baseHeaders);
    if (denied) {
      emitAudit(ctx, {
        eventCategory: "SECURITY",
        eventType: "AUTH_REJECTED",
        objectType: "auth",
        objectId: null,
        decision: "DENY",
        reasonCode: denied.status === 403 ? "TENANT_REQUIRED" : "AUTH_REQUIRED",
        factsSnapshot: { method, path: pathname },
      });
      return denied;
    }
    return authMeFetch(ctx, baseHeaders);
  }

  // All /api/* require auth (U10 rule)
  if (pathname.startsWith("/api/")) {
    const denied = requireAuth(ctx, baseHeaders);
    if (denied) {
      emitAudit(ctx, {
        eventCategory: "SECURITY",
        eventType: "AUTH_REJECTED",
        objectType: "auth",
        objectId: null,
        decision: "DENY",
        reasonCode: denied.status === 403 ? "TENANT_REQUIRED" : "AUTH_REQUIRED",
        factsSnapshot: { method, path: pathname },
      });
      return denied;
    }
  }

  // Read endpoints (existing behavior)
  if (pathname === "/api/inventory/items") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const items = await loadTenantCollection(ctx.tenantId, "items.json", []);
    return json(200, { items: Array.isArray(items) ? items : [] }, baseHeaders);
  }

  if (pathname === "/api/inventory/categories") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const categories = await loadTenantCollection(ctx.tenantId, "categories.json", []);
    return json(200, { categories: Array.isArray(categories) ? categories : [] }, baseHeaders);
  }

  if (pathname === "/api/inventory/hubs") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const hubs = await loadTenantCollection(ctx.tenantId, "hubs.json", []);
    return json(200, { hubs: Array.isArray(hubs) ? hubs : [] }, baseHeaders);
  }

  if (pathname === "/api/inventory/bins") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const bins = await loadTenantCollection(ctx.tenantId, "bins.json", []);
    return json(200, { bins: Array.isArray(bins) ? bins : [] }, baseHeaders);
  }

  if (pathname === "/api/inventory/vendors") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const vendors = await loadTenantCollection(ctx.tenantId, "vendors.json", []);
    return json(200, { vendors: Array.isArray(vendors) ? vendors : [] }, baseHeaders);
  }

  // Ledger write
  if (pathname === "/api/ledger/events") {   // GET = read (allowed for any authenticated, tenant-scoped session)   if (method === "GET") {     const events = await loadTenantCollection(ctx.tenantId, "ledger_events", []) || [];     const out = Array.isArray(events)       ? events.slice().sort((a, b) => (a?.createdAtUtc < b?.createdAtUtc ? 1 : -1))       : [];     return json5(200, { events: out }, baseHeaders);   }    // POST = write (dev-only)   if (method === "POST") {     // U11: explicit ledger write authorization     if (ctx?.authLevel !== "dev") {       emitAudit(ctx, {         eventCategory: "SECURITY",         eventType: "AUTHZ_DENIED",         objectType: "ledger_write",         objectId: "/api/ledger/events",         decision: "DENY",         reasonCode: "AUTHZ_DENIED",         factsSnapshot: { authLevel: ctx?.authLevel ?? null },       });       return json5(         403,         { error: "FORBIDDEN", code: "AUTHZ_DENIED", details: null },         baseHeaders       );     }      const body = await readJson2(request);     if (body === "__INVALID_JSON__") {       const r = json5(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);       if (isAuthedTenantScoped(ctx)) {         emitAudit(ctx, {           eventCategory: "SECURITY",           eventType: "VALIDATION_FAILED",           objectType: "request",           objectId: "/api/ledger/events",           decision: "DENY",           reasonCode: "INVALID_JSON",           factsSnapshot: { method, path: pathname },         });       }       return r;     }     return writeLedgerEventFromJson(ctx, body, baseHeaders, cfctx);   }    // anything else   if (isAuthedTenantScoped(ctx)) {     emitAudit(ctx, {       eventCategory: "SECURITY",       eventType: "ROUTE_METHOD_NOT_ALLOWED",       objectType: "http_route",       objectId: "/api/ledger/events",       decision: "DENY",       reasonCode: "METHOD_NOT_ALLOWED",       factsSnapshot: { method, path: pathname },     });   }   return methodNotAllowed(baseHeaders); }
    // FIX: authLevel lives on ctx.session (not ctx)
    if (ctx?.session?.authLevel !== "dev") {
      emitAudit(ctx, {
        eventCategory: "SECURITY",
        eventType: "AUTHZ_DENIED",
        objectType: "ledger_write",
        objectId: "/api/ledger/events",
        decision: "DENY",
        reasonCode: "AUTHZ_DENIED",
        factsSnapshot: { authLevel: ctx?.session?.authLevel ?? null },
      });
      return json(403, { error: "FORBIDDEN", code: "AUTHZ_DENIED", details: null }, baseHeaders);
    }

    if (method !== "POST") return methodNotAllowed(baseHeaders);

    const body = await readJson(request);
    if (body === "__INVALID_JSON__") {
      emitAudit(ctx, {
        eventCategory: "SECURITY",
        eventType: "VALIDATION_FAILED",
        objectType: "request",
        objectId: "/api/ledger/events",
        decision: "DENY",
        reasonCode: "INVALID_JSON",
        factsSnapshot: { method, path: pathname },
      });
      return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);
    }

    return writeLedgerEventFromJson(ctx, body, baseHeaders, cfctx);
  }

  // Alerts / notifications (unchanged calling convention)
  {
    const r = await alertsFetchRouter(ctx, request, baseHeaders, cfctx);
    if (r) return r;
  }
  {
    const r = await notificationsFetchRouter(ctx, request, baseHeaders);
    if (r) return r;
  }

  // Fallthrough
  if (pathname.startsWith("/api/")) {
    if (isAuthedTenantScoped(ctx)) {
      emitAudit(ctx, {
        eventCategory: "SECURITY",
        eventType: "ROUTE_NOT_FOUND",
        objectType: "http_route",
        objectId: pathname,
        decision: "DENY",
        reasonCode: "ROUTE_NOT_FOUND",
        factsSnapshot: { method, path: pathname },
      });
    }
    return notFound(baseHeaders);
  }

  return notFound(baseHeaders);
}
