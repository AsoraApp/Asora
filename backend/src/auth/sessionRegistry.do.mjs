// backend/src/auth/sessionRegistry.do.mjs
// Durable Object: Session + refresh token registry.
// Enterprise requirement: refresh rotation + revocation MUST be durable and consistent.

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function json(status, body, headersObj) {
  const h = new Headers(headersObj || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: h });
}

function badRequest(code, details) {
  return json(400, { error: "BAD_REQUEST", code, details: details || null });
}

function forbidden(code, details) {
  return json(403, { error: "FORBIDDEN", code, details: details || null });
}

function ok(body) {
  return json(200, body);
}

/**
 * Storage keys:
 * - rt:<token> -> { tenantId, actorId, authLevel, issuedAt, expiresAt, rotatedFrom, revokedAt }
 * - userSessions:<tenantId>:<actorId> -> [token,...] (for revoke-all, listing)
 */
export class SessionRegistryDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const u = new URL(request.url);
    const path = u.pathname;

    if (request.method !== "POST") {
      return badRequest("METHOD_NOT_ALLOWED", { method: request.method });
    }

    let body = null;
    try {
      const t = await request.text();
      body = t ? JSON.parse(t) : null;
    } catch {
      return badRequest("INVALID_JSON", null);
    }

    // Simple shared-secret auth between Worker and DO
    const internalKey = String(this.env?.AUTH_SECRET || "").trim();
    const provided = String(request.headers.get("X-Asora-Internal") || "").trim();
    if (!internalKey || provided !== internalKey) {
      return forbidden("INTERNAL_AUTH_REQUIRED", null);
    }

    if (path === "/issue") return this.issue(body);
    if (path === "/rotate") return this.rotate(body);
    if (path === "/revoke") return this.revoke(body);
    if (path === "/revokeAll") return this.revokeAll(body);
    if (path === "/validate") return this.validate(body);

    return badRequest("ROUTE_NOT_FOUND", { path });
  }

  async issue(body) {
    const { refreshToken, tenantId, actorId, authLevel, ttlSec } = body || {};
    if (!refreshToken || !tenantId || !actorId || !authLevel) {
      return badRequest("MISSING_FIELDS", { refreshToken: !!refreshToken, tenantId: !!tenantId, actorId: !!actorId, authLevel: !!authLevel });
    }

    const now = nowSec();
    const ttl = Number.isFinite(ttlSec) ? Math.max(60, Math.floor(ttlSec)) : 1209600;
    const expiresAt = now + ttl;

    const key = `rt:${refreshToken}`;
    const record = { tenantId, actorId, authLevel, issuedAt: now, expiresAt, rotatedFrom: null, revokedAt: null };

    await this.state.storage.put(key, record);

    const indexKey = `userSessions:${tenantId}:${actorId}`;
    const existing = (await this.state.storage.get(indexKey)) || [];
    const next = Array.isArray(existing) ? existing.slice() : [];
    next.push(refreshToken);
    await this.state.storage.put(indexKey, next);

    return ok({ ok: true, expiresAt });
  }

  async rotate(body) {
    const { oldToken, newToken, ttlSec } = body || {};
    if (!oldToken || !newToken) return badRequest("MISSING_FIELDS", { oldToken: !!oldToken, newToken: !!newToken });

    const now = nowSec();
    const oldKey = `rt:${oldToken}`;
    const oldRec = await this.state.storage.get(oldKey);
    if (!oldRec) return forbidden("REFRESH_NOT_FOUND", null);

    if (oldRec.revokedAt) return forbidden("REFRESH_REVOKED", { revokedAt: oldRec.revokedAt });
    if (oldRec.expiresAt <= now) return forbidden("REFRESH_EXPIRED", { expiresAt: oldRec.expiresAt, now });

    // revoke old
    oldRec.revokedAt = now;
    await this.state.storage.put(oldKey, oldRec);

    // issue new with same identity
    const ttl = Number.isFinite(ttlSec) ? Math.max(60, Math.floor(ttlSec)) : Math.max(60, oldRec.expiresAt - now);
    const expiresAt = now + ttl;

    const newKey = `rt:${newToken}`;
    const newRec = {
      tenantId: oldRec.tenantId,
      actorId: oldRec.actorId,
      authLevel: oldRec.authLevel,
      issuedAt: now,
      expiresAt,
      rotatedFrom: oldToken,
      revokedAt: null,
    };
    await this.state.storage.put(newKey, newRec);

    const indexKey = `userSessions:${oldRec.tenantId}:${oldRec.actorId}`;
    const existing = (await this.state.storage.get(indexKey)) || [];
    const next = Array.isArray(existing) ? existing.slice() : [];
    next.push(newToken);
    await this.state.storage.put(indexKey, next);

    return ok({ ok: true, tenantId: oldRec.tenantId, actorId: oldRec.actorId, authLevel: oldRec.authLevel, expiresAt });
  }

  async validate(body) {
    const { refreshToken } = body || {};
    if (!refreshToken) return badRequest("MISSING_FIELDS", { refreshToken: false });

    const now = nowSec();
    const key = `rt:${refreshToken}`;
    const rec = await this.state.storage.get(key);
    if (!rec) return ok({ ok: false, code: "REFRESH_NOT_FOUND" });
    if (rec.revokedAt) return ok({ ok: false, code: "REFRESH_REVOKED", revokedAt: rec.revokedAt });
    if (rec.expiresAt <= now) return ok({ ok: false, code: "REFRESH_EXPIRED", expiresAt: rec.expiresAt, now });

    return ok({ ok: true, tenantId: rec.tenantId, actorId: rec.actorId, authLevel: rec.authLevel, expiresAt: rec.expiresAt });
  }

  async revoke(body) {
    const { refreshToken } = body || {};
    if (!refreshToken) return badRequest("MISSING_FIELDS", { refreshToken: false });

    const key = `rt:${refreshToken}`;
    const rec = await this.state.storage.get(key);
    if (!rec) return ok({ ok: true }); // idempotent

    rec.revokedAt = nowSec();
    await this.state.storage.put(key, rec);
    return ok({ ok: true });
  }

  async revokeAll(body) {
    const { tenantId, actorId } = body || {};
    if (!tenantId || !actorId) return badRequest("MISSING_FIELDS", { tenantId: !!tenantId, actorId: !!actorId });

    const indexKey = `userSessions:${tenantId}:${actorId}`;
    const tokens = (await this.state.storage.get(indexKey)) || [];
    const list = Array.isArray(tokens) ? tokens : [];

    const now = nowSec();
    for (const t of list) {
      const key = `rt:${t}`;
      const rec = await this.state.storage.get(key);
      if (rec && !rec.revokedAt) {
        rec.revokedAt = now;
        await this.state.storage.put(key, rec);
      }
    }

    return ok({ ok: true, revoked: list.length });
  }
}
