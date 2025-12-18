# ASORA UI ERROR STATE CONTRACT

## Rule: Render the Envelope
For any non-2xx response, UI must display:
- HTTP status
- `error`
- `code`
- `details`
- `requestId` (if present)
No masking, no retries, no optimistic fallbacks.

---

## Standard Envelopes

### 401 Unauthorized
HTTP:
- 401

Body:
- `error`: `UNAUTHORIZED`
- `code`: `AUTH_REQUIRED` (or equivalent)
- `details`: may be null

UI copy (neutral):
- “Authentication required.”

Operator guidance:
- “Verify session credentials are present and valid. Use requestId for correlation.”

---

### 403 Forbidden
HTTP:
- 403

Body:
- `error`: `FORBIDDEN`
- `code`: e.g., `TENANT_REQUIRED`, `INSUFFICIENT_ROLE`, `PERMISSION_DENIED`
- `details`: optional

UI copy:
- “Access forbidden.”

Operator guidance:
- “User is authenticated but not authorized for this route/action. Do not request overrides.”

---

### 404 Not Found
HTTP:
- 404

Body:
- `error`: `NOT_FOUND`
- `code`: `ROUTE_NOT_FOUND` (or equivalent)

UI copy:
- “Resource or route not found.”

Operator guidance:
- “Confirm URL and deployed build stamp. If API route is missing, treat as configuration/deploy mismatch.”

---

### 409 Conflict
HTTP:
- 409

Body:
- `error`: `CONFLICT`
- `code`: conflict-specific (e.g., `ETAG_MISMATCH`, `STATE_CONFLICT`, `DUPLICATE_ID`)
- `details`: optional

UI copy:
- “Conflict.”

Operator guidance:
- “Backend refused operation due to conflicting state. In U1, UI is read-only; 409 may indicate upstream issues or misrouted endpoint.”

---

## Validation Errors
HTTP:
- typically 400

Body:
- `error`: `BAD_REQUEST`
- `code`: validation code (e.g., `INVALID_BODY_OBJECT`, `MISSING_FIELD`, `INVALID_ENUM`)
- `details`: may contain field paths

UI copy:
- “Bad request.”

Operator guidance:
- “UI should not emit writes in U1; validation errors usually indicate API misuse or endpoint mismatch.”

---

## Plan Violations
HTTP:
- typically 403 or 409 (backend-defined)

Body:
- `error`: e.g., `FORBIDDEN` or `CONFLICT`
- `code`: e.g., `PLAN_LIMIT_EXCEEDED`, `PLAN_EXPORTS_BLOCKED`, etc.
- `details`: may include limit name/metric

UI copy:
- “Plan constraint enforced.”

Operator guidance:
- “Plan limits are commercial constraints. Support does not override behavior.”

---

## Retry Language Policy
- UI must not suggest retry unless the backend explicitly documents safe retry for that `code`.
- UI may provide a neutral action:
  - “Reload page” (only if it simply repeats the same GET and does not risk duplication).
  - Otherwise: no retry CTA.

---

## Presentation Format (Required)
UI must show a structured block:
- Status: <number>
- error: <string>
- code: <string>
- details: <json|null>
- requestId: <string|null>
