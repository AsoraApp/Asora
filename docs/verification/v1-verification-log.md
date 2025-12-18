# ASORA v1 — VERIFICATION LOG (EVIDENCE-ONLY)

## Status
IN PROGRESS

## Scope
Asora v1 verification record under v1 freeze (C1).

## Rules of Evidence
- Each test case is valid only if it includes:
  - real request (method + path + headers + body)
  - real response (status + body + headers if relevant)
  - real audit evidence (eventType + tenantId + ts + requestId correlation if available)
- No “expected” language.
- If any required evidence is missing, mark **UNVERIFIED**.

## Environment
- Base URL:
- Verification operator:
- Date (UTC):
- Build stamp / version string:
- Notes:

---

## 1) Authentication & Authorization Semantics (B1, B11, B13)

### Test Case 1.1 — Missing auth → 401

Invariant / Guarantee:
Missing auth returns deterministic 401 error envelope.

Phase(s):
B1, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 1.2 — Invalid auth → 401

Invariant / Guarantee:
Invalid auth returns deterministic 401 error envelope.

Phase(s):
B1, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 1.3 — Auth valid, tenant unresolved → 403

Invariant / Guarantee:
Auth valid but tenant unresolved returns deterministic 403 error envelope.

Phase(s):
B1, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 1.4 — Auth valid, role insufficient → 403

Invariant / Guarantee:
Auth valid but role insufficient returns deterministic 403 error envelope.

Phase(s):
B11, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

## 2) Tenant Isolation (B1, B2, B3, B13)

### Test Case 2.1 — Cross-tenant read attempt fails

Invariant / Guarantee:
Cross-tenant access attempts fail; no tenant leakage.

Phase(s):
B1, B2, B13

Request:
- Method:
- Path:
- Headers (show session/tenant A):
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId (should reflect session-derived tenant only):
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 2.2 — Tenant override via body rejected

Invariant / Guarantee:
Tenant ID cannot be overridden via request body.

Phase(s):
B1, B3, B13

Request:
- Method:
- Path:
- Headers (valid auth):
- Body (include attempted tenantId override):

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 2.3 — Tenant override via query rejected

Invariant / Guarantee:
Tenant ID cannot be overridden via query string.

Phase(s):
B1, B2, B13

Request:
- Method:
- Path (include tenant override in query):
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 2.4 — Tenant override via headers rejected

Invariant / Guarantee:
Tenant ID cannot be overridden via headers.

Phase(s):
B1, B2, B13

Request:
- Method:
- Path:
- Headers (include attempted tenant override header):
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

## 3) Ledger Invariants (B3, B4, B7)

### Test Case 3.1 — Ledger event append-only (create event)

Invariant / Guarantee:
Ledger events append-only; create produces a new event and does not mutate history.

Phase(s):
B3

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body (include created event id if returned):

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 3.2 — No mutation possible (attempt update)

Invariant / Guarantee:
No mutation of ledger event possible.

Phase(s):
B3, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 3.3 — No deletion possible (attempt delete)

Invariant / Guarantee:
No deletion of ledger event possible.

Phase(s):
B3, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 3.4 — Inventory quantities derive from ledger replay

Invariant / Guarantee:
Inventory quantity truth derives from ledger replay (not mutable counters).

Phase(s):
B3, B4, B7

Request:
- Method:
- Path(s) (ledger read / report / inventory read used):
- Headers:
- Body:

Response:
- Status:
- Body (include the fields proving replay output):

Audit Evidence:
- eventType(s):
- tenantId:
- ts(s):
- requestId(s):
- raw audit snippet(s):

Result:
UNVERIFIED

Notes:

---

### Test Case 3.5 — Cycle count reconciliation deterministic

Invariant / Guarantee:
Cycle count reconciliation behavior is deterministic given identical inputs and ledger state.

Phase(s):
B4, B7

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Result:
UNVERIFIED

Notes:

---

## 4) Inventory Write Paths (B2, B4, B6, B7)

### Test Case 4.1 — Item creation

Invariant / Guarantee:
Item creation succeeds (within constraints) and emits audit evidence; ledger impact recorded if applicable.

Phase(s):
B2, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Ledger Impact (if applicable):
- eventType:
- eventId:
- ts:
- raw ledger snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 4.2 — Category creation

Invariant / Guarantee:
Category creation succeeds and emits audit evidence.

Phase(s):
B2, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 4.3 — Hub creation

Invariant / Guarantee:
Hub creation succeeds and emits audit evidence.

Phase(s):
B2, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 4.4 — Bin creation

Invariant / Guarantee:
Bin creation succeeds and emits audit evidence.

Phase(s):
B2, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 4.5 — Vendor creation

Invariant / Guarantee:
Vendor creation succeeds and emits audit evidence.

Phase(s):
B6, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 4.6 — Procurement receiving → ledger entry

Invariant / Guarantee:
Receiving produces a ledger entry and audit evidence; inventory truth updates via ledger.

Phase(s):
B6, B7, B3, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Ledger Impact:
- eventType:
- eventId:
- ts:
- raw ledger snippet:

Result:
UNVERIFIED

