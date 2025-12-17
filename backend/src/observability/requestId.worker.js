function getOrCreateRequestIdFromHeaders(headers) {
  const existing = headers.get("x-request-id") || headers.get("X-Request-Id");
  if (existing && typeof existing === "string") return existing;
  // deterministic-enough for now (Worker has crypto)
  return crypto.randomUUID();
}

module.exports = { getOrCreateRequestIdFromHeaders };
