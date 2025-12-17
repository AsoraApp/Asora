function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

export function authMeFetch(ctx, baseHeaders) {
  return json(
    200,
    {
      ok: true,
      tenantId: ctx?.tenantId ?? null,
      userId: ctx?.userId ?? null,
      requestId: ctx?.requestId ?? null
    },
    baseHeaders
  );
}
