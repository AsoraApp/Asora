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

import {
  authorizeRequestOrThrow,
  authzErrorEnvelope,
  authzDenialReason,
} from "../auth/authorization.worker.mjs";

const BUILD_STAMP = "u11-authorization-2025-12-20T00:00Z"; // CHANGE THIS ON EACH DEPLOY

function json(statusCode, body, headersObj) {
  const h = new Headers(headersObj || {});
  h.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function isPublicPath(pathname) {
  // U10 preserved: / and /__build are public
  return pathname === "/" || pathname === "/__build";
}

function isV1Path(pathname) {
  return pathname.startsWith("/v1/");
}

function safePath(req) {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "";
  }
}

export async function handleFetch(req, env, ctx) {
  const requestId = getOrCreateRequestIdFromHeaders(req.headers);
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Public routes (no auth, no tenant)
  if (isPublicPath(pathname)) {
    if (pathname === "/__build") return json(200, { ok: true, build: BUILD_STAMP, requestId });
    return new Response("ok", { status: 200 });
  }

  // All /v1/* must be authenticated (U10)
  const session = await resolveSessionFromHeaders(req, env);

  const rctx = createRequestContext({
    requestId,
    now: new Date().toISOString(),
    session,
  });

  // Emit a base audit for every authenticated request (U10 behavior)
  // (If your emitAudit already happens elsewhere, keeping this is fine—duplicate audits are undesirable,
  // but better than missing; if you already emit elsewhere, remove one copy.)
  try {
    await emitAudit(env, {
      type: "http.request",
      requestId,
      tenantId: session?.tenantId ?? null,
      actorId: session?.actorId ?? null,
      authLevel: session?.authLevel ?? null,
      method: (req.method || "GET").toUpperCase(),
      route: safePath(req),
      ok: true,
      at: rctx.now,
      details: null,
    });
  } catch {
    // Observability must never break execution paths
  }

  // U11: Authorization gate for ALL /v1/* execution paths
  if (isV1Path(pathname)) {
    try {
      authorizeRequestOrThrow({ req, session });
    } catch (err) {
      // Deterministic denial + audit
      try {
        await emitAudit(env, {
          type: "authz.denied",
          requestId,
          tenantId: session?.tenantId ?? null,
          actorId: session?.actorId ?? null,
          authLevel: session?.authLevel ?? null,
          method: (req.method || "GET").toUpperCase(),
          route: safePath(req),
          ok: false,
          at: rctx.now,
          details: {
            reason: authzDenialReason(err),
            envelope: authzErrorEnvelope(err),
          },
        });
      } catch {
        // never throw from audit
      }

      return json(403, authzErrorEnvelope(err), { "x-request-id": requestId });
    }
  }

  // Tenant-scoped storage access (U10+)
  // loadTenantCollection may assume tenantId exists; U10 guarantees authenticated sessions always include tenantId.
  const tenant = await loadTenantCollection(env, session.tenantId);

  // Route dispatch (NO new endpoints in U11)
  // Auth
  if (pathname === "/v1/auth/me") {
    return authMeFetch(req, env, rctx);
  }

  // Ledger read routes likely live elsewhere in your repo; keep existing behavior.
  // Ledger write: POST /v1/ledger/events
  if (pathname === "/v1/ledger/events" && (req.method || "GET").toUpperCase() === "POST") {
    return writeLedgerEventFromJson(req, env, rctx, tenant);
  }

  // Alerts / Notifications routers
  if (pathname.startsWith("/v1/alerts/")) {
    return alertsFetchRouter(req, env, rctx, tenant);
  }
  if (pathname.startsWith("/v1/notifications/")) {
    return notificationsFetchRouter(req, env, rctx, tenant);
  }

  // Fallthrough: no invented endpoints
  return json(
    404,
    { error: "NOT_FOUND", code: "NOT_FOUND", details: { route: pathname } },
    { "x-request-id": requestId },
  );
}
