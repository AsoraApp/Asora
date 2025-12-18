`docs/runbook/support.md`

# ASORA v1 — SUPPORT & INCIDENT PLAYBOOK

**Canonical Support Manual**
**Phase D2 (Spec-Only)**

---

## 1) Support Philosophy & Boundaries

### Core Principles

Asora v1 support operates under strict boundaries designed to preserve determinism, auditability, and tenant trust.

Support **does not**:

* Override system behavior
* Bypass enforcement logic
* Mutate ledger state
* Grant hidden access
* Create exceptions to plans, permissions, or validation rules

Support **does**:

* Explain system behavior accurately
* Interpret audit evidence
* Help customers resolve issues *within* the system’s guarantees
* Route commercial or roadmap requests appropriately

### Non-Negotiable Boundaries

* **Fail-closed errors are signals, not bugs.**
  They indicate an explicit rule was violated or a required condition was not met.

* **The ledger is the authoritative source of truth.**
  Inventory quantities are never manually edited or “fixed” by support.

* **Plan limits are commercial constraints.**
  They are enforced intentionally and are not technical failures.

* **All support actions must be auditable.**
  Any investigation or explanation must reference concrete evidence (audit events, requestId).

**Purpose:**
Prevent “just fix it” behavior that undermines trust, breaks determinism, or creates hidden state.

---

## 2) Issue Intake & Classification

All incoming support requests must be classified into **exactly one** primary category before investigation begins.

### Classification Buckets

#### A) Authentication Issue

**Examples:** Cannot log in, session expired, unauthorized error at entry point

* Initial checks:

  * Missing or malformed auth headers
  * Session expiration
* Required info:

  * Timestamp (UTC)
  * Endpoint accessed
  * requestId (if available)
* Expected response:

  * Same business day acknowledgment

#### B) Authorization / Permission Issue

**Examples:** 403 errors, access denied to a resource

* Initial checks:

  * Role / permission assignment
  * Tenant context resolution
* Required info:

  * User identity
  * Action attempted
  * requestId
* Expected response:

  * Same business day acknowledgment

#### C) Plan Enforcement Issue

**Examples:** Cannot create item, export blocked, integration limit hit

* Initial checks:

  * Tenant plan
  * Relevant plan limit
* Required info:

  * Tenant ID
  * Action attempted
  * requestId
* Expected response:

  * Same business day acknowledgment

#### D) Validation Error

**Examples:** 400 errors, invalid input

* Initial checks:

  * Required fields
  * Field constraints
* Required info:

  * Payload sent
  * requestId
* Expected response:

  * Same business day acknowledgment

#### E) Inventory Discrepancy Concern

**Examples:** “Counts don’t match expectations”

* Initial checks:

  * Ledger history
  * Cycle count events
* Required info:

  * Item / hub / bin identifiers
  * Time range
* Expected response:

  * Within 1 business day

#### F) Export / Reporting Issue

**Examples:** Missing rows, failed export

* Initial checks:

  * Permissions
  * Plan limits
* Required info:

  * Export type
  * Timestamp
  * requestId
* Expected response:

  * Within 1 business day

#### G) Integration Issue

**Examples:** Integration not firing, no downstream effect

* Initial checks:

  * Enablement status
  * Dispatch attempts
* Required info:

  * Integration name
  * Time window
* Expected response:

  * Within 1 business day

#### H) Suspected Bug

**Examples:** Behavior contradicts documented guarantees

* Initial checks:

  * Audit evidence
  * Determinism review
* Required info:

  * Full reproduction steps
  * requestId(s)
* Expected response:

  * Acknowledgment within 1 business day

---

## 3) Common Scenarios & Playbooks

### A) “User Cannot Create Item / Hub / Vendor”

#### Investigation Steps

1. Identify tenant and user
2. Locate the requestId
3. Inspect audit event:

   * Check for plan enforcement
   * Check for permission denial
   * Check validation failures

#### Determination

* **Plan violation:** limit reached
* **RBAC issue:** insufficient permission
* **Validation error:** malformed or incomplete input

#### What to Tell the Customer

* Clearly state **which rule** blocked the action
* Reference the audit outcome
* Explain next steps (e.g., plan upgrade, permission change)

#### What Not to Promise

* Temporary bypass
* Manual creation
* Silent overrides

---

### B) “Inventory Quantity Looks Wrong”

#### Ledger-First Process

1. Identify item, hub, bin
2. Retrieve full ledger history
3. Review:

   * Receipts
   * Issues
   * Adjustments
   * Cycle counts

