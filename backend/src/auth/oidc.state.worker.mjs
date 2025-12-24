// backend/src/auth/oidc.state.worker.mjs

export function makeState(value) {
  return crypto.randomUUID() + "." + value;
}

export function parseState(state) {
  if (!state || typeof state !== "string") return null;
  const parts = state.split(".");
  if (parts.length < 2) return null;
  return parts.slice(1).join(".");
}
