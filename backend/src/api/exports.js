"use strict";

const url = require("url");

const { emitAudit } = require("../observability/audit");
const { toCsv, sendCsv } = require("../utils/csv");
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

function stableHeadersFor(reportName) {
  if (reportName === "stock") return ["itemId", "hubId", "binId", "qtyOnHand"];
  if (reportName === "movements")
    return [
      "occurredAtUtc",
      "ledgerEventId",
      "eventType",
      "itemId",
      "hubId",
      "binId",
      "qtyDelta",
      "unitCost",
      "sourceType",
      "sourceId",
      "actorUserId",
      "reasonCode",
      "notes",
    ];
  if (reportName === "receiving") return ["itemId", "hubId", "binId", "qtyReceived", "totalExtendedCost", "firstReceivedAtUtc", "lastReceivedAtUtc"];
  if (reportName === "shrink") return ["itemId", "hubId", "binId", "qtyShrink", "eventsCount", "firstAtUtc", "lastAtUtc"];
  if (reportName === "valuation")
    return ["itemId", "hubId", "binId", "qtyOnHand", "avgUnitCost", "extendedValue", "valuationMethod"];
  return null;
}

function stableFilenameFor(reportName) {
  // Stable filenames (no timestamps)
  return `${reportName}.csv`;
}

async function handle(req, res, ctx) {
  const reqUrl = url.parse(req.url, true);
  const pathname = reqUrl.pathname || "";

  if (!pathname.startsWith("/api/exports/")) return notFound(res, "ROUTE_NOT_FOUND");

  const { tenantId, userId } = ctx || {};
  if (!tenantId) return send(res, 403, { error: "FORBIDDEN", code: "TENANT_REQUIRED", details: null });

  const parsed = parseFilters(reqUrl);
  if (parsed.error) return badRequest(res, parsed.error.code, parsed.error.details);
  const filters = parsed.filters;

  const ledgerEvents = await loadLedger(tenantId);

  let reportName;
  let rows;

  if (pathname === "/api/exports/stock.csv") {
    reportName = "stock";
    rows = buildStock(ledgerEvents, filters);
  } else if (pathname === "/api/exports/movements.csv") {
    reportName = "movements";
    rows = buildMovements(ledgerEvents, filters);
  } else if (pathname === "/api/exports/receiving.csv") {
    reportName = "receiving";
    rows = buildReceiving(ledgerEvents, filters);
  } else if (pathname === "/api/exports/shrink.csv") {
    reportName = "shrink";
    rows = buildShrink(ledgerEvents, filters);
  } else if (pathname === "/api/exports/valuation.csv") {
    reportName = "valuation";
    rows = buildValuation(ledgerEvents, filters);
  } else {
    return notFound(res, "EXPORT_NOT_FOUND");
  }

  const headers = stableHeadersFor(reportName);
  if (!headers) return notFound(res, "EXPORT_HEADERS_NOT_FOUND");

  // Ensure every row has all headers (deterministic schema)
  const normalizedRows = rows.map((r) => {
    const out = {};
    for (const h of headers) out[h] = r[h] === undefined ? null : r[h];
    return out;
  });

  const csvText = toCsv(headers, normalizedRows);

  emitAudit(ctx, {
    eventCategory: "EXPORT",
    eventType: "REPORT_EXPORT",
    objectType: "export",
    objectId: reportName,
    decision: "ALLOW",
    reasonCode: "EXPORT_CSV",
    factsSnapshot: {
      export: reportName,
      filters,
      rows: Array.isArray(rows) ? rows.length : 0,
      actorUserId: userId || null,
      filename: stableFilenameFor(reportName),
    },
  });

  return sendCsv(res, stableFilenameFor(reportName), csvText);
}

module.exports = handle;
