function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

export function validateAlertRuleInput(input) {
  if (!isObj(input)) return { ok: false, code: "INVALID_BODY_OBJECT", details: null };

  if (typeof input.type !== "string") return { ok: false, code: "MISSING_TYPE", details: null };
  if (typeof input.scope !== "string") return { ok: false, code: "MISSING_SCOPE", details: null };

  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    return { ok: false, code: "INVALID_ENABLED", details: { enabled: input.enabled } };
  }

  if (input.note !== undefined && !(typeof input.note === "string" || input.note === null)) {
    return { ok: false, code: "INVALID_NOTE", details: { note: input.note } };
  }

  if (input.target !== undefined && !(isObj(input.target) || input.target === null)) {
    return { ok: false, code: "INVALID_TARGET", details: { target: input.target } };
  }

  if (input.params !== undefined && !isObj(input.params)) {
    return { ok: false, code: "INVALID_PARAMS", details: { params: input.params } };
  }

  if (input.type === "LOW_STOCK" && input.scope === "ITEM") {
    const t = input.params?.thresholdQty;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) {
      return { ok: false, code: "LOW_STOCK_REQUIRES_THRESHOLD_QTY", details: { thresholdQty: t ?? null } };
    }
    const itemId = input.target?.itemId;
    if (typeof itemId !== "string") {
      return { ok: false, code: "ITEM_SCOPE_REQUIRES_ITEM_ID", details: { target: input.target ?? null } };
    }
  }

  return { ok: true };
}
