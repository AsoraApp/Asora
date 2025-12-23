// backend/src/worker/handleFetch.mjs
import { getOrCreateRequestIdFromHeaders } from "../observability/requestId.worker.mjs";
import { resolveSessionFromHeaders } from "../auth/session.worker.mjs";
import { createRequestContext } from "../domain/requestContext.mjs";
import { emitAudit } from "../observability/audit.worker.mjs";

import { authMeFetch, authLoginFetch, authCallbackFetch, authRefreshFetch, authLogoutFetch } from "./auth.worker.mjs";
import { writeLedgerEventFromJson } from "./ledger.write.worker.mjs";
import { alertsFetchRouter } from "./alerts.worker.mjs";
import { notificationsFetchRouter } from "./notifications.worker.mjs";

import { loadTenantCollection } from "../storage/jsonStore.worker.mjs";

const BUILD_STAMP = "u20-enterprise-auth-foundation-2025-12-23T00:40Z"; // CHANGE THIS ON EACH DEPLOY

// ---- CORS (UI -> Worker API) ----
// Keep conservative; only allow known UI origins.
const CORS_ALLOW_ORIGINS = new Set(["https://asora.pages.dev", "http://localhost:3000"]);

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

    return new Response(response.body, { status: response.status, headers: h });
  } catch {
    return response;
  }
}

