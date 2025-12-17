export function getOrCreateRequestIdFromHeaders(headers) {
  const existing = headers.get("x-request-id") || headers.get("X-Request-Id");
  if (existing && typeof existing === "string") return existing;
  return crypto.randomUUID();
}
