// backend/src/worker/auth.exchange.worker.mjs
//
// U14-B1: dev_token -> Bearer exchange endpoint handler
// Route: POST /api/auth/dev/exchange
//
// Accepts dev_token via:
//  1) Query param: ?dev_token=tenant:demo
//  2) JSON body: { "dev_token": "tenant:demo" }
//
// Deterministic behavior + fail-closed error codes.
// Emits audit on success/failure.

import { parseDevTokenTenantId } from "../auth/devTokenCompat.worker.mjs";
import { nowUtcSeconds, signSessionToken } from "../auth/token.worker.mjs";
import { emitAudit } from "../observability/audit.worker.mjs";

const TTL_SECONDS = 60 * 60 * 12; // 12 hours (fixed)

function json(statusCode, body, headersObj) {
  const h = new Headers(headersObj || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

async function readJsonBody(request) {
  // Deterministic invalid-json detection consistent with handleFetch.mjs pattern.
  const text = await request.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return "__INVALID_JSON__";
  }
}

function pickDevTokenFromRequest(urlObj, bodyObj) {
  // Deterministic precedence:
  // - If query has dev_token, it wins.
  // - Else, use body.dev_token when present.
  const q = urlObj?.searchParams?.get("dev_token");
  if (q) return String(q);

  if (bodyObj && typeof bodyObj === "object") {
    const v = bodyObj.dev_token;
    if (typeof v === "string" && v.trim()) return v;
  }

  return "";
}

function emitExchangeAudit(ctx, env, cfctx, evt) {
  // Facts snapshot required by U14 spec:
  // - tenantId (if resolved)
  // - reasonCode
  // - authLevel
  // - route
  emitAudit(
    ctx,
    {
      eventCategory: "SECURITY",
      eventType: evt.eventType,
      objectType: "auth",
      objectId: "/api/auth/dev/exchange",
      decision: evt.decision,
      reasonCode: evt.reasonCode,
      factsSnapshot: {
        tenantId: evt.tenantId || null,
        reasonCode: evt.reasonCode,
        authLevel: evt.authLevel || null,
        route: "/api/auth/dev/exchange",
        method: "POST",
      },
    },
    env,
    cfctx
  );
}

/**
 * Handler: POST /api/auth/dev/exchange
 *
 * Signature required by U14 command:
 *   authDevExchangeFetch(ctx, request, baseHeaders, cfctx, env)
 */
export async function authDevExchangeFetch(ctx, request, baseHeaders, cfctx, env) {
  const u = new URL(request.url);

  if (!env?.AUTH_SECRET) {
    emitExchangeAudit(ctx, env, cfctx, {
      eventType: "AUTH_DEV_EXCHANGE_FAILED",
      decision: "DENY",
      reasonCode: "AUTH_SECRET_MISSING",
      tenantId: null,
      authLevel: null,
    });
    return json(
      500,
      { error: "INTERNAL_ERROR", code: "AUTH_SECRET_MISSING", details: null },
      baseHeaders
    );
  }

  // Parse dev_token from query OR JSON body.
  const body = await readJsonBody(request);
  if (body === "__INVALID_JSON__") {
    emitExchangeAudit(ctx, env, cfctx, {
      eventType: "AUTH_DEV_EXCHANGE_FAILED",
      decision: "DENY",
      reasonCode: "INVALID_JSON",
      tenantId: null,
      authLevel: null,
    });
    return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, baseHeaders);
  }

  const devTokenRaw = pickDevTokenFromRequest(u, body);
  if (!devTokenRaw) {
    emitExchangeAudit(ctx, env, cfctx, {
      eventType: "AUTH_DEV_EXCHANGE_FAILED",
      decision: "DENY",
      reasonCode: "MISSING_DEV_TOKEN",
      tenantId: null,
      authLevel: null,
    });
    return json(
      400,
      { error: "BAD_REQUEST", code: "MISSING_DEV_TOKEN", details: null },
      baseHeaders
    );
  }

  const tenantId = parseDevTokenTenantId(devTokenRaw);
  if (!tenantId) {
    emitExchangeAudit(ctx, env, cfctx, {
      eventType: "AUTH_DEV_EXCHANGE_FAILED",
      decision: "DENY",
      reasonCode: "AUTH_DEV_TOKEN_INVALID",
      tenantId: null,
      authLevel: null,
    });
    return json(
      401,
      { error: "UNAUTHORIZED", code: "AUTH_DEV_TOKEN_INVALID", details: null },
      baseHeaders
    );
  }

  const iat = nowUtcSeconds();
  const exp = iat + TTL_SECONDS;

  const sessionPayload = {
    v: 1,
    tenantId,
    actorId: "dev_token:exchange",
    authLevel: "dev",
    iat,
    exp,
  };

  let token;
  try {
    token = await signSessionToken(env, sessionPayload);
  } catch (e) {
    const code = String(e?.message || "");
    if (code === "AUTH_SECRET_MISSING") {
      emitExchangeAudit(ctx, env, cfctx, {
        eventType: "AUTH_DEV_EXCHANGE_FAILED",
        decision: "DENY",
        reasonCode: "AUTH_SECRET_MISSING",
        tenantId,
        authLevel: "dev",
      });
      return json(
        500,
        { error: "INTERNAL_ERROR", code: "AUTH_SECRET_MISSING", details: null },
        baseHeaders
      );
    }

    emitExchangeAudit(ctx, env, cfctx, {
      eventType: "AUTH_DEV_EXCHANGE_FAILED",
      decision: "DENY",
      reasonCode: "UNHANDLED_EXCEPTION",
      tenantId,
      authLevel: "dev",
    });
    return json(
      500,
      { error: "INTERNAL_ERROR", code: "UNHANDLED_EXCEPTION", details: null },
      baseHeaders
    );
  }

  emitExchangeAudit(ctx, env, cfctx, {
    eventType: "AUTH_DEV_EXCHANGE_SUCCESS",
    decision: "ALLOW",
    reasonCode: "OK",
    tenantId,
    authLevel: "dev",
  });

  return json(
    200,
    {
      ok: true,
      token_type: "Bearer",
      access_token: token,
      session: sessionPayload,
    },
    baseHeaders
  );
}
