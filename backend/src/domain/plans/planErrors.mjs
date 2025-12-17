// backend/src/domain/plans/planErrors.mjs

export class PlanEnforcementError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "PlanEnforcementError";
    this.code = code;
    this.details = details || null;
  }
}

export function isPlanEnforcementError(err) {
  return !!err && err.name === "PlanEnforcementError" && typeof err.code === "string";
}
