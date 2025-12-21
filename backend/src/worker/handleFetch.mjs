// backend/src/worker/handleFetch.mjs
import { getOrCreateRequestIdFromHeaders } from "../observability/requestId.worker.mjs";
import { resolveSessionFromHeaders } from "../auth/session.worker.mjs";
import { createRequestContext } from "../domain/requestContext.mjs";
import { emitAudit } from "../observability/audit.worker.mjs";

import { authMeFetch } from "./auth.worker.mjs";
import { writeLedgerEventFromJson } from "./ledger.write.worker.mjs";
import { alertsFetchRouter } from "./alerts.worker.mjs";
import { notificationsFetchRouter } from "./notifications.worker.mjs";

import { loadTenantCollection } from "../storage/jsonStore.worker.mjs";

const BUILD_STAMP = "u13-cors-ui-baseurl-fix-2025-12-21T16:58Z"; // CHANGE THIS ON EACH DEPLOY

// ---- CORS (UI -> Worker API) ----
// Keep conservative; only allow known UI origins.
const CORS_ALLOW_ORIGINS = new Set([
  "https://asora.pages.dev",
  "http://localhost:3000",
]);

function getAllowedOrigin(request) {
  const origin = request?.headers?.get?.("Origin") || request?.headers?.get?.("origin") || "";
  if (!origin) return null;
  if (CORS_ALLOW_ORIGINS.has(origin)) return origin;
  return null;
}

function withCors(request, response) {
  try {
    const origin = getAllowedOrigin(request);
    if (!origin) return response;

    const h = new Headers(response.headers);
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    h.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
    // If you ever use cookies/credentials, you must set this AND cannot use "*"
    // h.set("Access-Control-Allow-Credentials", "true");

    return new Response(response.body, { status: response.status, headers: h });
  } catch {
    return response;
  }
}

function corsPreflightResponse(request, baseHeaders) {
  const origin = getAllowedOrigin(request);
  if (!origin) {
    // Fail-closed: if we don't recognize origin, don't add ACAO.
    return json(204, null, baseHeaders);
  }
  const h = new Headers(baseHeaders || {});
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
  return new Response(null, { status: 204, headers: h });
}