Notes:

---

## 5) Deterministic Reporting & Exports (B8)

### Test Case 5.1 — Report generation

Invariant / Guarantee:
Report generation returns deterministic output for the same ledger state and parameters.

Phase(s):
B8

Request:
- Method:
- Path:
- Headers:
- Body / Query params:

Response:
- Status:
- Body (include sample rows / totals / reconciliation fields):

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 5.2 — Export execution + stable column ordering + deterministic filename

Invariant / Guarantee:
Exports have stable column order and deterministic filenames; export emits audit evidence.

Phase(s):
B8, B13

Request:
- Method:
- Path:
- Headers:
- Body / Query params:

Response:
- Status:
- Headers (include Content-Disposition / filename if applicable):
- Body (first lines if CSV; do not omit header row):

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

## 6) Plan Enforcement (Commercial Constraints) (B12)

### Test Case 6.1 — Operation within plan limit → success

Invariant / Guarantee:
Operation within plan limit succeeds and is auditable.

Phase(s):
B12, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Result:
UNVERIFIED

Notes:

---

### Test Case 6.2 — Operation exceeding limit → 403 + fail-closed + plan.violation audit

Invariant / Guarantee:
Operation exceeding plan limit fails closed with 403 and emits plan.violation audit with correct fields.

Phase(s):
B12, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType: plan.violation
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

## 7) Integrations (Additive Observers) (B14)

### Test Case 7.1 — Integration creation (within plan)

Invariant / Guarantee:
Integration creation succeeds (within plan) and emits audit evidence.

Phase(s):
B14, B12, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 7.2 — Enable/disable integration

Invariant / Guarantee:
Enable/disable is auditable and does not mutate ledger.

Phase(s):
B14, B3, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Ledger Evidence (no mutation):
- proof method used (ledger read / checksum / event count):
- output snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 7.3 — Payload enqueue

Invariant / Guarantee:
Payload enqueue is recorded; no direct ledger mutation possible.

Phase(s):
B14, B3, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Ledger Evidence (no mutation):
- proof method used:
- output snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 7.4 — Dispatch attempt

Invariant / Guarantee:
Dispatch attempt is auditable.

Phase(s):
B14, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Result:
UNVERIFIED

Notes:

---

### Test Case 7.5 — Dispatch failure path

Invariant / Guarantee:
Dispatch failure is recorded with deterministic handling.

Phase(s):
B14, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Result:
UNVERIFIED

Notes:

---

### Test Case 7.6 — Dispatch success path

Invariant / Guarantee:
Dispatch success is recorded.

Phase(s):
B14, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Result:
UNVERIFIED

Notes:

---

### Test Case 7.7 — Integration cannot mutate ledger (negative test)

Invariant / Guarantee:
No ledger mutation possible via integration endpoints.

Phase(s):
B14, B3, B13

Request:
- Method:
- Path:
- Headers:
- Body (attempted ledger-like mutation payload):

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Ledger Evidence (no mutation):
- proof method used:
- output snippet:

Result:
UNVERIFIED

Notes:

---

## 8) Alerts & Notifications (Evaluative Only) (B10)

### Test Case 8.1 — Alert evaluation emits events

Invariant / Guarantee:
Alert evaluation emits audit evidence and does not mutate inventory truth.

Phase(s):
B10, B3, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Ledger Evidence (no mutation):
- proof method used:
- output snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 8.2 — Notification generation is evaluative only

Invariant / Guarantee:
Notifications do not mutate inventory truth; behavior is deterministic for identical state.

Phase(s):
B10, B3, B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType(s):
- tenantId:
- ts:
- requestId:
- raw audit snippet(s):

Ledger Evidence (no mutation):
- proof method used:
- output snippet:

Result:
UNVERIFIED

Notes:

---

## 9) Error Determinism & Route Surface (B13)

### Test Case 9.1 — Unknown route → deterministic 404

Invariant / Guarantee:
Unknown route returns deterministic 404 error envelope.

Phase(s):
B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 9.2 — Unsupported method → deterministic response

Invariant / Guarantee:
Unsupported method returns deterministic response.

Phase(s):
B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body:

Audit Evidence:
- eventType:
- tenantId:
- ts:
- requestId:
- raw audit snippet:

Result:
UNVERIFIED

Notes:

---

### Test Case 9.3 — Error envelope consistency (error, code, details)

Invariant / Guarantee:
Error envelopes are consistent across failures: error, code, details.

Phase(s):
B13

Request:
- Method:
- Path:
- Headers:
- Body:

Response:
- Status:
- Body (capture multiple examples or link to the cases above):

Audit Evidence:
- eventType(s):
- tenantId(s):
- ts(s):
- requestId(s):
- raw audit snippet(s):

Result:
UNVERIFIED

Notes:

---

## Completion Checklist (Evidence-Only)
- [ ] Every section contains at least one VERIFIED test case
- [ ] All failure modes above recorded (not skipped)
- [ ] Plan violations include plan.violation audit evidence
- [ ] No “expected” language present
- [ ] Any missing evidence explicitly marked UNVERIFIED
