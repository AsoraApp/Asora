// backend/src/api/cycleCounts.js
//
// Raw HTTP router (NOT Express).
// Must return boolean: true if handled, false if not.
// Assumes auth + tenant context already enforced by server.js for /api/* routes.
// Uses req.ctx and x-request-id header set by server.js.

const {
  createCycleCountDraftHttp,
  listCycleCountsHttp,
  getCycleCountHttp,
} = require("../controllers/cycleCounts/cycleCounts.read");

const {
  addCycleCountLineHttp,
  updateCycleCountLineHttp,
  deleteCycleCountLineHttp,
} = require("../controllers/cycleCounts/cycleCounts.lines");

const { submitCycleCountHttp } = require("../controllers/cycleCounts/cycleCounts.submit");
const {
  approveCycleCountHttp,
  rejectCycleCountHttp,
} = require("../controllers/cycleCounts/cycleCounts.approveReject");

const { postCycleCountHttp } = require("../controllers/cycleCounts/cycleCounts.post");

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function matchPath(pathname) {
  // supported base: /api/cycle-counts
  const base = "/api/cycle-counts";
  if (pathname === base) return { kind: "base" };
  if (pathname === `${base}/`) return { kind: "base" };

  // /api/cycle-counts/:cycleCountId
  const m1 = pathname.match(/^\/api\/cycle-counts\/([^/]+)$/);
  if (m1) return { kind: "detail", cycleCountId: m1[1] };

  // /api/cycle-counts/:cycleCountId/lines
  const m2 = pathname.match(/^\/api\/cycle-counts\/([^/]+)\/lines$/);
  if (m2) return { kind: "lines", cycleCountId: m2[1] };

  // /api/cycle-counts/:cycleCountId/lines/:lineId
  const m3 = pathname.match(/^\/api\/cycle-counts\/([^/]+)\/lines\/([^/]+)$/);
  if (m3) return { kind: "lineDetail", cycleCountId: m3[1], cycleCountLineId: m3[2] };

  // lifecycle actions
  const m4 = pathname.match(/^\/api\/cycle-counts\/([^/]+)\/(submit|approve|reject|post)$/);
  if (m4) return { kind: "action", cycleCountId: m4[1], action: m4[2] };

  return null;
}

module.exports = function cycleCountsRouter(req, res) {
  const requestId = res.getHeader("x-request-id") || null;

  // Must have ctx (fail-closed; server should set req.ctx)
  if (!req.ctx || !req.ctx.tenantId) {
    // This is a server miswire; still fail-closed.
    json(res, 403, {
      error: { code: "TENANT_UNRESOLVED", message: "Tenant unresolved (fail-closed)." },
      requestId,
    });
    return true;
  }

  // Parse URL safely
  let pathname = null;
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch {
    return false;
  }

  if (!pathname.startsWith("/api/cycle-counts")) return false;

  const match = matchPath(pathname);
  if (!match) return false;

  // ----- /api/cycle-counts -----
  if (match.kind === "base") {
    if (req.method === "GET") return listCycleCountsHttp(req, res, requestId);
    if (req.method === "POST") return createCycleCountDraftHttp(req, res, requestId);
    return false;
  }

  // ----- /api/cycle-counts/:cycleCountId -----
  if (match.kind === "detail") {
    req.params = { cycleCountId: match.cycleCountId };
    if (req.method === "GET") return getCycleCountHttp(req, res, requestId);
    return false;
  }

  // ----- /api/cycle-counts/:cycleCountId/lines -----
  if (match.kind === "lines") {
    req.params = { cycleCountId: match.cycleCountId };
    if (req.method === "POST") return addCycleCountLineHttp(req, res, requestId);
    return false;
  }

  // ----- /api/cycle-counts/:cycleCountId/lines/:cycleCountLineId -----
  if (match.kind === "lineDetail") {
    req.params = { cycleCountId: match.cycleCountId, cycleCountLineId: match.cycleCountLineId };
    if (req.method === "PATCH") return updateCycleCountLineHttp(req, res, requestId);
    if (req.method === "DELETE") return deleteCycleCountLineHttp(req, res, requestId);
    return false;
  }

  // ----- /api/cycle-counts/:cycleCountId/:action -----
  if (match.kind === "action") {
    req.params = { cycleCountId: match.cycleCountId };

    if (req.method !== "POST") return false;

    if (match.action === "submit") return submitCycleCountHttp(req, res, requestId);
    if (match.action === "approve") return approveCycleCountHttp(req, res, requestId);
    if (match.action === "reject") return rejectCycleCountHttp(req, res, requestId);
    if (match.action === "post") return postCycleCountHttp(req, res, requestId);

    return false;
  }

  return false;
};
