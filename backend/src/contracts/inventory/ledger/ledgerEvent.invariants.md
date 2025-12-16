# B3 Ledger Invariants (Immutable)

These invariants are non-negotiable for B3 (ledger writes only).

## Global
- Ledger is append-only: no update/delete of ledger events.
- Tenant scope is session-derived only; tenantId is never accepted from clients as authority.
- UTC everywhere: store and return timestamps in UTC.
- Event taxonomy is closed and explicit: only allowed enums.
- No direct quantity updates exist anywhere as authority; quantity truth is ledger-derived.

## Event Types (Allowed Only)
- OPENING_BALANCE
- ADJUSTMENT
- MOVE
- RECEIPT

No free-text event types are permitted.

## Quantity Rules
- OPENING_BALANCE: quantity must be integer > 0
- RECEIPT: quantity must be integer > 0
- MOVE: quantity must be integer > 0
- ADJUSTMENT: quantity must be integer != 0 (positive or negative)

## MOVE Rules
- Requires fromHubId/fromBinId and toHubId/toBinId
- from and to cannot be identical (no-op moves forbidden)

## Corrections
- Corrections are only expressed via new compensating events.
- Past ledger events are never edited, deleted, or “reconciled” by automation in B3.
