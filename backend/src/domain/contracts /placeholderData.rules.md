## Placeholder Inventory Read Store Rules (B2)

This document defines the rules for the temporary inventory read store used in Build Phase B2.

### Purpose
- Validate request plumbing, tenant isolation, and response contracts.
- Enable frontend and API verification before the authoritative ledger (B3) exists.

### Authority
- This store is NOT authoritative.
- All quantities and relationships will be replaced by ledger-derived reads in B3+.
- No business decisions may rely on placeholder values.

### Scope
- Read-only.
- No writes, mutations, adjustments, or side effects.
- No background jobs or automation.

### Tenant Partitioning
- All data is partitioned by `tenantId`.
- Every read operation MUST require `tenantId` as the first argument.
- Cross-tenant access MUST return NOT_FOUND (404).
- Tenant identity is session-derived only (B1). Client input is never trusted.

### Determinism
- Data is static for the lifetime of the process.
- No random values.
- No time-based variation except request-level `asOfUtc`.
- Lists MUST be returned in deterministic order as defined in `inventoryRead.contracts.md`.

### Entities Provided
- Hubs
- Bins (linked to hubs)
- Items (SKUs)
- Stock rows (hub + bin + item)

### Quantity Rules
- `qtyOnHand` is an integer ≥ 0.
- `qtyAvailable` is an integer ≥ 0.
- In B2 placeholder data, `qtyAvailable` MAY equal `qtyOnHand`.
- No reservations, holds, or allocations are modeled.

### Time Rules
- All timestamps are UTC ISO-8601 with `Z`.
- `createdAtUtc` values are fixed constants.
- `asOfUtc` is supplied by the request context and copied verbatim into each StockRow.

### Filters
- Stock filters (`hubId`, `binId`, `itemId`) are applied strictly.
- If a filter references a non-existent in-tenant entity, return NOT_FOUND (404).
- Unknown filters MUST return BAD_REQUEST (400).

### Prohibited Behavior
- No tenant override via query, body, or headers.
- No pagination.
- No sorting outside the contract.
- No inferred relationships.
- No silent failures.

### Replacement Notice
- This placeholder store exists only for B2.
- It MUST be removed or fully replaced when ledger-backed read models are introduced.
