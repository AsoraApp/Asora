// B1 session stub.
// This simulates a resolved, server-authoritative session.
// It will be replaced by real JWT / OIDC verification.

function resolveSession(req) {
  // TEMP: hard-coded resolved session for B1 wiring
  // Replace later with token verification + tenant binding
  return {
    userId: "user_1",
    tenantId: "tenant_1",
    sessionId: "session_stub"
  };
}

module.exports = {
  resolveSession
};
