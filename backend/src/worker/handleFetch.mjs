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

const BUILD_STAMP = "u13-enterprise-hardening-2025-12-21T12:30Z";

/* ------------------------- helpers ------------------------- */

function json(statusCode, body, headersObj) {
  const h = new Headers(headersObj || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
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
  return json(
    405,
    { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED", details: null },
    baseHeaders
  );
}

function notFound(baseHeaders) {
  return json(
    404,
    { error: "NOT_FOUND", code: "ROUTE_NOT_FOUND", details: null },
    baseHeaders
  );
}

function requireAuth(ctx, baseHeaders) {
  if (!ctx || !ctx.session || ctx.session.isAuthenticated !== true) {
    return json(
      401,
      { error: "UNAUTHORIZED", code: "AUTH_REQUIRED", details: null },
      baseHeaders
    );
  }
  if (!ctx.tenantId) {
    return json(
      403,
      { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null },
      baseHeaders
    );
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
  return !!(
    ctx &&
    ctx.session &&
    ctx.session.isAuthenticated === true &&
    ctx.tenantId
  );
}

function safeCreateCtx({ requestId, session }) {
  try {
    const c = createRequestContext({ requestId, session });
    const tenantId = c?.tenantId || session?.tenantId || null;
    return { ...(c || {}), requestId, session, tenantId };
  } catch {
    return {
      requestId,
      session: session || {
        isAuthenticated: false,
        token: null,
        tenantId: null,
        authLevel: null,
      },
      tenantId: session?.tenantId || null,
    };
  }
}

/* ------------------------- classification ------------------------- */

function classifyRequest(pathname, method) {
  if (
    pathname === "/__build" ||
    pathname === "/__meta" ||
    pathname === "/__health"
  ) {
    return "infra";
  }
  if (method === "GET") return "read";
  return "write";
}

/* ------------------------- handler ------------------------- */

export async function handleFetch(request, env, cfctx) {
  const u = new URL(request.url);
  const rawPath = parsePath(u.pathname);
  const pathname = normalizePath(rawPath);
  const method = (request.method || "GET").toUpperCase();

  const requestId = getOrCreateRequestIdFromHeaders(request.headers);
  const baseHeaders = { "X-Request-Id": requestId };

  /* -------- infra (public, no auth) -------- */

  if (pathname === "/__build") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(
      200,
      { ok: true, build: BUILD_STAMP, requestId },
      baseHeaders
    );
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
        service: "asora",
        build: BUILD_STAMP,
        runtime: "cloudflare-worker",
        region: cfctx?.colo || null,
        env: env?.ENV || "production",
        requestId,
      },
      baseHeaders
    );
  }

  if (pathname === "/") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    return json(
      200,
      {
        ok: true,
        service: "asora",
        runtime: "cloudflare-worker",
        requestId,
      },
      baseHeaders
    );
  }

  /* -------- auth / context -------- */

  const session = resolveSessionFromHeaders(request.headers, u);
  const ctx = safeCreateCtx({ requestId, session });

  const classification = classifyRequest(pathname, method);

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

  /* -------- auth endpoint -------- */

  if (pathname === "/api/auth/me") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);

    const denied = requireAuth(ctx, baseHeaders);
    if (denied) return denied;

    return authMeFetch(ctx, baseHeaders);
  }

  /* -------- all /api require auth -------- */

  if (pathname.startsWith("/api/")) {
    const denied = requireAuth(ctx, baseHeaders);
    if (denied) return denied;
  }

  /* -------- audit read (U13) -------- */

  if (pathname === "/api/audit/events") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);

    const events =
      (await loadTenantCollection(env, ctx.tenantId, "audit_events", [])) ||
      [];

    const rows = Array.isArray(events) ? events.slice() : [];

    rows.sort((a, b) => {
      const at = String(a?.createdAtUtc ?? "");
      const bt = String(b?.createdAtUtc ?? "");
      return at < bt ? 1 : at > bt ? -1 : 0;
    });

    return json(200, { events: rows }, baseHeaders);
  }

  /* -------- inventory reads -------- */

  if (pathname === "/api/inventory/items") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const items = await loadTenantCollection(env, ctx.tenantId, "items.json", []);
    return json(200, { items: Array.isArray(items) ? items : [] }, baseHeaders);
  }

  if (pathname === "/api/inventory/categories") {
    if (method !== "GET") return methodNotAllowed(baseHeaders);
    const categories = await loadTenantCollection(
      env,
      ctx.tenantId,
      "categories.json",
      []
    );
    return json(
      200,
      { categories: Array.isArray(categories) ? categories : [] },
      baseHeaders
    );
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
    const vendors = await loadTenantCollection(
      env,
      ctx.tenantId,
      "vendors.json",
      []
    );
    return json(
      200,
      { vendors: Array.isArray(vendors) ? vendors : [] },
      baseHeaders
    );
  }

  /* -------- ledger -------- */

  if (pathname === "/api/ledger/events") {
    if (method === "GET") {
      const sp = u.searchParams;
      const limit = Number(sp.get("limit") || 500);

      if (!Number.isInteger(limit) || limit <= 0 || limit > 2000) {
        return json(
          400,
          { error: "BAD_REQUEST", code: "INVALID_LIMIT", details: null },
          baseHeaders
        );
      }

      const all =
        (await loadTenantCollection(
          env,
          ctx.tenantId,
          "ledger_events",
          []
        )) || [];

      const rows = Array.isArray(all) ? all.slice() : [];

      rows.sort((a, b) => {
        const at = String(a?.createdAtUtc ?? "");
        const bt = String(b?.createdAtUtc ?? "");
        return at < bt ? 1 : at > bt ? -1 : 0;
      });

      return json(
        200,
        { events: rows.slice(0, limit) },
        baseHeaders
      );
    }

    if (method === "POST") {
      if (ctx?.session?.authLevel !== "dev") {
        return json(
          403,
          { error: "FORBIDDEN", code: "AUTHZ_DENIED", details: null },
          baseHeaders
        );
      }

      const body = await readJson(request);
      if (body === "__INVALID_JSON__") {
        return json(
          400,
          { error: "BAD_REQUEST", code: "INVALID_JSON", details: null },
          baseHeaders
        );
      }

      return writeLedgerEventFromJson(ctx, body, baseHeaders, cfctx, env);
    }

    return methodNotAllowed(baseHeaders);
  }

  /* -------- routers -------- */

  {
    const r = await alertsFetchRouter(ctx, request, baseHeaders, cfctx, env);
    if (r) return r;
  }

  {
    const r = await notificationsFetchRouter(
      ctx,
      request,
      baseHeaders,
      cfctx,
      env
    );
    if (r) return r;
  }

  /* -------- fallthrough -------- */

  return notFound(baseHeaders);
}
