# B12 — Plans, Limits & Commercial Enforcement (Backend-Only)

## Purpose
Plans are hard execution constraints enforced exclusively in backend write paths.
They define what a tenant is allowed to do — not how they are billed.

## What Exists
- Static plan definitions with explicit numeric limits
- Deterministic tenant → plan resolution
- Fail-closed enforcement before any mutation or ledger write
- Mandatory audit emission on all violations

## What Does NOT Exist
- Billing, payments, subscriptions, invoicing
- UI plan indicators or upgrade flows
- Soft warnings or degraded modes

## Enforcement Flow (Write Paths Only)
1. Resolve tenant plan (fail-closed if missing/unknown)
2. Infer resource intent for create-like actions
3. Derive current usage deterministically
4. Block if attempted usage exceeds plan limit
5. Emit audit facts on every violation

## Editing Limits
Edit `planDefinitions.mjs` only. No implicit defaults are allowed.

## Adding New Enforced Resources
- Add resource to `RESOURCE_TYPES`
- Add explicit limits for every plan
- Map deterministic usage keys in `usageCounters.mjs`
- Map create endpoints in `enforcePlanForRequest.worker.mjs`
