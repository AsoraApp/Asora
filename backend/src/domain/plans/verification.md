# B12 — Verification & Lock Checklist

## Preconditions
- Branch: `b12-plans-limits-enforcement`
- No code merged to `main`
- No billing, pricing, or UI plan logic present

## Deterministic Guarantees
- All plans are statically defined with explicit numeric limits
- Tenant resolves to exactly one plan or fails closed
- No client-supplied plan data is accepted
- Enforcement occurs only on write paths, before any mutation or ledger write
- All timestamps are UTC

## Enforcement Coverage
- Items (create)
- Categories (create)
- Hubs (create)
- Bins (create)
- Vendors (create)
- Exports (run)
- Integrations (create)

## Failure Modes (Expected)
- Missing plan → 403 FORBIDDEN, audit emitted
- Unknown plan → 403 FORBIDDEN, audit emitted
- Undefined limit → 403 FORBIDDEN, audit emitted
- Ambiguous usage state → 403 FORBIDDEN, audit emitted
- Limit exceeded → 409 CONFLICT, audit emitted
- No partial writes under any failure

## Audits (Mandatory)
Each violation emits:
- tenantId
- plan name
- resourceType
- limit
- attempted value
- attempted action
- UTC timestamp

## Explicitly Absent
- Billing
- Payments
- Subscriptions
- Invoicing
- UI plan indicators
- Auto-upgrades

## Lock Criteria
- All write paths pass through B12 enforcement
- All violations are fail-closed and auditable
- Ledger behavior remains unchanged
- No scope beyond B12 introduced

## Status
READY TO LOCK
