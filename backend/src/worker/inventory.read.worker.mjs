// backend/src/worker/inventory.read.worker.mjs
import { loadTenantCollection } from "../storage/jsonStore.worker.mjs";
import { emitAudit } from "../observability/audit.mjs";

function json(statusCode, body, baseHeaders) {
  const h = new Headers(baseHeaders || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

function parsePath(pathname) {
  return (pathname || "/").replace(/\/+$/g, "") || "/";
}

function stableSortById(a, b) {
  const ai = (a && a.id) ? String(a.id) : "";
  const bi = (b && b.id) ? String(b.id) : "";
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

const COLLECTION_MAP = {
  "/api/inventory/items": "items.json",
  "/api/inventory/categories": "categories.json",
  "/api/inventory/hubs": "hubs.json",
  "/api/inventory/bins": "bins.json",
  "/api/inventory/vendors": "vendors.json",
};

export async function inventoryReadFetchRouter(ctx, request, baseHeaders) {
  const u = new URL(request.url);
  const pathname = parsePath(u.pathname);
  const method = (request.method || "GET").toUpperCase();

  if (!pathname.startsWith("/api/inventory/")) return null;

  // Read-only in U1: GET only
  if (method !== "GET") {
    return json(405, { error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED", details: null }, baseHeaders);
  }

  const fileName = COLLECTION_MAP[pathname];
  if (!fileName) {
    return json(404, { error: "NOT_FOUND", code: "ROUTE_NOT_FOUND", details: null }, baseHeaders);
  }

  // Tenant-scoped read
  const list = await loadTenantCollection(ctx.tenantId, fileName, []);
  const out = Array.isArray(list) ? list.slice().sort(stableSortById) : [];

  emitAudit(ctx, {
    eventCategory: "READ",
    eventType: "INVENTORY_READ",
    objectType: "inventory_collection",
    objectId: pathname,
    decision: "ALLOW",
    reasonCode: "READ_OK",
    factsSnapshot: { path: pathname, count: out.length },
  });

  return json(200, { data: out }, baseHeaders);
}
