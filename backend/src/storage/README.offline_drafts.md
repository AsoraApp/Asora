# Offline Draft Storage (B9)

Tenant collection name: `offline_drafts`

This is **not** ledger truth and must never be used to infer inventory state.

Each record is append-only at the collection level (clientDraftId duplicates are rejected deterministically).

## Record shape

- draftId (sha256(tenantId|draftType|clientDraftId))
- tenantId
- draftType: CYCLE_COUNT | RECEIPT
- state: DRAFT (only)
- clientDraftId
- capturedAtUtc (ISO 8601 UTC)
- deviceId (opaque)
- receivedAtUtc (ISO 8601 UTC)
- receivedByUserId (nullable)
- correlationId (nullable)
- payload (raw draft JSON)
- payloadHash (sha256(JSON.stringify(payload)))

## Deterministic rejection codes

- INVALID_JSON_OBJECT
- INVALID_CLIENT_DRAFT_ID
- INVALID_CAPTURED_AT_UTC
- INVALID_DEVICE_ID
- UNSUPPORTED_DRAFT_TYPE
- MISSING_HUB_ID / MISSING_BIN_ID / MISSING_COUNTS
- INVALID_COUNT_ROW / INVALID_QTY
- MISSING_PO_ID / MISSING_LINES
- INVALID_RECEIPT_LINE / INVALID_QTY_RECEIVED
- HUB_NOT_FOUND / BIN_NOT_FOUND / ITEM_NOT_FOUND / PO_NOT_FOUND
- DRAFT_ALREADY_EXISTS
- AMBIGUOUS_STATE
