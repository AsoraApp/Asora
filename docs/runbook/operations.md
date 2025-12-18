# ASORA v1 — OPERATIONS RUNBOOK

## Status

AUTHORITATIVE — v1 (Frozen)

This document is the **single source of operational truth** for running Asora v1 under the C1 system freeze. It describes **what exists**, **how it behaves**, and **how operators must interact with it**. No behavior described here is aspirational.

---

## 1) Operational Scope & Philosophy

### System Boundary

Asora v1 is an **inventory-only, multi-tenant system**. It does **not** manage:

* Work orders
* Maintenance tasks
* Labor
* Scheduling
* Billing or payments

Inventory state is expressed exclusively through **ledger events**. All quantities, valuations, and movements are derived from the ledger.

### Source of Truth

* The **ledger is authoritative**.
* All other collections are **derived, cached, or indexed** representations.
* If derived data conflicts with the ledger, the ledger wins.

### Determinism & Fail-Closed Posture

* Every request resolves to a **deterministic outcome**.
* Ambiguous, malformed, or unauthorized actions **fail closed**.
* Partial success is forbidden.

### Operator Authority

Operators **can**:

* Onboard tenants
* Configure plans and roles
* Monitor audits and reports
* Assist with data seeding and verification

Operators **cannot**:

* Modify ledger history
* Override plan enforcement
* Bypass permissions
* Manually correct inventory quantities

### Relationship to Audits & Verification

* Every meaningful action emits an **audit event**.
* C2 verification logs demonstrate actual runtime behavior.
* Operations must **align with verified behavior**, not assumptions.

---

## 2) Tenant Onboarding Procedure

### Pre‑Onboarding Checklist

Confirm before proceeding:

* Tenant legal/entity identity verified
* Intended inventory scope confirmed
* Plan tier selected (B12)
* Role model chosen (B11)
* Initial hub/bin strategy agreed

### Deterministic Onboarding Order

**Steps must be executed in order.**

1. Assign plan (Free / Pro / Enterprise)
2. Assign role model
3. Create tenant record
4. Seed master data **in this order**:

   1. Categories
   2. Hubs
   3. Bins
   4. Vendors
   5. Items

### Why Order Matters

* Items reference categories and bins
* Receiving requires vendors
* Ledger writes require valid item + bin context

Skipping steps results in **expected validation failures**, not system errors.

### Post‑Onboarding Verification

Operators must verify:

* Item creation succeeds
* Receiving creates ledger events
* Stock on hand report reconciles to ledger
* Exports function within plan limits

### Common Onboarding Errors

| Error               | Meaning                        |
| ------------------- | ------------------------------ |
| VALIDATION_FAILED   | Required parent data missing   |
| PLAN_LIMIT_EXCEEDED | Tenant exceeded plan allowance |
| FORBIDDEN           | Role does not permit action    |

---

## 3) Inventory Operations (Day‑to‑Day)

### Item Lifecycle

* Items are immutable in identity
* Attributes may be updated (within permissions)
* Deletion does **not** erase ledger history

### Receiving Workflow

* Receiving creates **append‑only ledger entries**
* Quantity increases only via ledger writes
* Failed receiving creates **no partial state**

### Vendor Eligibility

* Vendors can be enabled/disabled
* Ineligible vendors block receiving
* Eligibility changes are audited

### Cycle Counts & Discrepancies

* Counts generate reconciliation events
* Adjustments are ledgered, not overwritten
* Discrepancies remain visible historically

### What Cannot Be Undone

* Ledger events
* Audit records
* Export history

Verification is performed by comparing:

* Ledger → derived inventory → reports

---

## 4) Reporting & Exports Operations

### Available Reports (B8)

* Stock on hand
* Inventory movement
* Receiving summary
* Shrink / adjustment summary
* Inventory valuation

### Export Behavior

* Exports are deterministic
* Filenames are stable
* Column order is fixed

### Reconciliation Guidance

* Every export row maps to ledger facts
* Totals must reconcile exactly

### Common Export Failures

* Plan export limit exceeded
* Permission denied
* No data available for scope

---

## 5) Plan Enforcement Awareness (B12)

### What Plan Limits Are

Plans enforce **hard execution ceilings** on:

* Items
* Categories
* Hubs / bins
* Vendors
* Exports
* Integrations

### How Violations Present

* Requests fail with explicit error codes
* No partial writes occur
* Audit events are emitted

### Distinguishing Errors

| Condition           | Meaning               |
| ------------------- | --------------------- |
| PLAN_LIMIT_EXCEEDED | Commercial constraint |
| FORBIDDEN           | Permission issue      |
| VALIDATION_FAILED   | Bad input or state    |

### Operator Guidance

Operators must **never**:

* Attempt data sharding to bypass limits
* Delete data to force room

Escalation path is **commercial**, not technical.

---

## 6) Integrations Operations (B14)

### Integration Control

* Integrations can be enabled or disabled
* Inventory is **never mutated** by integrations

### Dispatch Model

* Payloads are queued
* Dispatch is manual or explicitly invoked
* No automatic retries

### Failure Interpretation

* Dispatch failure does not affect inventory
* Failures are visible via audits

### Redaction Guarantees

Operators will **never see**:

* Secrets
* Tokens
* Tenant credentials

---

## 7) Failure Modes & Safe Responses

### Common Fail‑Closed Scenarios

**401 / 403**

* Meaning: auth or permission failure
* Check: session, role
* Do not retry blindly

**Plan Limit Exceeded**

* Meaning: commercial ceiling reached
* Check: plan assignment
* Escalate via sales path

**Validation Failure**

* Meaning: missing or invalid data
* Check: onboarding order

**Integration Dispatch Failure**

* Meaning: downstream issue
* Inventory unaffected

**Export Blocked**

* Meaning: plan or permission

---

## 8) Recovery & Data Integrity Posture

### Rebuildable From Ledger

* Stock on hand
* Movement history
* Valuation

### Derived vs Primary

* Ledger: primary
* Reports, caches: derived

### Non‑Recoverable

* Deleted derived collections without ledger
* External integration payload loss

Immutability is preserved **by design**, even at operational cost.

No disaster recovery guarantees exist beyond what is implemented.

---

## 9) Operational Do / Do Not List

### Operators Should

* Follow onboarding order
* Verify via ledger‑backed reports
* Escalate plan constraints properly
* Use audits for investigation

### Operators Must Never

* Modify ledger data
* Bypass enforcement
* Manually “fix” quantities
* Promise unsupported recovery

### Common Mistakes

* Treating derived data as truth
* Skipping verification steps
* Assuming retries are safe

Shortcuts are forbidden because they **break determinism and auditability**.

---

## End of Document
