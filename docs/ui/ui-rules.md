# ASORA UI RULES (AUTHORITATIVE)

## Status
LOCKED (U1)

## Purpose
The UI is a read-only lens over backend truth. The UI must never “improve” or reinterpret system behavior.

## Non-Negotiables (Global)
1) UI reflects backend truth only.
2) UI never infers permissions, plan limits, or outcomes.
3) UI never performs optimistic updates.
4) UI never selects or overrides tenant context.
5) UI never invents derived truth or “computed” totals that are not returned by the API.
6) Ordering, IDs, and timestamps are backend-supplied and treated as canonical.
7) All failures are visible:
   - Error envelopes are displayed verbatim.
   - UI adds only neutral labels; it does not rewrite meaning.
8) No UI-only enforcement logic:
   - No client-side gating beyond “authenticated vs not authenticated” routing.
9) Read-only means read-only:
   - No create/edit/delete.
   - No triggers (exports, integrations, procurement, adjustments).
10) Determinism:
   - Sorting uses backend-provided ordering.
   - If backend provides no ordering guarantee, UI displays in received order.

## Auth & Tenant Context Rules
- UI does not choose tenantId.
- UI reads tenant context only from `/auth/me` (or equivalent) and displays it read-only.
- UI must not store or accept user-supplied tenant identifiers.
- If session is invalid or missing:
  - Show 401 verbatim and route to `/login`.

## Error Handling Rules (Hard)
- The UI must render:
  - HTTP status
  - `error`
  - `code`
  - `details` (including null)
  - `requestId` if present anywhere in the response body
- No hidden retries.
- No “try again” language unless the backend explicitly documents a safe retry semantic for that code.
- Errors must not be collapsed into generic messages.

## Redaction Expectations
- UI must never display secrets, tokens, API keys, or raw authorization headers.
- If backend returns redacted fields, the UI shows them as-is without attempting to “fill in” missing values.
- Audit display must treat any field that may contain sensitive values as display-unsafe unless explicitly returned by the audit endpoint.

## Data Display Rules
- Do not recompute inventory truth from ledger in the UI.
- Use report endpoints for report views; use ledger endpoints for ledger views.
- If the API returns empty arrays or missing objects:
  - Display explicit empty state: “No records returned.”
- If the API returns partial or ambiguous data:
  - Display it exactly; do not infer missing fields.

## Navigation & Routing Rules
- All U1 routes are read-only and must be navigable via authenticated shell.
- Route availability is not permission-inferred:
  - If a user lacks access, they will see the backend error (403, etc.) verbatim on that route.

## Logging / Observability (UI)
- UI may log to browser console for developer visibility only.
- UI must display `requestId` (if present) to support supportability and correlation.

## Prohibitions (U1)
- No create/edit/delete actions.
- No bulk actions.
- No export triggers.
- No integration enable/disable.
- No procurement actions.
- No plan/permission indicators guessed.
- No commercial messaging, upgrades, billing, or plan prompts.

## Acceptance Criteria (U1)
- Every screen renders from real API data.
- Empty states are explicit and non-misleading.
- All backend errors surface verbatim.
- No backend behavior changes were required for UI.
- UI works for:
  - valid user
  - insufficient permission
  - plan-limited tenant
  - empty tenant
