// backend/src/auth/roleCheck.mjs

export function requireRole(session, allowedRoles = []) {
  if (!session) return false;
  return allowedRoles.includes(session.claims?.role);
}
