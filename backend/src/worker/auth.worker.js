function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function authMeFetch(ctx, baseHeaders) {
  // Whatever your requestContext derived:
  return json(200, {
    ok: true,
    tenantId: ctx.tenantId || null,
    userId: ctx.userId || null,
    requestId: ctx.requestId || null
  }, baseHeaders);
}

module.exports = { authMeFetch };