#### Explanation Guidance

* Quantities are derived from ledger events
* No hidden or mutable balances exist
* Cycle counts reconcile discrepancies by recording adjustments, not overwriting history

#### Determination

* **User expectation mismatch**
* **Unrecorded movement**
* **Correctly reconciled adjustment**

Manual corrections are **never** performed.

---

### C) “Export Failed or Is Missing Data”

#### Investigation Steps

1. Confirm permission to export
2. Confirm plan allows export
3. Validate data exists in ledger
4. Confirm deterministic filename and scope

#### Safe Retry Rules

* Retries are allowed if:

  * Same parameters
  * Same tenant
* Retries do not change underlying data

---

### D) “Integration Isn’t Working”

#### Investigation Steps

1. Verify integration is enabled
2. Inspect dispatch audit events
3. Review payload attempt logs

#### Semantics to Explain

* Integrations are **outbound only**
* They **observe** inventory state
* They **cannot mutate inventory**

Failure may still indicate correct internal behavior.

---

### E) “Customer Wants an Exception”

#### Common Requests

* Temporary plan bypass
* Manual inventory edit
* Hidden permissions

#### Required Response

* Explain why the system cannot do this
* Reference auditability and determinism
* Offer:

  * Commercial escalation (plan change)
  * Roadmap feedback channel

Support never implements exceptions.

---

## 4) Error Code Interpretation Guide

| HTTP | error        | code                | Meaning              | Typical Causes        | Support Response         |
| ---- | ------------ | ------------------- | -------------------- | --------------------- | ------------------------ |
| 401  | UNAUTHORIZED | AUTH_REQUIRED       | Missing auth         | No session            | Explain auth requirement |
| 403  | FORBIDDEN    | PERMISSION_DENIED   | Access blocked       | Role insufficient     | Review permissions       |
| 404  | NOT_FOUND    | ROUTE_NOT_FOUND     | Invalid path         | Typo / wrong endpoint | Confirm API usage        |
| 409  | CONFLICT     | STATE_CONFLICT      | Illegal state change | Double submit         | Explain conflict         |
| 400  | BAD_REQUEST  | VALIDATION_FAILED   | Invalid input        | Missing fields        | Explain validation       |
| 403  | FORBIDDEN    | PLAN_LIMIT_EXCEEDED | Plan enforcement     | Limit reached         | Explain plan constraint  |

---

## 5) Incident Severity Levels

### Sev 1 — Data Integrity Risk

* Examples: Ledger corruption indicators
* Action: Immediate escalation
* Communication: Incident notice

### Sev 2 — Systemwide Blockage

* Examples: All tenants blocked
* Action: Engineering escalation
* Communication: Status update

### Sev 3 — Tenant-Specific Failure

* Examples: One tenant blocked
* Action: Audit review, possible escalation
* Communication: Direct response

### Sev 4 — UX / Misunderstanding

* Examples: Fail-closed confusion
* Action: Education
* Communication: Documentation-based explanation

---

## 6) Audit-First Investigation Workflow

Support **must** follow this order:

1. Identify tenant
2. Identify requestId
3. Locate audit event
4. Interpret outcome
5. Correlate with user report

**Rules**

* No action without audit context
* Screenshots alone are insufficient
* Verbal descriptions are non-authoritative

---

## 7) Escalation Rules

### Escalate to Engineering Only If

* Evidence suggests violation of locked guarantees
* Determinism appears broken
* Data integrity risk exists

### Required Evidence

* requestId
* Audit event(s)
* Exact timestamps
* Tenant ID

### Never Escalated

* Plan limit complaints
* Permission denials
* Validation errors
* Feature requests

### Feature Requests (B16+)

* Logged separately
* Not acted on by support

---

## 8) Communication Standards (Enterprise-Safe)

Support communications must:

* Be factual and calm
* Reference system rules
* Avoid speculation
* Avoid promises beyond v1
* Point to documentation when possible

Never imply:

* System mistakes without evidence
* Temporary fixes
* Future features as commitments

---

## 9) Support Do / Do Not List

### Approved Actions

* Explain audit outcomes
* Guide correct usage
* Clarify limits and permissions
* Route commercial discussions

### Forbidden Actions

* Manual ledger edits
* Hidden overrides
* Silent fixes
* “One-off” exceptions

### Common Traps

* Treating fail-closed as error
* Accepting screenshots as proof
* Promising engineering changes

**Why Dangerous:**
They break determinism, undermine audit trust, and create hidden state.
