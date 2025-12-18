// backend/src/index.worker.mjs
import { getOrCreateRequestIdFromHeaders } from "./observability/requestId.worker.mjs";
import { resolveSessionFromHeaders } from "./auth/session.worker.mjs";
import { createRequestContext } from "./domain/requestContext.worker.mjs";
import { emitAudit } from "./observability/audit.mjs";

import { authMeFetch } from "./api/auth.worker.mjs";
import { writeLedgerEventFromJson } from "./ledger/ledger.write.worker.mjs";
import { alertsFetchRouter } from "./api/alerts.worker.mjs";
import { notificationsFetchRouter } from "./api/notifications.worker.mjs";
import { integrationsFetchRouter } from "./api/integrations.worker.mjs";

const BUILD_STAMP = "b14-integrations-additive-observers-2025-12-18T00:00Z"; // change this string on each deploy attempt

function json(statusCode, body, headersObj) {
  const h = new Headers(headersObj || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function routePath(url) {
  const u = new URL(url);
  return u.pathname || "/";
}

export default {
  async fetch(request, env, cfctx) {
    const requestId = getOrCreateRequestIdFromHeaders(request.headers);
    const baseHeaders = { "x-request-id": requestId };

    const session = await resolveSessionFromHeaders(request.headers, env, cfctx);
    const ctx = createRequestContext({ requestId, session, env });

    // Minimal request audit (no secrets)
    try {
      emitAudit(ctx, "http.request", { method: request.method, path: routePath(request.url), build: BUILD_STAMP }, cfctx);
    } catch {
      // fail-closed behavior happens in downstream guards; do not throw here
    }

    const path = routePath(request.url);

    // Health
    if (path === "/api/health") return json(200, { ok: true, build: BUILD_STAMP, requestId }, baseHeaders);

    // Auth
    if (path === "/api/auth/me") return authMeFetch(ctx, request, baseHeaders, cfctx);

    // Ledger (authoritative truth)
    if (path === "/api/ledger/write") {
      const input = await request.json().catch(() => "__INVALID_JSON__");
      if (input === "__INVALID_JSON__") return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);
      return writeLedgerEventFromJson(ctx, input, baseHeaders, cfctx);
    }

    // Alerts / notifications
    if (path.startsWith("/api/alerts")) return alertsFetchRouter(ctx, request, baseHeaders, cfctx);
    if (path.startsWith("/api/notifications")) return notificationsFetchRouter(ctx, request, baseHeaders, cfctx);

    // Integrations (strictly additive observers)
    if (path.startsWith("/api/integrations")) return integrationsFetchRouter(ctx, request, baseHeaders, cfctx);

    return json(404, { error: "NOT_FOUND", code: "ROUTE_NOT_FOUND" }, baseHeaders);
  },
};
