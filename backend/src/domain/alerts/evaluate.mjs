import { loadTenantCollection, saveTenantCollection } from "../../storage/jsonStore.worker.mjs";
import { nowUtcIso } from "../time/utc.mjs";

function safeNum(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function ruleActive(r) {
  return r && !r.deletedAtUtc && r.enabled === true;
}

async function computeOnHandByItem(tenantId) {
  const events = (await loadTenantCollection(tenantId, "ledger_events", [])) || [];
  const m = new Map();
  for (const e of events) {
    if (!e || typeof e.itemId !== "string") continue;
    const d = safeNum(e.qtyDelta);
    if (d === null) continue;
    m.set(e.itemId, (m.get(e.itemId) || 0) + d);
  }
  return m;
}

function notificationFor(alert) {
  return {
    notificationId: crypto.randomUUID(),
    createdAtUtc: nowUtcIso(),
    type: "ALERT_OPENED",
    alertId: alert.alertId,
    ruleId: alert.ruleId,
    status: "IN_APP_RECORDED",
    email: { status: "PLACEHOLDER_NOT_SENT" }
  };
}

export function evaluateAlertsAsync(tenantId, reason) {
  setTimeout(() => {
    evaluateAlertsOnce(tenantId, reason).catch(() => {});
  }, 0);
}

export async function evaluateAlertsOnce(tenantId, reason) {
  const rules = ((await loadTenantCollection(tenantId, "alert_rules", [])) || []).filter(ruleActive);
  if (!rules.length) return { ok: true, generated: 0 };

  const alerts = (await loadTenantCollection(tenantId, "alerts", [])) || [];
  const notifications = (await loadTenantCollection(tenantId, "notifications", [])) || [];

  const openDedupe = new Set(
    alerts
      .filter((a) => a && typeof a.dedupeKey === "string" && (a.status === "OPEN" || a.status === "ACKNOWLEDGED"))
      .map((a) => a.dedupeKey)
  );

  const onHandByItem = await computeOnHandByItem(tenantId);

  const newAlerts = [];
  const newNotifs = [];

  for (const rule of rules) {
    if (rule.type === "LOW_STOCK" && rule.scope === "ITEM") {
      const itemId = rule.target?.itemId;
      const thresholdQty = rule.params?.thresholdQty;
      if (typeof itemId !== "string") continue;
      if (typeof thresholdQty !== "number" || !Number.isFinite(thresholdQty) || thresholdQty < 0) continue;

      const onHand = onHandByItem.get(itemId) || 0;
      if (onHand <= thresholdQty) {
        const conditionKey = `LOW_STOCK|ITEM|${itemId}|t:${thresholdQty}|q:${onHand}`;
        const dk = await sha256Hex(`${tenantId}|${rule.ruleId}|${conditionKey}`);
        if (openDedupe.has(dk)) continue;

        const alert = {
          alertId: crypto.randomUUID(),
          tenantId,
          ruleId: rule.ruleId,
          status: "OPEN",
          createdAtUtc: nowUtcIso(),
          updatedAtUtc: nowUtcIso(),
          acknowledgedAtUtc: null,
          acknowledgedByUserId: null,
          closedAtUtc: null,
          closedByUserId: null,
          dedupeKey: dk,
          conditionKey,
          condition: { type: "LOW_STOCK", scope: "ITEM", itemId, thresholdQty, onHandQty: onHand, reason }
        };

        openDedupe.add(dk);
        newAlerts.push(alert);
        newNotifs.push(notificationFor(alert));
      }
    }
  }

  if (newAlerts.length) await saveTenantCollection(tenantId, "alerts", alerts.concat(newAlerts));
  if (newNotifs.length) await saveTenantCollection(tenantId, "notifications", notifications.concat(newNotifs));

  return { ok: true, generated: newAlerts.length };
}
