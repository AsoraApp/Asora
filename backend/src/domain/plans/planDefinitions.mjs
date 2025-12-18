// backend/src/domain/plans/planDefinitions.mjs
// Static, deterministic plan limits. No implicit defaults.

export const RESOURCE_TYPES = Object.freeze({
  ITEMS: "items",
  CATEGORIES: "categories",
  HUBS: "hubs",
  BINS: "bins",
  VENDORS: "vendors",
  EXPORTS: "exports",
  INTEGRATIONS: "integrations",
});

export const ACTIONS = Object.freeze({
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  EXPORT: "export",
  INTEGRATE: "integrate",
});

export function getPlanDefinitions() {
  // NOTE: Adjust numeric limits only by editing this file.
  // Every limit must be explicit (including Enterprise).
  return Object.freeze({
    Free: Object.freeze({
      name: "Free",
      limits: Object.freeze({
        [RESOURCE_TYPES.ITEMS]: 250,
        [RESOURCE_TYPES.CATEGORIES]: 25,
        [RESOURCE_TYPES.HUBS]: 3,
        [RESOURCE_TYPES.BINS]: 50,
        [RESOURCE_TYPES.VENDORS]: 10,
        [RESOURCE_TYPES.EXPORTS]: 25, // per rolling window counter scope (implementation-defined)
        [RESOURCE_TYPES.INTEGRATIONS]: 0,
      }),
    }),
    Pro: Object.freeze({
      name: "Pro",
      limits: Object.freeze({
        [RESOURCE_TYPES.ITEMS]: 5000,
        [RESOURCE_TYPES.CATEGORIES]: 250,
        [RESOURCE_TYPES.HUBS]: 25,
        [RESOURCE_TYPES.BINS]: 2000,
        [RESOURCE_TYPES.VENDORS]: 250,
        [RESOURCE_TYPES.EXPORTS]: 1000,
        [RESOURCE_TYPES.INTEGRATIONS]: 5,
      }),
    }),
    Enterprise: Object.freeze({
      name: "Enterprise",
      limits: Object.freeze({
        [RESOURCE_TYPES.ITEMS]: 100000,
        [RESOURCE_TYPES.CATEGORIES]: 5000,
        [RESOURCE_TYPES.HUBS]: 500,
        [RESOURCE_TYPES.BINS]: 50000,
        [RESOURCE_TYPES.VENDORS]: 10000,
        [RESOURCE_TYPES.EXPORTS]: 100000,
        [RESOURCE_TYPES.INTEGRATIONS]: 100,
      }),
    }),
  });
}

export function getPlanOrNull(planName) {
  const defs = getPlanDefinitions();
  return defs && planName && defs[planName] ? defs[planName] : null;
}

export function getLimitOrNull(plan, resourceType) {
  if (!plan || !plan.limits || typeof plan.limits !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(plan.limits, resourceType)) return null;
  const v = plan.limits[resourceType];
  return Number.isFinite(v) ? v : null;
}

