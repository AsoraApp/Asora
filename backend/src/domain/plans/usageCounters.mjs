// backend/src/domain/plans/usageCounters.mjs
// Deterministic counters derived from tenant collections. Fail-closed on ambiguity.

import { PlanEnforcementError } from "./planErrors.mjs";

function countFromCollection(col, keysInPriorityOrder) {
  for (const k of keysInPriorityOrder) {
    const v = col?.[k];
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") return Object.keys(v).length;
  }
  return null;
}

export function getCurrentCountOrThrow(col, resourceType) {
  // Map resource types to known collection keys. Adjust only here as your storage model evolves.
  const mapping = {
    items: ["items", "itemIndex", "catalogItems"],
    categories: ["categories", "categoryIndex"],
    hubs: ["hubs", "hubIndex"],
    bins: ["bins", "binIndex"],
    vendors: ["vendors", "vendorIndex"],
    exports: ["exports", "exportRuns", "exportHistory"],
    integrations: ["integrations", "integrationConfigs"],
  };

  const keys = mapping[resourceType];
  if (!keys) {
    throw new PlanEnforcementError("UNKNOWN_RESOURCE_TYPE", "Unknown resource type for plan enforcement.", {
      resourceType,
    });
  }

  const n = countFromCollection(col, keys);
  if (!Number.isFinite(n)) {
    throw new PlanEnforcementError("AMBIGUOUS_USAGE_STATE", "Cannot derive deterministic usage count. Fail-closed.", {
      resourceType,
      keysTried: keys,
    });
  }

  return n;
}
