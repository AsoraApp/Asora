## Response Envelope

### Success (200)
```json
{
  "data": {},
  "meta": {
    "asOfUtc": "2025-12-15T01:23:45.678Z",
    "requestId": "string"
  }
}
```

### Error (4xx/5xx)
```json
{
  "error": {
    "code": "STRING",
    "message": "STRING",
    "requestId": "string"
  }
}
```

## Hub
```json
{
  "hubId": "string",
  "displayName": "string",
  "code": "string",
  "status": "ACTIVE",
  "createdAtUtc": "2025-12-15T01:23:45.678Z"
}
```

## Bin
```json
{
  "binId": "string",
  "hubId": "string",
  "label": "string",
  "path": "string",
  "status": "ACTIVE",
  "createdAtUtc": "2025-12-15T01:23:45.678Z"
}
```

## Item
```json
{
  "itemId": "string",
  "sku": "string",
  "displayName": "string",
  "uom": "EA",
  "status": "ACTIVE",
  "createdAtUtc": "2025-12-15T01:23:45.678Z"
}
```

## StockRow
```json
{
  "hubId": "string",
  "binId": "string",
  "itemId": "string",
  "sku": "string",
  "qtyOnHand": 0,
  "qtyAvailable": 0,
  "asOfUtc": "2025-12-15T01:23:45.678Z"
}
```

## Sorting Rules
- GET /api/hubs → displayName ASC, hubId ASC
- GET /api/hubs/:hubId/bins → label ASC, binId ASC
- GET /api/items → sku ASC, itemId ASC
- GET /api/stock → itemId ASC, hubId ASC, binId ASC

## Error Codes
- 401 UNAUTHENTICATED
- 403 TENANT_UNRESOLVED
- 400 BAD_REQUEST (includes any tenant override)
- 404 NOT_FOUND (includes cross-tenant access)
- 500 INTERNAL

## Endpoint Map
- GET /api/hubs
- GET /api/hubs/:hubId
- GET /api/hubs/:hubId/bins
- GET /api/bins/:binId
- GET /api/items
- GET /api/items/:itemId
- GET /api/items/by-sku/:sku
- GET /api/stock
