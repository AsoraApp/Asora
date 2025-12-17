const { ALERT_RULE_TYPES, ALERT_RULE_SCOPES } = require("./types");

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function validateAlertRuleInput(input, opts) {
  const options = opts || {};
  const allowPartial = !!options.allowPartial;
  const requireAll = !!options.requireAll;

  if (!isObj(input)) return { ok: false, code: "INVALID_BODY_OBJECT", details: null };

  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);

  // For create: require type + scope.
  // For update: allow partial but if provided must be valid.
  if (requireAll || !allowPartial) {
    if (!has("type")) return { ok: false, code: "MISSING_TYPE", details: null };
    if (!has("scope")) return { ok: false, code: "MISSING_SCOPE", details: null };
  }

  if (has("type")) {
    const t = String(input.type || "");
    if (!ALERT_RULE_TYPES.includes(t)) return { ok: false, code: "INVALID_TYPE", details: { type: t } };
  }

  if (has("scope")) {
    const s = String(input.scope || "");
    if (!ALERT_RULE_SCOPES.includes(s)) return { ok: false, code: "INVALID_SCOPE", details: { scope: s } };
  }

  if (has("enabled") && typeof input.enabled !== "boolean") {
    return { ok: false, code: "INVALID_ENABLED", details: { enabled: input.enabled } };
  }

  if (has("note") && !(typeof input.note === "string" || input.note === null)) {
    return { ok: false, code: "INVALID_NOTE", details: { note: input.note } };
  }

  if (has("target") && !(isObj(input.target) || input.target === null)) {
    return { ok: false, code: "INVALID_TARGET", details: { target: input.target } };
  }

  if (has("params") && !isObj(input.params)) {
    return { ok: false, code: "INVALID_PARAMS", details: { params: input.params } };
  }

  // Cross-field deterministic constraints (when enough info exists).
  const type = has("type") ? String(input.type) : null;
  const scope = has("scope") ? String(input.scope) : null;
  const params = has("params") ? input.params : null;
  const target = has("target") ? input.target : null;

  // If partial update, only enforce these rules if both fields are present.
  const shouldCrossValidate =
    requireAll || (!allowPartial && type && scope) || (allowPartial && type && scope);

  if (shouldCrossValidate) {
    // LOW_STOCK requires params.thresholdQty (number >= 0).
    if (type === "LOW_STOCK") {
      if (!params || typeof params.thresholdQty !== "number" || !Number.isFinite(params.thresholdQty) || params.thresholdQty < 0) {
        return { ok: false, code: "LOW_STOCK_REQUIRES_THRESHOLD_QTY", details: { thresholdQty: params ? params.thresholdQty : null } };
      }
    }

    // STOCKOUT needs no params.
    if (type === "STOCKOUT") {
      // ok
    }

    // OVER_RECEIPT requires scope PO_LINE and target.poId + target.poLineId (deterministic pointer).
    if (type === "OVER_RECEIPT") {
      if (scope !== "PO_LINE") {
        return { ok: false, code: "OVER_RECEIPT_SCOPE_MUST_BE_PO_LINE", details: { scope } };
      }
      if (!target || typeof target.poId !== "string" || typeof target.poLineId !== "string") {
        return { ok: false, code: "OVER_RECEIPT_REQUIRES_PO_TARGET", details: { target } };
      }
    }

    // Scope target requirements for item/bin/hub.
    if (scope === "ITEM") {
      if (!target || typeof target.itemId !== "string") return { ok: false, code: "ITEM_SCOPE_REQUIRES_ITEM_ID", details: { target } };
    }
    if (scope === "BIN") {
      if (!target || typeof target.binId !== "string") return { ok: false, code: "BIN_SCOPE_REQUIRES_BIN_ID", details: { target } };
    }
    if (scope === "HUB") {
      if (!target || typeof target.hubId !== "string") return { ok: false, code: "HUB_SCOPE_REQUIRES_HUB_ID", details: { target } };
    }
    if (scope === "AGGREGATE") {
      // target optional; aggregate can be global or itemId-based
      if (target && target.itemId && typeof target.itemId !== "string") {
        return { ok: false, code: "AGGREGATE_INVALID_ITEM_ID", details: { target } };
      }
    }
  }

  return { ok: true };
}

module.exports = { validateAlertRuleInput };
