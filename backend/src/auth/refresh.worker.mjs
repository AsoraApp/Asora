// backend/src/auth/refresh.worker.mjs
// U20: Refresh-token session store + rotation (tenant-scoped).
// - Refresh token stored as HttpOnly cookie on Pages origin (via /api proxy)
// - Opaque token in cookie; SHA-256 hashed in KV-backed tenant collection
// - Rotation on every refresh (invalidate prior token)
// - Deterministic error codes

import { loadTenantCollection, saveTenantCollection } from "../storage/jsonStore.worker.mjs";
import { mintAccessToken, sha256Hex, randomUrlSafeString, nowUtcSeconds } from "./token.worker.mjs";

const COOKIE_NAME = "asora_rt";
const COLLECTION = "sessions.json";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function parseCookies(request) {
  const raw = request?.headers?.get?.("Cookie") || request?.headers?.get?.("cookie") || "";
  const out = {};
  const parts = String(raw).split(";");
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    const idx = s.indexOf("=");
    if (idx <= 0) continue;
    const k = s.slice(0, idx).trim();
    const v = s.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

function setCookie(headers, { name, value, maxAgeSec }) {
  // Strict cookie baseline
  const parts = [];
  parts.push(`${name}=${value}`);
  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push("Secure");
  parts.push("SameSite=Strict");
  if (Number.isFinite(maxAgeSec)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`);
  headers.append("Set-Cookie", parts.join("; "));
}

function clearCookie(headers, name) {
  const parts = [];
  parts.push(`${name}=`);
  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push("Secure");
  parts.push("SameSite=Strict");
  parts.push("Max-Age=0");
  headers.append("Set-Cookie", parts.join("; "));
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function nowMs() {
  return Date.now();
}

function newRefreshToken() {
  // 32 bytes url-safe
  return randomUrlSafeString(32);
}

export async function issueInitialSession(env, tenantId, actorId, authLevel, baseHeaders) {
  // Create session record + refresh cookie + access token
  const refreshPlain = newRefreshToken();
  const refreshHash = await sha256Hex(refreshPlain);

  const now = nowUtcSeconds();
  const refreshTtlSec = 14 * 24 * 60 * 60; // 14 days

  const sessions = safeArray(await loadTenantCollection(env, tenantId, COLLECTION, []));
  // Store minimal record; revoke by deleting/marking revoked.
  sessions.push({
    v: 1,
    refreshHash,
    actorId,
    authLevel,
    createdAtUtc: new Date(nowMs()).toISOString(),
    expiresAtUtc: new Date((now + refreshTtlSec) * 1000).toISOString(),
    revokedAtUtc: null,
    rotatedToHash: null,
    lastSeenAtUtc: null,
  });

  await saveTenantCollection(env, tenantId, COLLECTION, sessions);

  const access = await mintAccessToken(env, { tenantId, actorId, authLevel }, 600);

  const h = new Headers(baseHeaders || {});
  setCookie(h, { name: COOKIE_NAME, value: refreshPlain, maxAgeSec: refreshTtlSec });

  return new Response(JSON.stringify({ ok: true, accessToken: access, tenantId, actorId, authLevel }), {
    status: 200,
    headers: (() => {
      h.set("Content-Type", "application/json; charset=utf-8");
      return h;
    })(),
  });
}

export async function refreshSessionFromCookie(env, request, baseHeaders) {
  const cookies = parseCookies(request);
  const refreshPlain = cookies[COOKIE_NAME] ? String(cookies[COOKIE_NAME]) : "";
  if (!refreshPlain) {
    return json(401, { error: "UNAUTHORIZED", code: "REFRESH_REQUIRED", details: null }, baseHeaders);
  }

  const refreshHash = await sha256Hex(refreshPlain);

  // We do not know tenantId from the cookie. Enterprise-grade requires tenant binding.
  // We bind the refresh token to a tenant by embedding tenantId in the cookie? We intentionally do NOT.
  // Therefore, for now, we require a header "X-Tenant-Id" ONLY for refresh, set by UI after /auth/me.
  // BUT: your requirement is fail-closed + tenant-correct. So we enforce: the caller must include
  // X-Asora-Tenant and we only look up within that tenant.
  const tenantId = request?.headers?.get?.("X-Asora-Tenant") || request?.headers?.get?.("x-asora-tenant") || "";
  const t = String(tenantId).trim();
  if (!t) {
    return json(400, { error: "BAD_REQUEST", code: "TENANT_HEADER_REQUIRED", details: { header: "X-Asora-Tenant" } }, baseHeaders);
  }

  const sessions = safeArray(await loadTenantCollection(env, t, COLLECTION, []));
  const idx = sessions.findIndex((s) => s && s.refreshHash === refreshHash);
  if (idx === -1) {
    return json(401, { error: "UNAUTHORIZED", code: "REFRESH_INVALID", details: null }, baseHeaders);
  }

  const rec = sessions[idx];
  if (rec.revokedAtUtc) {
    return json(401, { error: "UNAUTHORIZED", code: "REFRESH_REVOKED", details: null }, baseHeaders);
  }

  const now = nowUtcSeconds();
  const expMs = Date.parse(rec.expiresAtUtc || "");
  if (!Number.isFinite(expMs) || expMs <= now * 1000) {
    return json(401, { error: "UNAUTHORIZED", code: "REFRESH_EXPIRED", details: null }, baseHeaders);
  }

  // Rotate
  const nextPlain = newRefreshToken();
  const nextHash = await sha256Hex(nextPlain);

  rec.revokedAtUtc = new Date(nowMs()).toISOString();
  rec.rotatedToHash = nextHash;

  sessions.push({
    v: 1,
    refreshHash: nextHash,
    actorId: rec.actorId,
    authLevel: rec.authLevel,
    createdAtUtc: new Date(nowMs()).toISOString(),
    expiresAtUtc: rec.expiresAtUtc,
    revokedAtUtc: null,
    rotatedToHash: null,
    lastSeenAtUtc: new Date(nowMs()).toISOString(),
  });

  await saveTenantCollection(env, t, COLLECTION, sessions);

  const access = await mintAccessToken(env, { tenantId: t, actorId: rec.actorId, authLevel: rec.authLevel }, 600);

  const h = new Headers(baseHeaders || {});
  // Remaining TTL based on original expiry
  const remainingSec = Math.max(0, Math.floor(expMs / 1000 - now));
  setCookie(h, { name: COOKIE_NAME, value: nextPlain, maxAgeSec: remainingSec });

  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ ok: true, accessToken: access, tenantId: t, actorId: rec.actorId, authLevel: rec.authLevel }), {
    status: 200,
    headers: h,
  });
}

export async function logoutSession(env, request, ctx, baseHeaders) {
  const tenantId = ctx?.tenantId || null;
  const cookies = parseCookies(request);
  const refreshPlain = cookies[COOKIE_NAME] ? String(cookies[COOKIE_NAME]) : "";
  const h = new Headers(baseHeaders || {});
  clearCookie(h, COOKIE_NAME);

  if (!tenantId || !refreshPlain) {
    h.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
  }

  const refreshHash = await sha256Hex(refreshPlain);
  const sessions = safeArray(await loadTenantCollection(env, tenantId, COLLECTION, []));
  const idx = sessions.findIndex((s) => s && s.refreshHash === refreshHash);
  if (idx !== -1) {
    sessions[idx].revokedAtUtc = new Date(nowMs()).toISOString();
    await saveTenantCollection(env, tenantId, COLLECTION, sessions);
  }

  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
}
