// backend/src/domain/integrations/snapshots.worker.mjs
import { loadTenantCollection } from "../../storage/jsonStore.worker.mjs";
import { redactObjectDeterministically } from "./redaction.worker.mjs";

// Deterministic snapshot builders (read-only inputs; stable ordering; tenant-scoped).
export async function buildSnapshot(ctx, snapshotType, input) {
  const t = String(snapshotType || "").trim();

  if (t === "inventory.stock_on_hand") return buildStockOnHand(ctx);
  if (t === "inventory.valuation") return buildValuation(ctx);
  if (t === "procurement.receipts_summary") return buildReceiptsSummary(ctx);
  if (t === "vendors.list") return buildVendorsList(ctx);

  const err = new Error("UNKNOWN_SNAPSHOT_TYPE");
  err.code = "UNKNOWN_SNAPSHOT_TYPE";
  err.details = { snapshotType: t };
  throw err;
}

async function buildStockOnHand(ctx) {
  // Expected existing collections from earlier phases:
  // - ledger: append-only events
  // - inventory: reconciled reads (optional)
  const ledger = await loadTenantCollection(ctx, "ledger");
  const events = Array.isArray(ledger?.events) ? ledger.events : [];

  // Derive stock by summing qtyDelta per (itemId, hubId, binId).
  const map = new Map();
  const stableEvents = events
    .slice()
    .sort((a, b) => String(a.eventId || "").localeCompare(String(b.eventId || "")));

  for (const e of stableEvents) {
    const itemId = String(e?.itemId || "").trim();
    const hubId = String(e?.hubId || "").trim();
    const binId = String(e?.binId || "").trim();
    const qtyDelta = Number(e?.qtyDelta);

    if (!itemId || !hubId || !binId || !Number.isFinite(qtyDelta)) continue;

    const k = `${itemId}||${hubId}||${binId}`;
    const prev = map.get(k) || 0;
    map.set(k, prev + qtyDelta);
  }

  const rows = [];
  for (const [k, qty] of map.entries()) {
    const [itemId, hubId, binId] = k.split("||");
    rows.push({ itemId, hubId, binId, qty });
  }

  rows.sort((a, b) =>
    `${a.itemId}|${a.hubId}|${a.binId}`.localeCompare(`${b.itemId}|${b.hubId}|${b.binId}`)
  );

  return { snapshotType: "inventory.stock_on_hand", rows };
}

async function buildValuation(ctx) {
  // Minimal deterministic valuation snapshot:
  // - Uses B8’s chosen method if already materialized in a collection; otherwise derives a basic rollup.
  // Prefer an existing reconciled report if present.
  const valuation = await loadTenantCollection(ctx, "report.inventory_valuation");
  if (valuation && typeof valuation === "object" && Array.isArray(valuation?.rows)) {
    const rows = valuation.rows.slice().map((r) => redactObjectDeterministically(r));
    rows.sort((a, b) => String(a.itemId || "").localeCompare(String(b.itemId || "")));
    return { snapshotType: "inventory.valuation", method: valuation.method || "unknown", rows };
  }

  // Fallback: roll up stock_on_hand with item unitCost if present.
  const itemsCol = await loadTenantCollection(ctx, "items");
  const items = Array.isArray(itemsCol?.items) ? itemsCol.items : [];
  const costByItem = new Map();
  for (const it of items) {
    const id = String(it?.itemId || "").trim();
    const unitCost = Number(it?.unitCost);
    if (id && Number.isFinite(unitCost)) costByItem.set(id, unitCost);
  }

  const soh = await buildStockOnHand(ctx);
  const byItem = new Map();
  for (const r of soh.rows) {
    const prev = byItem.get(r.itemId) || 0;
    byItem.set(r.itemId, prev + Number(r.qty || 0));
  }

  const rows = [];
  for (const [itemId, qty] of byItem.entries()) {
    const unitCost = costByItem.get(itemId);
    const ext = Number.isFinite(unitCost) ? unitCost * qty : null;
    rows.push({ itemId, qty, unitCost: Number.isFinite(unitCost) ? unitCost : null, extendedCost: ext });
  }

  rows.sort((a, b) => String(a.itemId).localeCompare(String(b.itemId)));
  return { snapshotType: "inventory.valuation", method: "fallback_unitCost_x_qty", rows };
}

async function buildReceiptsSummary(ctx) {
  const receipts = await loadTenantCollection(ctx, "receipts");
  const rows = Array.isArray(receipts?.items) ? receipts.items : [];
  const stable = rows
    .slice()
    .map((r) => ({
      receiptId: String(r?.receiptId || "").trim(),
      poId: String(r?.poId || "").trim(),
      vendorId: String(r?.vendorId || "").trim(),
      receivedAtUtc: String(r?.receivedAtUtc || "").trim(),
      lineCount: Array.isArray(r?.lines) ? r.lines.length : 0,
    }))
    .filter((r) => r.receiptId);

  stable.sort((a, b) => String(a.receiptId).localeCompare(String(b.receiptId)));
  return { snapshotType: "procurement.receipts_summary", rows: stable };
}

async function buildVendorsList(ctx) {
  const vendors = await loadTenantCollection(ctx, "vendors");
  const rows = Array.isArray(vendors?.items) ? vendors.items : [];
  const stable = rows
    .slice()
    .map((v) => ({
      vendorId: String(v?.vendorId || "").trim(),
      name: String(v?.name || "").trim(),
      status: String(v?.status || "").trim(),
    }))
    .filter((v) => v.vendorId);

  stable.sort((a, b) => String(a.vendorId).localeCompare(String(b.vendorId)));
  return { snapshotType: "vendors.list", rows: stable };
}
