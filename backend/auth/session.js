const { getTenantMemberships } = require("./memberships");

// B1 session resolution (server-authoritative, fail-closed)
function resolveSession(req) {
  // TEMP: fixed user identity until real auth is wired
  const userId = "user_1";

  const memberships = getTenantMemberships(userId);

  if (memberships.length === 0) {
    return {
      error: "TENANT_UNRESOLVED",
      status: 403
    };
  }

  if (memberships.length > 1) {
    return {
      error: "TENANT_AMBIGUOUS",
      status: 409
    };
  }

  return {
    userId,
    tenantId: memberships[0],
    sessionId: "session_stub"
  };
}

module.exports = {
  resolveSession
};
