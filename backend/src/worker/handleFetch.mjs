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

const BUILD_STAMP = "u17-ledger-read-ordering-2025-12-22T22:15Z"; // CHANGE THIS ON EACH DEPLOY

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

/**
 * U13: rate-limit foundation (classification only; no limits enforced).
 * - "infra": public service/health/meta/build
 * - "read": GET under /api/*
 * - "write": non-GET under /api/*
 */
function classifyRequest(pathname, method) {
  if (pathname === "/" || pathname === "/__build" || pathname === "/__meta" || pathname === "/__health") {
    return "infra";
  }
  if (pathname.startsWith("/api/")) {
    return method === "GET" ? "read" : "write";
  }
  return "infra";
}

/**
 * U15-3: Soft rate limits (enforced, but generous).
 *
 * IMPORTANT:
 * - Uses in-memory counters only (no durable state).
 * - Limits are "soft": intended to prevent abuse and runaway loops, not normal ops.
 * - Tenant-scoped for /api/*; infra scoped by source IP when possible.
 * - Deterministic 429 shape + headers.
 *
 * Windows:
 * - Fixed 60-second window, deterministic reset boundary per key.
 */

// Fixed window size (seconds)
const RL_WINDOW_SEC = 60;

// Generous limits to avoid breaking normal operator workflows.
const RL_LIMITS = {
  infra: 120, // per minute per IP-ish
  read: 600, // per minute per tenant
  write: 120, // per minute per tenant
};

// In-memory fixed-window counters: key -> { windowStartMs, count }
const __RL = new Map();

function getSourceIp(request, cfctx) {
  // Prefer CF edge-provided headers when present.
  const h = request?.headers;
  const ip =
    h?.get?.("CF-Connecting-IP") ||
    h?.get?.("cf-connecting-ip") ||
    h?.get?.("X-Forwarded-For") ||
    h?.get?.("x-forwarded-for") ||
    (cfctx && typeof cfctx === "object" ? cfctx.clientIp : null) ||
    null;

  if (!ip) return "unknown";
  // If XFF has a list, take first hop.
  const first = String(ip).split(",")[0].trim();
  return first || "unknown";
}

function fixedWindowStartMs(nowMs) {
  // Deterministic floor to 60s boundaries.
  return Math.floor(nowMs / (RL_WINDOW_SEC * 1000)) * (RL_WINDOW_SEC * 1000);
}

function makeRateKey({ classification, tenantId, request, cfctx }) {
  if (classification === "infra") {
    const ip = getSourceIp(request, cfctx);
    return `infra:${ip}`;
  }
  // /api/* must be tenant scoped (hard boundary).
  return `${classification}:tenant:${String(tenantId || "none")}`;
}

function buildRateHeaders({ limit, remaining, resetAtSec, retryAfterSec }) {
  const h = {};
  // These are informational; deterministic values.
  h["X-RateLimit-Limit"] = String(limit);
  h["X-RateLimit-Remaining"] = String(Math.max(0, remaining));
  h["X-RateLimit-Reset"] = String(resetAtSec); // unix seconds
  if (retryAfterSec !== null && retryAfterSec !== undefined) {
    h["Retry-After"] = String(Math.max(0, Math.ceil(retryAfterSec)));
  }
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
    return {
      ok: true,
      key,
      limit,
      remaining: limit - 1,
      resetAtMs,
      retryAfterSec: null,
      windowStartMs,
    };
  }

  const nextCount = prev.count + 1;
  prev.count = nextCount;

  if (nextCount <= limit) {
    return {
      ok: true,
      key,
      limit,
      remaining: limit - nextCount,
      resetAtMs,
      retryAfterSec: null,
      windowStartMs,
    };
  }

  const retryAfterSec = (resetAtMs - nowMs) / 1000;
  return {
    ok: false,
    key,
    limit,
    remaining: 0,
    resetAtMs,
    retryAfterSec,
    windowStartMs,
  };
}

