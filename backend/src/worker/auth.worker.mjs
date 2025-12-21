// backend/src/worker/auth.worker.mjs

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

/**
 * GET /api/auth/me
 * - Read-only
 * - Returns authenticated session identity in a stable shape
 * - No side effects
 */
export function authMeFetch(ctx, baseHeaders) {
  const s = ctx?.session || null;

  return json(
    200,
    {
      ok: true,
      tenantId: ctx?.tenantId ?? null,
      actorId: s?.actorId ?? null,
      authLevel: s?.authLevel ?? null,
      deprecated: s?.deprecated === true,
      deprecatedReason: s?.deprecatedReason ?? null,
      requestId: ctx?.requestId ?? null,
    },
    baseHeaders
  );
}
