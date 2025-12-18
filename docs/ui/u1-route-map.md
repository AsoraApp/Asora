# ASORA U1 ROUTE MAP (READ-ONLY)

## Global Assumptions
- Base API URL is same-origin by default (recommended for cookie/session auth).
- All routes require `/auth/me` to resolve session and tenant context.
- UI does not infer permissions. Each route calls its API and displays result or error verbatim.

---

## /login
Auth state:
- Must be unauthenticated or unknown.

Data source:
- `GET /auth/me` (probe; if 200, redirect to `/`)
- `POST /auth/login` (if present) OR external IdP redirect (if your backend uses that)

UI states:
- If `/auth/me` returns 200: show “Already signed in” and route to `/`.
- If `/auth/me` returns 401: show login form (if supported) or sign-in instructions (if external).
- On login failure: show backend envelope verbatim.

---

## /logout
Auth state:
- Any.

Data source:
- `POST /auth/logout` (if present)
- After completion, `GET /auth/me` should return 401.

UI states:
- Show API response verbatim.
- Route to `/login` only after backend confirms logout semantics.

---

## / (authenticated shell)
Auth state:
- Must be authenticated.

Data source:
- `GET /auth/me`

UI states:
- 200: render shell + session panel (tenant, user, roles).
- 401: show envelope; link to `/login`.
- 403: show envelope (invalid tenant context or forbidden); no guessing.

---

## /inventory/items
Data source:
- `GET /inventory/items`

Auth:
- Authenticated (UI still displays 401/403 envelopes).

States:
- 200 with items: list.
- 200 empty: “No records returned.”
- 401/403/404/etc: render error envelope verbatim.

---

## /inventory/categories
Data source:
- `GET /inventory/categories`

Same state rules as items.

---

## /inventory/hubs
Data source:
- `GET /inventory/hubs`

Same state rules as items.

---

## /inventory/bins
Data source:
- `GET /inventory/bins`

Same state rules as items.

---

## /inventory/vendors
Data source:
- `GET /vendors` OR `GET /inventory/vendors` (use your actual backend route)

Same state rules as items.

---

## /ledger
Data source:
- `GET /ledger` OR `GET /ledger/events` (use your actual backend route)

Rules:
- Display append-only list in received order (unless backend guarantees ordering).
- Show: timestamp, eventType/type, delta, references, actor (if present).

States:
- 200 list: render.
- 200 empty: “No records returned.”
- Errors: verbatim envelope.

---

## /reports
Data source (read-only):
- `GET /reports/stock-on-hand`
- `GET /reports/valuation`
- `GET /reports/movement`
(use your actual backend routes; UI does not fabricate reports)

States:
- 200: render each report section using returned payload.
- Empty: explicit empty state per report.
- Errors: verbatim envelope.

---

## /exports (view only)
Data source:
- `GET /exports` OR `GET /reports/exports` (use actual backend route)

Rules:
- No triggers/buttons to create exports.
- Display export history records exactly.

States:
- 200 list / empty / errors verbatim.

---

## /integrations (view only)
Data source:
- `GET /integrations`

Rules:
- Display integrations and status only.
- No enable/disable actions.

States:
- 200 list / empty / errors verbatim.

---

## /audits
Data source:
- `GET /audits` (optionally supports filters: `?eventType=...&from=...&to=...`)

Rules:
- Filter UI may exist but does not “validate” semantics beyond constructing query params.
- Render redacted fields only as provided.

States:
- 200 list / empty / errors verbatim.