function tooManyRequests(baseHeaders, details, rate) {
  const resetAtSec = Math.floor((rate?.resetAtMs || 0) / 1000) || 0;
  const extra = buildRateHeaders({
    limit: rate?.limit ?? 0,
    remaining: 0,
    resetAtSec,
    retryAfterSec: rate?.retryAfterSec ?? 0,
  });

  return json(
    429,
    {
      error: "TOO_MANY_REQUESTS",
      code: "RATE_LIMITED",
      details: details || null,
    },
    { ...(baseHeaders || {}), ...extra }
  );
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

// ---- U17 helpers: deterministic ordering + cursor keys ----

function parseOptionalInt(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  return n;
}

function parseOptionalString(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s ? s : null;
}

function normalizeSequence(e) {
  // U16 writes integer sequence. For legacy events without sequence, use 0 (deterministic fallback).
  const n = Number(e?.sequence);
  return Number.isInteger(n) && Number.isFinite(n) ? n : 0;
}

function normalizeEventId(e) {
  // U16 canonical: event_id. Back-compat: ledgerEventId (and some older shapes may only have that).
  return String(e?.event_id ?? e?.ledgerEventId ?? "").trim();
}

// Compare keys (seq,eventId) in ascending order. Returns -1/0/1.
function compareLedgerKeysAsc(aSeq, aId, bSeq, bId) {
  if (aSeq < bSeq) return -1;
  if (aSeq > bSeq) return 1;
  // seq tie -> event_id tiebreaker (string compare; deterministic)
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

function keyFromEvent(e) {
  return { seq: normalizeSequence(e), id: normalizeEventId(e) };
}

function validateCursorPair(seq, id) {
  // If one is provided, we allow the other to be missing.
  // Missing id means the cursor anchors only by seq; comparisons remain deterministic.
  if (seq === null && id === null) return { ok: true };
  if (seq !== null && !Number.isInteger(seq)) return { ok: false, code: "INVALID_CURSOR" };
  if (id !== null && typeof id !== "string") return { ok: false, code: "INVALID_CURSOR" };
  return { ok: true };
}

function applyCursorFilter(rows, { beforeSeq, beforeId, afterSeq, afterId }) {
  // Semantics are order-independent:
  // - before_* means strictly < (beforeSeq,beforeId)
  // - after_* means strictly > (afterSeq,afterId)
  //
  // If *Id is null, comparison is seq-only with deterministic behavior:
  // - for before: keep seq < beforeSeq, or seq === beforeSeq and (id < "" ?) -> we treat as seq-only boundary (strict).
  // - for after: keep seq > afterSeq, or seq === afterSeq and (id > "" ?) -> treat as seq-only boundary (strict).
  //
  // This remains deterministic; callers should provide both for fully stable paging.
  let out = rows;

  if (beforeSeq !== null) {
    const bId = beforeId ?? null;
    out = out.filter((e) => {
      const k = keyFromEvent(e);
      if (bId === null) return k.seq < beforeSeq; // seq-only strict
      return compareLedgerKeysAsc(k.seq, k.id, beforeSeq, bId) === -1;
    });
  }

  if (afterSeq !== null) {
    const aId = afterId ?? null;
    out = out.filter((e) => {
      const k = keyFromEvent(e);
      if (aId === null) return k.seq > afterSeq; // seq-only strict
      return compareLedgerKeysAsc(k.seq, k.id, afterSeq, aId) === 1;
    });
  }

  return out;
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

    // Soft rate limit infra (by IP-ish)
    const classification = "infra";
    const rl = rateLimitCheck({ classification, tenantId: null, request, cfctx });
    if (!rl.ok) {
      // Audit (never blocks on audit failure)
      try {
        const ctx = safeCreateCtx({
          requestId,
          session: { isAuthenticated: false, token: null, tenantId: null, actorId: null, authLevel: null },
        });
        emitAudit(
          ctx,
          {
            eventCategory: "SECURITY",
            eventType: "RATE_LIMIT",
            objectType: "http_request",
            objectId: pathname,
            decision: "DENY",
            reasonCode: "RATE_LIMITED",
            factsSnapshot: { method, path: pathname, classification, limit: rl.limit, windowSec: RL_WINDOW_SEC },
          },
          env,
          cfctx
        );
      } catch {
        // ignore
      }

      return tooManyRequests(
        baseHeaders,
        { classification, limit: rl.limit, windowSec: RL_WINDOW_SEC, retryAfterSec: Math.ceil(rl.retryAfterSec || 0) },
        rl
      );
    }

    return json(200, { ok: true, build: BUILD_STAMP, requestId }, baseHeaders);
  }

  if (pathname === "/__health") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);

    const classification = "infra";
    const rl = rateLimitCheck({ classification, tenantId: null, request, cfctx });
    if (!rl.ok) {
      try {
        const ctx = safeCreateCtx({
          requestId,
          session: { isAuthenticated: false, token: null, tenantId: null, actorId: null, authLevel: null },
        });
        emitAudit(
          ctx,
          {
            eventCategory: "SECURITY",
            eventType: "RATE_LIMIT",
            objectType: "http_request",
            objectId: pathname,
            decision: "DENY",
            reasonCode: "RATE_LIMITED",
            factsSnapshot: { method, path: pathname, classification, limit: rl.limit, windowSec: RL_WINDOW_SEC },
          },
          env,
          cfctx
        );
      } catch {
        // ignore
      }

      return tooManyRequests(
        baseHeaders,
        { classification, limit: rl.limit, windowSec: RL_WINDOW_SEC, retryAfterSec: Math.ceil(rl.retryAfterSec || 0) },
        rl
      );
    }

    return json(200, { ok: true }, baseHeaders);
  }

  if (pathname === "/__meta") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);

    const classification = "infra";
    const rl = rateLimitCheck({ classification, tenantId: null, request, cfctx });
    if (!rl.ok) {
      try {
        const ctx = safeCreateCtx({
          requestId,
          session: { isAuthenticated: false, token: null, tenantId: null, actorId: null, authLevel: null },
        });
        emitAudit(
          ctx,
          {
            eventCategory: "SECURITY",
            eventType: "RATE_LIMIT",
            objectType: "http_request",
            objectId: pathname,
            decision: "DENY",
            reasonCode: "RATE_LIMITED",
            factsSnapshot: { method, path: pathname, classification, limit: rl.limit, windowSec: RL_WINDOW_SEC },
          },
          env,
          cfctx
        );
      } catch {
        // ignore
      }

      return tooManyRequests(
        baseHeaders,
        { classification, limit: rl.limit, windowSec: RL_WINDOW_SEC, retryAfterSec: Math.ceil(rl.retryAfterSec || 0) },
        rl
      );
    }

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

    const classification = "infra";
    const rl = rateLimitCheck({ classification, tenantId: null, request, cfctx });
    if (!rl.ok) {
      try {
        const ctx = safeCreateCtx({
          requestId,
          session: { isAuthenticated: false, token: null, tenantId: null, actorId: null, authLevel: null },
        });
        emitAudit(
          ctx,
          {
            eventCategory: "SECURITY",
            eventType: "RATE_LIMIT",
            objectType: "http_request",
            objectId: pathname,
            decision: "DENY",
            reasonCode: "RATE_LIMITED",
            factsSnapshot: { method, path: pathname, classification, limit: rl.limit, windowSec: RL_WINDOW_SEC },
          },
          env,
          cfctx
        );
      } catch {
        // ignore
      }

      return tooManyRequests(
        baseHeaders,
        { classification, limit: rl.limit, windowSec: RL_WINDOW_SEC, retryAfterSec: Math.ceil(rl.retryAfterSec || 0) },
        rl
      );
    }

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

  // --- Classification ---
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

  // --- Rate limit enforcement ---
  // - For /api/* we enforce tenant-scoped (hard boundary).
  // - If unauthenticated, /api/* will fail-closed anyway; we do NOT attempt to infer tenant.
  // - For infra we already enforced above.
  if (pathname.startsWith("/api/")) {
    // If tenant not present, skip rate limiting (auth will deny deterministically).
    // This avoids accidental shared buckets for unauth / missing tenant.
    if (ctx?.tenantId) {
      const rl = rateLimitCheck({ classification, tenantId: ctx.tenantId, request, cfctx });
      if (!rl.ok) {
        emitAudit(
          ctx,
          {
            eventCategory: "SECURITY",
            eventType: "RATE_LIMIT",
            objectType: "http_request",
            objectId: pathname,
            decision: "DENY",
            reasonCode: "RATE_LIMITED",
            factsSnapshot: {
              method,
              path: pathname,
              classification,
              tenantId: ctx.tenantId,
              limit: rl.limit,
              windowSec: RL_WINDOW_SEC,
            },
          },
          env,
          cfctx
        );

        return tooManyRequests(
          baseHeaders,
          {
            classification,
            tenantId: ctx.tenantId,
            limit: rl.limit,
            windowSec: RL_WINDOW_SEC,
            retryAfterSec: Math.ceil(rl.retryAfterSec || 0),
          },
          rl
        );
      }

      // Attach informational headers on success (deterministic).
      // We do not modify every response object here; downstream handlers can return normally.
      // For simplicity and determinism, we keep enforcement-only at this stage.
    }
  }

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

      // U17 deterministic pagination inputs
      const beforeSeq = parseOptionalInt(sp.get("before_seq"));
      const afterSeq = parseOptionalInt(sp.get("after_seq"));
      const beforeEventId = parseOptionalString(sp.get("before_event_id"));
      const afterEventId = parseOptionalString(sp.get("after_event_id"));

      // Legacy time filters (back-compat) — filters only, never ordering keys.
      const before = sp.get("before");
      const after = sp.get("after");

      // Disallow contradictory cursor directions (deterministic).
      const hasBeforeCursor = beforeSeq !== null || beforeEventId !== null;
      const hasAfterCursor = afterSeq !== null || afterEventId !== null;
      if (hasBeforeCursor && hasAfterCursor) {
        return json(
          400,
          { error: "BAD_REQUEST", code: "BEFORE_AND_AFTER_CURSOR", details: { before_seq: beforeSeq, after_seq: afterSeq } },
          baseHeaders
        );
      }

      if (before && after) {
        return json(400, { error: "BAD_REQUEST", code: "BEFORE_AND_AFTER", details: null }, baseHeaders);
      }

      const cursorBeforeOk = validateCursorPair(beforeSeq, beforeEventId);
      if (!cursorBeforeOk.ok) {
        return json(400, { error: "BAD_REQUEST", code: "INVALID_CURSOR", details: { before_seq: sp.get("before_seq"), before_event_id: sp.get("before_event_id") } }, baseHeaders);
      }
      const cursorAfterOk = validateCursorPair(afterSeq, afterEventId);
      if (!cursorAfterOk.ok) {
        return json(400, { error: "BAD_REQUEST", code: "INVALID_CURSOR", details: { after_seq: sp.get("after_seq"), after_event_id: sp.get("after_event_id") } }, baseHeaders);
      }

      const beforeTs = before ? Date.parse(before) : null;
      const afterTs = after ? Date.parse(after) : null;
      if ((before && !Number.isFinite(beforeTs)) || (after && !Number.isFinite(afterTs))) {
        return json(400, { error: "BAD_REQUEST", code: "INVALID_TIMESTAMP", details: { before, after } }, baseHeaders);
      }

      const itemId = sp.get("itemId");

      const all = (await loadTenantCollection(env, ctx.tenantId, "ledger_events", [])) || [];
      let rows = Array.isArray(all) ? all.slice() : [];

      // Optional item filter
      if (itemId) rows = rows.filter((e) => e?.itemId === itemId);

      // Legacy timestamp filters (filters only)
      if (beforeTs !== null) rows = rows.filter((e) => Date.parse(e?.createdAtUtc) < beforeTs);
      if (afterTs !== null) rows = rows.filter((e) => Date.parse(e?.createdAtUtc) > afterTs);

      // U17 cursor filters (deterministic keys)
      rows = applyCursorFilter(rows, {
        beforeSeq: beforeSeq !== null ? beforeSeq : null,
        beforeId: beforeEventId,
        afterSeq: afterSeq !== null ? afterSeq : null,
        afterId: afterEventId,
      });

      // U17 deterministic sort by (sequence, event_id). No createdAtUtc ordering dependency.
      rows.sort((a, b) => {
        const ak = keyFromEvent(a);
        const bk = keyFromEvent(b);
        return compareLedgerKeysAsc(ak.seq, ak.id, bk.seq, bk.id);
      });

      if (order === "desc") rows.reverse();

      const page = rows.slice(0, limit);
      const last = page[page.length - 1] || null;

      const lastKey = last ? keyFromEvent(last) : null;

      // Next tokens are deterministic keys (and only emitted when there is a last row).
      const nextBeforeSeq = order === "desc" && lastKey ? lastKey.seq : null;
      const nextBeforeEventId = order === "desc" && lastKey ? lastKey.id : null;
      const nextAfterSeq = order === "asc" && lastKey ? lastKey.seq : null;
      const nextAfterEventId = order === "asc" && lastKey ? lastKey.id : null;

      // U17.4 (optional): include seq/event_id in audit factsSnapshot for traceability (no semantics).
      emitAudit(
        ctx,
        {
          eventCategory: "SYSTEM",
          eventType: "LEDGER_READ",
          objectType: "ledger_events",
          objectId: "/api/ledger/events",
          decision: "SYSTEM",
          reasonCode: "SERVED",
          factsSnapshot: {
            method,
            path: pathname,
            classification,
            tenantId: ctx?.tenantId ?? null,
            limit,
            order,
            itemId: itemId || null,
            // legacy filters
            before: before || null,
            after: after || null,
            // deterministic cursor inputs
            before_seq: beforeSeq,
            before_event_id: beforeEventId,
            after_seq: afterSeq,
            after_event_id: afterEventId,
            // deterministic cursor outputs
            nextBeforeSeq,
            nextBeforeEventId,
            nextAfterSeq,
            nextAfterEventId,
            returned: page.length,
            // last key served (useful for debugging pagination)
            lastSeq: lastKey ? lastKey.seq : null,
            lastEventId: lastKey ? lastKey.id : null,
          },
        },
        env,
        cfctx
      );

      return json(
        200,
        {
          events: page,
          page: {
            limit,
            order,
            // legacy filters (back-compat)
            before: before || null,
            after: after || null,
            itemId,
            returned: page.length,
            // U17 deterministic pagination outputs
            nextBeforeSeq,
            nextBeforeEventId,
            nextAfterSeq,
            nextAfterEventId,
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