function corsPreflightResponse(request, baseHeaders) {
  const origin = getAllowedOrigin(request);
  if (!origin) {
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

function safeCreateCtx({ requestId, session }) {
  try {
    const c = createRequestContext({ requestId, session });
    return { ...(c || {}), requestId, session };
  } catch {
    return {
      requestId,
      session:
        session || ({
          isAuthenticated: false,
          token: null,
          tenantId: null,
          actorId: null,
          authLevel: null,
        }),
      tenantId: null,
      actorId: null,
    };
  }
}

function classifyRequest(pathname, method) {
  if (pathname === "/" || pathname === "/__build" || pathname === "/__meta" || pathname === "/__health") return "infra";
  if (pathname.startsWith("/api/")) return method === "GET" ? "read" : "write";
  return "infra";
}

// ---- rate limit code unchanged (your existing RL) ----
const RL_WINDOW_SEC = 60;
const RL_LIMITS = { infra: 120, read: 600, write: 120 };
const __RL = new Map();

function getSourceIp(request, cfctx) {
  const h = request?.headers;
  const ip =
    h?.get?.("CF-Connecting-IP") ||
    h?.get?.("cf-connecting-ip") ||
    h?.get?.("X-Forwarded-For") ||
    h?.get?.("x-forwarded-for") ||
    (cfctx && typeof cfctx === "object" ? cfctx.clientIp : null) ||
    null;
  if (!ip) return "unknown";
  const first = String(ip).split(",")[0].trim();
  return first || "unknown";
}

function fixedWindowStartMs(nowMs) {
  return Math.floor(nowMs / (RL_WINDOW_SEC * 1000)) * (RL_WINDOW_SEC * 1000);
}

function makeRateKey({ classification, tenantId, request, cfctx }) {
  if (classification === "infra") return `infra:${getSourceIp(request, cfctx)}`;
  return `${classification}:tenant:${String(tenantId || "none")}`;
}

function buildRateHeaders({ limit, remaining, resetAtSec, retryAfterSec }) {
  const h = {};
  h["X-RateLimit-Limit"] = String(limit);
  h["X-RateLimit-Remaining"] = String(Math.max(0, remaining));
  h["X-RateLimit-Reset"] = String(resetAtSec);
  if (retryAfterSec !== null && retryAfterSec !== undefined) h["Retry-After"] = String(Math.max(0, Math.ceil(retryAfterSec)));
  return h;
}

function rateLimitCheck({ classification, tenantId, request, cfctx }) {
  const limit = RL_LIMITS[classification] ?? RL_LIMITS.infra;
  const nowMs = Date.now();
  const windowStartMs = fixedWindowStartMs(nowMs);
  const resetAtMs = windowStartMs + RL_WINDOW_SEC * 1000;

  const key = makeRateKey({ classification, tenantId, request, cfctx });
  const prev = __RL.get(key);

  if (!prev || prev.windowStartMs !== windowStartMs) {
    __RL.set(key, { windowStartMs, count: 1 });
    return { ok: true, key, limit, remaining: limit - 1, resetAtMs, retryAfterSec: null, windowStartMs };
  }

  const nextCount = prev.count + 1;
  prev.count = nextCount;

  if (nextCount <= limit) return { ok: true, key, limit, remaining: limit - nextCount, resetAtMs, retryAfterSec: null, windowStartMs };

  const retryAfterSec = (resetAtMs - nowMs) / 1000;
  return { ok: false, key, limit, remaining: 0, resetAtMs, retryAfterSec, windowStartMs };
}

function tooManyRequests(baseHeaders, details, rate) {
  const resetAtSec = Math.floor((rate?.resetAtMs || 0) / 1000) || 0;
  const extra = buildRateHeaders({ limit: rate?.limit ?? 0, remaining: 0, resetAtSec, retryAfterSec: rate?.retryAfterSec ?? 0 });

  return json(
    429,
    { error: "TOO_MANY_REQUESTS", code: "RATE_LIMITED", details: details || null },
    { ...(baseHeaders || {}), ...extra }
  );
}

function mapExceptionToHttp(err) {
  const code = err?.code || err?.message || null;

  if (code === "KV_NOT_BOUND") {
    return { status: 503, body: { error: "SERVICE_UNAVAILABLE", code: "KV_NOT_BOUND", details: null }, audit: { eventCategory: "SYSTEM", eventType: "STORAGE_UNAVAILABLE", reasonCode: "KV_NOT_BOUND" } };
  }
  if (code === "TENANT_NOT_RESOLVED") {
    return { status: 403, body: { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null }, audit: { eventCategory: "SECURITY", eventType: "TENANT_MISSING", reasonCode: "TENANT_NOT_RESOLVED" } };
  }
  if (code === "INVALID_COLLECTION_NAME") {
    return { status: 500, body: { error: "INTERNAL_ERROR", code: "INVALID_COLLECTION_NAME", details: null }, audit: { eventCategory: "SYSTEM", eventType: "INTERNAL_ERROR", reasonCode: "INVALID_COLLECTION_NAME" } };
  }

  return { status: 500, body: { error: "INTERNAL_ERROR", code: "UNHANDLED_EXCEPTION", details: null }, audit: { eventCategory: "SYSTEM", eventType: "INTERNAL_ERROR", reasonCode: "UNHANDLED_EXCEPTION" } };
}

async function route(request, env, cfctx) {
  const u = new URL(request.url);
  const rawPath = parsePath(u.pathname);
  const pathname = normalizePath(rawPath);
  const method = (request.method || "GET").toUpperCase();

  const requestId = getOrCreateRequestIdFromHeaders(request.headers);
  const baseHeaders = { "X-Request-Id": requestId };

  if (method === "OPTIONS") {
    if (pathname.startsWith("/api/") || pathname.startsWith("/__") || pathname === "/") return corsPreflightResponse(request, baseHeaders);
    return notFound(baseHeaders);
  }

  // Public infra
  if (pathname === "/__build") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const rl = rateLimitCheck({ classification: "infra", tenantId: null, request, cfctx });
    if (!rl.ok) return tooManyRequests(baseHeaders, { classification: "infra", limit: rl.limit, windowSec: RL_WINDOW_SEC }, rl);
    return json(200, { ok: true, build: BUILD_STAMP, requestId }, baseHeaders);
  }

  if (pathname === "/__health") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const rl = rateLimitCheck({ classification: "infra", tenantId: null, request, cfctx });
    if (!rl.ok) return tooManyRequests(baseHeaders, { classification: "infra", limit: rl.limit, windowSec: RL_WINDOW_SEC }, rl);
    return json(200, { ok: true }, baseHeaders);
  }

  if (pathname === "/__meta") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const rl = rateLimitCheck({ classification: "infra", tenantId: null, request, cfctx });
    if (!rl.ok) return tooManyRequests(baseHeaders, { classification: "infra", limit: rl.limit, windowSec: RL_WINDOW_SEC }, rl);
    return json(200, { ok: true, service: "asora", runtime: "cloudflare-worker", build: BUILD_STAMP, region: cfctx?.colo || null, env: env?.ENV ?? null, requestId }, baseHeaders);
  }

  if (pathname === "/") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const rl = rateLimitCheck({ classification: "infra", tenantId: null, request, cfctx });
    if (!rl.ok) return tooManyRequests(baseHeaders, { classification: "infra", limit: rl.limit, windowSec: RL_WINDOW_SEC }, rl);
    return json(200, { ok: true, service: "asora", runtime: "cloudflare-worker", requestId }, baseHeaders);
  }

  // OIDC entrypoints must be reachable without existing Asora auth
  if (pathname === "/api/auth/login") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return authLoginFetch(request, env, baseHeaders);
  }
  if (pathname === "/api/auth/callback") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return authCallbackFetch(request, env, baseHeaders);
  }
  if (pathname === "/api/auth/refresh") {
    if (method !== "POST") return methodNotAllowed(baseHeaders);
    // refresh uses cookies, not bearer; ctx not needed yet
    const ctx = safeCreateCtx({ requestId, session: { isAuthenticated: false, token: null, tenantId: null, actorId: null, authLevel: null } });
    return authRefreshFetch(request, ctx, env, baseHeaders);
  }
  if (pathname === "/api/auth/logout") {
    if (method !== "POST") return methodNotAllowed(baseHeaders);
    return authLogoutFetch(request, env, baseHeaders);
  }

  // Resolve session for everything else
  const sr = await resolveSessionFromHeaders(request, env);
  const session =
    sr && sr.ok === true
      ? sr.session
      : { isAuthenticated: false, token: null, tenantId: null, actorId: null, authLevel: null };

  const ctx = safeCreateCtx({ requestId, session });
  const classification = classifyRequest(pathname, method);

  emitAudit(
    ctx,
    { eventCategory: "SYSTEM", eventType: "HTTP_REQUEST", objectType: "http_request", objectId: null, decision: "SYSTEM", reasonCode: "RECEIVED", factsSnapshot: { method, path: pathname, classification } },
    env,
    cfctx
  );

  if (pathname.startsWith("/api/") && ctx?.tenantId) {
    const rl = rateLimitCheck({ classification, tenantId: ctx.tenantId, request, cfctx });
    if (!rl.ok) return tooManyRequests(baseHeaders, { classification, tenantId: ctx.tenantId, limit: rl.limit, windowSec: RL_WINDOW_SEC }, rl);
  }

  // Auth/me requires auth
  if (pathname === "/api/auth/me") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const denied = requireAuth(ctx, baseHeaders);
    if (denied) return denied;
    return authMeFetch(ctx, baseHeaders);
  }

  // All /api/* require auth (except auth/login/callback/refresh/logout handled above)
  if (pathname.startsWith("/api/")) {
    const denied = requireAuth(ctx, baseHeaders);
    if (denied) return denied;
  }

  // Inventory reads
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

  // Ledger routes (unchanged below here)...
  // (Keep your existing /api/ledger/events GET/POST implementation as-is; omitted here only because you already have it in your current file.)
  // IMPORTANT: do not change ledger semantics in U20.

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
      session: { isAuthenticated: false, token: null, tenantId: null, actorId: null, authLevel: null },
    });

    const mapped = mapExceptionToHttp(err);

    emitAudit(
      ctx,
      { eventCategory: mapped.audit.eventCategory, eventType: mapped.audit.eventType, objectType: "exception", objectId: null, decision: "DENY", reasonCode: mapped.audit.reasonCode, factsSnapshot: { message: String(err?.message || ""), code: String(err?.code || "") } },
      env,
      cfctx
    );

    return withCors(request, json(mapped.status, mapped.body, baseHeaders));
  }
}
