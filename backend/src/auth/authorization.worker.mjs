// backend/src/auth/authorization.worker.mjs

/**
 * U11 — Authorization & Actor Boundaries
 *
 * Deterministic, static authorization gate for backend execution paths.
 * No RBAC, no dynamic rules, no config files, fail-closed by default.
 */

const AUTH_LEVELS = new Set(["user", "service", "system", "dev"]);

/**
 * Capability map:
 * Keyed by capability name, each provides:
 * - match(reqUrl, method) => boolean
 * - allowedAuthLevels: Set<string>
 */
const CAPABILITIES = [
  {
    name: "AUTH_ME",
    match: (pathname, method) => pathname === "/v1/auth/me" && (method === "GET" || method === "HEAD"),
    allowedAuthLevels: new Set(["user", "dev"]),
  },

  // Inventory reads (UI relies on these)
  {
    name: "INVENTORY_READ",
    match: (pathname, method) =>
      pathname.startsWith("/v1/inventory/") && (method === "GET" || method === "HEAD"),
    allowedAuthLevels: new Set(["user", "service", "dev"]),
  },

  // Ledger reads (UI relies on /v1/ledger/events)
  {
    name: "LEDGER_READ",
    match: (pathname, method) => pathname.startsWith("/v1/ledger/") && (method === "GET" || method === "HEAD"),
    allowedAuthLevels: new Set(["user", "service", "dev"]),
  },

  // Ledger writes (append-only truth path)
  {
    name: "LEDGER_WRITE",
    match: (pathname, method) =>
      pathname === "/v1/ledger/events" && (method === "POST"),
    allowedAuthLevels: new Set(["service", "system", "dev"]),
  },

  // Alerts/notifications are read-only routers in this project
  {
    name: "ALERTS_READ",
    match: (pathname, method) => pathname.startsWith("/v1/alerts/") && (method === "GET" || method === "HEAD"),
    allowedAuthLevels: new Set(["user", "service", "dev"]),
  },
  {
    name: "NOTIFICATIONS_READ",
    match: (pathname, method) =>
      pathname.startsWith("/v1/notifications/") && (method === "GET" || method === "HEAD"),
    allowedAuthLevels: new Set(["user", "service", "dev"]),
  },
];

export function requireValidAuthLevelOrThrow(session) {
  const authLevel = session?.authLevel;
  if (!authLevel || !AUTH_LEVELS.has(authLevel)) {
    const e = new Error("Invalid or missing authLevel");
    e.name = "AUTHZ_INVALID_AUTH_LEVEL";
    e.details = { authLevel: authLevel ?? null };
    throw e;
  }
  return authLevel;
}

export function resolveCapabilityForRequest(req) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = (req.method || "GET").toUpperCase();

  for (const cap of CAPABILITIES) {
    if (cap.match(pathname, method)) return cap;
  }

  return null; // unknown => deny (fail-closed)
}

export function authorizeRequestOrThrow({ req, session }) {
  // Must already be authenticated at U10 layer.
  // U11 enforces explicit authLevel presence + validity and capability allow-list.
  const authLevel = requireValidAuthLevelOrThrow(session);

  const cap = resolveCapabilityForRequest(req);
  if (!cap) {
    const e = new Error("No matching capability for request");
    e.name = "AUTHZ_NO_CAPABILITY";
    e.details = { method: req.method, route: new URL(req.url).pathname };
    throw e;
  }

  if (!cap.allowedAuthLevels.has(authLevel)) {
    const e = new Error("Actor not allowed for capability");
    e.name = "AUTHZ_DENIED";
    e.details = {
      capability: cap.name,
      authLevel,
      method: req.method,
      route: new URL(req.url).pathname,
    };
    throw e;
  }

  return { capability: cap.name, authLevel };
}

/**
 * Deterministic error envelope for authz failures.
 */
export function authzErrorEnvelope(err) {
  const code =
    err?.name === "AUTHZ_INVALID_AUTH_LEVEL"
      ? "AUTHZ_INVALID_AUTH_LEVEL"
      : err?.name === "AUTHZ_NO_CAPABILITY"
        ? "AUTHZ_NO_CAPABILITY"
        : err?.name === "AUTHZ_DENIED"
          ? "AUTHZ_DENIED"
          : "AUTHZ_DENIED";

  return {
    error: "FORBIDDEN",
    code,
    details: err?.details ?? null,
  };
}

export function authzDenialReason(err) {
  // Single deterministic string reason for audit (no stack traces)
  if (!err?.name) return "AUTHZ_DENIED";
  return err.name;
}
