import { loadTenantCollection, saveTenantCollection } from "../../storage/jsonStore.mjs";
import { nowUtcIso } from "../time/utc.mjs";
import { dedupeKey } from "./dedupe.mjs";

function safeNum(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function sumByKey(map, key, delta) {
  const cur = map.get(key) || 0;
  map.set(key, cur + delta);
}

async function computeOnHand(tenantId) {
  const events = (await loadTenantCollection(tenantId, "ledger_events", [])) || [];

  const byItem = new Map();
  for (const e of events) {
    if (!e || typeof e.itemId !== "string") continue;
    const d = safeNum(e.qtyDelta);
    if (d === null) continue;
    sumByKey(byItem, e.itemId, d);
  }
  return { byItem };
}

function ruleIsActive(rule) {
  return rule && !rule.deletedAtUtc && rule.enabled === true;
}

async function makeAlert(tenantId, rule, conditionKey, condition) {
  const dk = await dedupeKey(tenantId, rule.ruleId, conditionKey);
  return {
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
    condition
  };
}

function makeNotification(alert) {
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
  const rules = (await loadTenantCollection(tenantId, "alert_rules", [])) || [];
  const activeRules = rules.filter(ruleIsActive);
  if (activeRules.length === 0) return { ok: true, generated: 0, reason };

  const alerts = (await loadTenantCollection(tenantId, "alerts", [])) || [];
  const notifications = (await loadTenantCollection(tenantId, "notifications", [])) || [];

  const openIndex = new Set();
  for (const a of alerts) {
    if (!a || typeof a.dedupeKey !== "string") continue;
    if (a.status === "OPEN" || a.status === "ACKNOWLEDGED") openIndex.add(a.dedupeKey);
  }

  const onHand = await computeOnHand(tenantId);

  let generated = 0;
  const newAlerts = [];
  const newNotifs = [];

  for (const rule of activeRules) {
    if (!rule.ruleId || typeof rule.type !== "string" || typeof rule.scope !== "string") continue;

    if (rule.type === "LOW_STOCK" && rule.scope === "ITEM") {
      const thresholdQty = safeNum(rule.params ? rule.params.thresholdQty : null);
      const itemId = rule.target && typeof rule.target.itemId === "string" ? rule.target.itemId : null;
      if (thresholdQty === null || !itemId) continue;

      const qty = onHand.byItem.get(itemId) || 0;
      if (qty <= thresholdQty) {
        const conditionKey = `LOW_STOCK|ITEM|item:${itemId}|threshold:${thresholdQty}|onHand:${qty}`;
        const dk = await dedupeKey(tenantId, rule.ruleId, conditionKey);
        if (!openIndex.has(dk)) {
          const alert = await makeAlert(tenantId, rule, conditionKey, {
            type: "LOW_STOCK",
            scope: "ITEM",
            itemId,
            thresholdQty,
            onHandQty: qty,
            reason
          });
          openIndex.add(alert.dedupeKey);
          newAlerts.push(alert);
          newNotifs.push(makeNotification(alert));
          generated += 1;
        }
      }
    }
  }

  if (newAlerts.length) await saveTenantCollection(tenantId, "alerts", alerts.concat(newAlerts));
  if (newNotifs.length) await saveTenantCollection(tenantId, "notifications", notifications.concat(newNotifs));

  return { ok: true, generated, reason };
}
