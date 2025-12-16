function createRequestContext({ requestId, userId, tenantId }) {
  return {
    requestId,
    userId,
    tenantId,
    nowUtc: new Date().toISOString()
  };
}

module.exports = {
  createRequestContext
};
