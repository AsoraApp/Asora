"use strict";

const url = require("url");

const { emitAudit } = require("../observability/audit");
const { loadLedger, buildStock, buildMovements, buildReceiving, buildShrink, buildValuation, isIsoUtc } = require("../reports/reporting");

function send(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function badRequest(res, code, details) {
  return send(res, 400, { error: "BAD_REQUEST", code, details: details || null });
}
function notFound(res, code) {
  return send(res, 404, { error: "NOT_FOUND", code });
}

function parseFilters(reqUrl) {
  const q = (reqUrl && reqUrl.query) || {};
  const filters = {
    itemId: q.itemId ? String(q.itemId) : null,
    hubId: q.hubId ? String(q.hubId) : null,
    binId: q.binId ? String(q.binId) : null,
    fromUtc: q.fromUtc ? String(q.fromUtc) : null,
    toUtc: q.toUtc ? String(q.toUtc) : null,
  };

  if (filters.fromUtc && !isIsoUtc(filters.fromUtc)) return { error: { code: "INVALID_FROM_UTC", details: { fromUtc: filters.fromUtc } } };
  if (filters.toUtc && !isIsoUtc(filters.toUtc)) return { error: { code: "INVALID_TO_UTC", details: { toUtc: filters.toUtc } } };
  if (filters.fromUtc && filters.toUtc && filters.fromUtc > filters.toUtc)
    return { error: { code: "INVALID_RANGE", details: { fromUtc: filters.fromUtc, toUtc: filters.toUtc } } };

  return { filters };
}

async function handle(req, res, ctx) {
  const reqUrl = url.parse(req.url, true);
  const pathname = reqUrl.pathname || "";

  if (!pathname.startsWith("/api/reports/")) return notFound(res, "ROUTE_NOT_FOUND");

  const { tenantId, userId } = ctx || {};
  if (!tenantId) return send(res, 403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null });

  const parsed = parseFilters(reqUrl);
  if (parsed.error) return badRequest(res, parsed.error.code, parsed.error.details);
  const filters = parsed.filters;

  const ledgerEvents = await loadLedger(tenantId);

  let data;
  let reportName;

  if (pathname === "/api/reports/stock") {
    reportName = "stock";
    data = buildStock(ledgerEvents, filters);
  } else if (pathname === "/api/reports/movements") {
    reportName = "movements";
    data = buildMovements(ledgerEvents, filters);
  } else if (pathname === "/api/reports/receiving") {
    reportName = "receiving";
    data = buildReceiving(ledgerEvents, filters);
  } else if (pathname === "/api/reports/shrink") {
    reportName = "shrink";
    data = buildShrink(ledgerEvents, filters);
  } else if (pathname === "/api/reports/valuation") {
    reportName = "valuation";
    data = buildValuation(ledgerEvents, filters);
  } else {
    return notFound(res, "REPORT_NOT_FOUND");
  }

  emitAudit(ctx, {
    eventCategory: "EXPORT", // read-only reporting/export surface (no BI tooling)
    eventType: "REPORT_VIEW",
    objectType: "report",
    objectId: reportName,
    decision: "ALLOW",
    reasonCode: "REPORT_READ",
    factsSnapshot: {
      report: reportName,
      filters,
      rows: Array.isArray(data) ? data.length : 0,
      actorUserId: userId || null,
    },
  });

  return send(res, 200, { report: reportName, filters, rows: data });
}

module.exports = handle;