function json(statusCode, body, headersObj) {
  const h = new Headers(headersObj || {});
  // If body is null for 204/etc, don't force JSON.
  if (body !== null && body !== undefined) {
    h.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(body), { status: statusCode, headers: h });
  }
  return new Response(null, { status: statusCode, headers: h });
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
  return json(
    405,
    { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED", details: null },
    baseHeaders
  );
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

function safeCreateCtx({ requestId, session }) {
  try {
    const c = createRequestContext({ requestId, session });
    return { ...(c || {}), requestId, session };
  } catch {
    return {
      requestId,
      session: session || {
        isAuthenticated: false,
        token: null,
        tenantId: null,
        actorId: null,
        authLevel: null,
      },
      tenantId: null,
      actorId: null,
    };
  }
}

/**
 * U13: rate-limit foundation (classification only; no limits enforced).
 * - "infra": public service/health/meta/build
 * - "read": GET under /api/*
 * - "write": non-GET under /api/*
 */
function classifyRequest(pathname, method) {
  if (
    pathname === "/" ||
    pathname === "/__build" ||
    pathname === "/__meta" ||
    pathname === "/__health"
  ) {
    return "infra";
  }
  if (pathname.startsWith("/api/")) {
    return method === "GET" ? "read" : "write";
  }
  return "infra";
}

function mapExceptionToHttp(err) {
  const code = err?.code || err?.message || null;

  if (code === "KV_NOT_BOUND") {
    return {
      status: 503,
      body: { error: "SERVICE_UNAVAILABLE", code: "KV_NOT_BOUND", details: null },
      audit: { eventCategory: "SYSTEM", eventType: "STORAGE_UNAVAILABLE", reasonCode: "KV_NOT_BOUND" },
    };
  }

  if (code === "TENANT_NOT_RESOLVED") {
    return {
      status: 403,
      body: { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null },
      audit: { eventCategory: "SECURITY", eventType: "TENANT_MISSING", reasonCode: "TENANT_NOT_RESOLVED" },
    };
  }

  if (code === "INVALID_COLLECTION_NAME") {
    return {
      status: 500,
      body: { error: "INTERNAL_ERROR", code: "INVALID_COLLECTION_NAME", details: null },
      audit: { eventCategory: "SYSTEM", eventType: "INTERNAL_ERROR", reasonCode: "INVALID_COLLECTION_NAME" },
    };
  }

  return {
    status: 500,
    body: { error: "INTERNAL_ERROR", code: "UNHANDLED_EXCEPTION", details: null },
    audit: { eventCategory: "SYSTEM", eventType: "INTERNAL_ERROR", reasonCode: "UNHANDLED_EXCEPTION" },
  };
}

async function route(request, env, cfctx) {
  const u = new URL(request.url);
  const rawPath = parsePath(u.pathname);
  const pathname = normalizePath(rawPath);
  const method = (request.method || "GET").toUpperCase();

  const requestId = getOrCreateRequestIdFromHeaders(request.headers);
  const baseHeaders = { "X-Request-Id": requestId };

  // ---- CORS preflight ----
  if (method === "OPTIONS") {
    // Only respond to OPTIONS for the API/infra surface.
    if (pathname.startsWith("/api/") || pathname.startsWith("/__") || pathname === "/") {
      return corsPreflightResponse(request, baseHeaders);
    }
    return notFound(baseHeaders);
  }

  // --- Public infra (no auth) ---
  if (pathname === "/__build") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(200, { ok: true, build: BUILD_STAMP, requestId }, baseHeaders);
  }

  if (pathname === "/__health") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(200, { ok: true }, baseHeaders);
  }

  if (pathname === "/__meta") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(
      200,
      {
        ok: true,
        service: "asora",
        runtime: "cloudflare-worker",
        build: BUILD_STAMP,
        region: cfctx?.colo || null,
        env: env?.ENV ?? null,
        requestId,
      },
      baseHeaders
    );
  }

  if (pathname === "/") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(200, { ok: true, service: "asora", runtime: "cloudflare-worker", requestId }, baseHeaders);
  }

  // --- Session (authoritative signature) ---
  const sr = await resolveSessionFromHeaders(request, env);
  const session =
    sr && sr.ok === true
      ? sr.session
      : {
          isAuthenticated: false,
          token: null,
          tenantId: null,
          actorId: null,
          authLevel: null,
        };

  // --- Context ---
  const ctx = safeCreateCtx({ requestId, session });

  // --- Classification (foundation only) ---
  const classification = classifyRequest(pathname, method);

  // --- Base audit (never blocks) ---
  emitAudit(
    ctx,
    {
      eventCategory: "SYSTEM",
      eventType: "HTTP_REQUEST",
      objectType: "http_request",
      objectId: null,
      decision: "SYSTEM",
      reasonCode: "RECEIVED",
      factsSnapshot: { method, path: pathname, classification },
    },
    env,
    cfctx
  );

  // --- Auth route ---
  if (pathname === "/api/auth/me") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);

    const denied = requireAuth(ctx, baseHeaders);
    if (denied) {
      emitAudit(
        ctx,
        {
          eventCategory: "SECURITY",
          eventType: "AUTH_REJECTED",
          objectType: "auth",
          objectId: "/api/auth/me",
          decision: "DENY",
          reasonCode: denied.status === 403 ? "TENANT_REQUIRED" : "AUTH_REQUIRED",
          factsSnapshot: { method, path: pathname, classification },
        },
        env,
        cfctx
      );
      return denied;
    }

    return authMeFetch(ctx, baseHeaders);
  }

  // --- All /api/* require auth ---
  if (pathname.startsWith("/api/")) {
    const denied = requireAuth(ctx, baseHeaders);
    if (denied) {
      emitAudit(
        ctx,
        {
          eventCategory: "SECURITY",
          eventType: "AUTH_REJECTED",
          objectType: "auth",
          objectId: pathname,
          decision: "DENY",
          reasonCode: denied.status === 403 ? "TENANT_REQUIRED" : "AUTH_REQUIRED",
          factsSnapshot: { method, path: pathname, classification },
        },
        env,
        cfctx
      );
      return denied;
    }
  }

  // --- Audit read ---
  if (pathname === "/api/audit/events") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);

    const sp = u.searchParams;
    const rawLimit = sp.get("limit");
    const limit = rawLimit === null ? 500 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit <= 0 || limit > 2000) {
      return json(400, { error: "BAD_REQUEST", code: "INVALID_LIMIT", details: { limit: rawLimit } }, baseHeaders);
    }

    const all = (await loadTenantCollection(env, ctx.tenantId, "audit_events", [])) || [];
    const rows = Array.isArray(all) ? all.slice() : [];

    rows.sort((a, b) => {
      const at = String(a?.createdAtUtc ?? "");
      const bt = String(b?.createdAtUtc ?? "");
      if (at === bt) {
        const aid = String(a?.auditEventId ?? "");
        const bid = String(b?.auditEventId ?? "");
        return aid < bid ? -1 : aid > bid ? 1 : 0;
      }
      return at < bt ? 1 : -1;
    });

    const page = rows.slice(0, limit);
    return json(200, { events: page, page: { limit, returned: page.length } }, baseHeaders);
  }

  // --- Inventory read endpoints ---
  if (pathname === "/api/inventory/items") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const items = await loadTenantCollection(env, ctx.tenantId, "items.json", []);
    return json(200, { items: Array.isArray(items) ? items : [] }, baseHeaders);
  }

  if (pathname === "/api/inventory/categories") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const categories = await loadTenantCollection(env, ctx.tenantId, "categories.json", []);
    return json(200, { categories: Array.isArray(categories) ? categories : [] }, baseHeaders);
  }

  if (pathname === "/api/inventory/hubs") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const hubs = await loadTenantCollection(env, ctx.tenantId, "hubs.json", []);
    return json(200, { hubs: Array.isArray(hubs) ? hubs : [] }, baseHeaders);
  }

  if (pathname === "/api/inventory/bins") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const bins = await loadTenantCollection(env, ctx.tenantId, "bins.json", []);
    return json(200, { bins: Array.isArray(bins) ? bins : [] }, baseHeaders);
  }

  if (pathname === "/api/inventory/vendors") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const vendors = await loadTenantCollection(env, ctx.tenantId, "vendors.json", []);
    return json(200, { vendors: Array.isArray(vendors) ? vendors : [] }, baseHeaders);
  }

  // --- Ledger events ---
  if (pathname === "/api/ledger/events") {
    if (method === "GET") {
      const sp = u.searchParams;

      const rawLimit = sp.get("limit");
      const limit = rawLimit === null ? 500 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit <= 0 || limit > 2000) {
        return json(400, { error: "BAD_REQUEST", code: "INVALID_LIMIT", details: { limit: rawLimit } }, baseHeaders);
      }

      const order = (sp.get("order") || "desc").toLowerCase();
      if (order !== "asc" && order !== "desc") {
        return json(400, { error: "BAD_REQUEST", code: "INVALID_ORDER", details: { order } }, baseHeaders);
      }

      const before = sp.get("before");
      const after = sp.get("after");
      if (before && after) {
        return json(400, { error: "BAD_REQUEST", code: "BEFORE_AND_AFTER", details: null }, baseHeaders);
      }

      const beforeTs = before ? Date.parse(before) : null;
      const afterTs = after ? Date.parse(after) : null;
      if ((before && !Number.isFinite(beforeTs)) || (after && !Number.isFinite(afterTs))) {
        return json(400, { error: "BAD_REQUEST", code: "INVALID_TIMESTAMP", details: { before, after } }, baseHeaders);
      }

      const itemId = sp.get("itemId");

      const all = (await loadTenantCollection(env, ctx.tenantId, "ledger_events", [])) || [];
      let rows = Array.isArray(all) ? all.slice() : [];

      if (itemId) rows = rows.filter((e) => e?.itemId === itemId);
      if (beforeTs !== null) rows = rows.filter((e) => Date.parse(e?.createdAtUtc) < beforeTs);
      if (afterTs !== null) rows = rows.filter((e) => Date.parse(e?.createdAtUtc) > afterTs);

      rows.sort((a, b) => {
        const at = String(a?.createdAtUtc ?? "");
        const bt = String(b?.createdAtUtc ?? "");
        if (at === bt) {
          const aid = String(a?.ledgerEventId ?? "");
          const bid = String(b?.ledgerEventId ?? "");
          return aid < bid ? -1 : aid > bid ? 1 : 0;
        }
        return at < bt ? -1 : 1;
      });

      if (order === "desc") rows.reverse();

      const page = rows.slice(0, limit);
      const last = page[page.length - 1] || null;

      return json(
        200,
        {
          events: page,
          page: {
            limit,
            order,
            before: before || null,
            after: after || null,
            itemId,
            returned: page.length,
            nextBefore: order === "desc" && last ? last.createdAtUtc : null,
            nextAfter: order === "asc" && last ? last.createdAtUtc : null,
          },
        },
        baseHeaders
      );
    }

    if (method === "POST") {
      if (ctx?.session?.authLevel !== "dev") {
        emitAudit(
          ctx,
          {
            eventCategory: "SECURITY",
            eventType: "AUTHZ_DENIED",
            objectType: "ledger_write",
            objectId: "/api/ledger/events",
            decision: "DENY",
            reasonCode: "AUTHZ_DENIED",
            factsSnapshot: { authLevel: ctx?.session?.authLevel ?? null, classification },
          },
          env,
          cfctx
        );
        return json(403, { error: "FORBIDDEN", code: "AUTHZ_DENIED", details: null }, baseHeaders);
      }

      const body = await readJson(request);
      if (body === "__INVALID_JSON__") {
        emitAudit(
          ctx,
          {
            eventCategory: "SECURITY",
            eventType: "VALIDATION_FAILED",
            objectType: "request",
            objectId: "/api/ledger/events",
            decision: "DENY",
            reasonCode: "INVALID_JSON",
            factsSnapshot: { method, path: pathname, classification },
          },
          env,
          cfctx
        );
        return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);
      }

      return writeLedgerEventFromJson(ctx, body, baseHeaders, cfctx, env);
    }

    return methodNotAllowed(baseHeaders);
  }

  // Alerts / notifications routers
  {
    const r = await alertsFetchRouter(ctx, request, baseHeaders, cfctx, env);
    if (r) return r;
  }
  {
    const r = await notificationsFetchRouter(ctx, request, baseHeaders, cfctx, env);
    if (r) return r;
  }

  if (pathname.startsWith("/api/")) return notFound(baseHeaders);
  return notFound(baseHeaders);
}

export async function handleFetch(request, env, cfctx) {
  const requestId = getOrCreateRequestIdFromHeaders(request?.headers || new Headers());
  const baseHeaders = { "X-Request-Id": requestId };

  try {
    const res = await route(request, env, cfctx);
    return withCors(request, res);
  } catch (err) {
    const ctx = safeCreateCtx({
      requestId,
      session: {
        isAuthenticated: false,
        token: null,
        tenantId: null,
        actorId: null,
        authLevel: null,
      },
    });

    const mapped = mapExceptionToHttp(err);

    emitAudit(
      ctx,
      {
        eventCategory: mapped.audit.eventCategory,
        eventType: mapped.audit.eventType,
        objectType: "exception",
        objectId: null,
        decision: "DENY",
        reasonCode: mapped.audit.reasonCode,
        factsSnapshot: { message: String(err?.message || ""), code: String(err?.code || "") },
      },
      env,
      cfctx
    );

    return withCors(request, json(mapped.status, mapped.body, baseHeaders));
  }
}
