# ASORA — Canonical Build Phase Index (B0–B15)

This document is the single authoritative index of Asora’s backend system intent.
It defines what each build phase establishes, what it explicitly does not cover,
and how enterprise guarantees are composed across phases.

---

## B0 — Repository Governance & Global Constraints
**Objective:** Establish non-negotiable system boundaries and development rules.

**Core Guarantees:**
- Inventory-only scope
- Deterministic, fail-closed behavior
- No side effects without ledger or audit evidence

**Explicitly Out of Scope:**
- Work orders, CMMS, scheduling, labor, billing

**Dependencies:** None

**Pointers:**
- README.md
- Global build rules

**Truth Claim:**  
_Asora is intentionally constrained to prevent scope leakage and non-auditable behavior._

---

## B1 — Authentication & Tenant Context
**Objective:** Ensure every request is authenticated and tenant-scoped.

**Core Guarantees:**
- Session-derived tenant isolation
- No client-supplied tenant identifiers
- Fail-closed auth resolution

**Out of Scope:**
- User provisioning UI
- SSO federation

**Dependencies:** B0

**Pointers:**
- auth/
- domain/requestContext

**Truth Claim:**  
_No action can execute without a verified tenant context._

---

## B2 — Inventory Read Model
**Objective:** Provide safe, read-only access to inventory structure.

**Core Guarantees:**
- Reads cannot mutate state
- Tenant-scoped visibility
- Structural clarity (items, hubs, bins)

**Out of Scope:**
- Analytics
- Forecasting

**Dependencies:** B1

**Pointers:**
- api/inventory/*
- controllers/inventory/*

**Truth Claim:**  
_Read access is safe, bounded, and non-authoritative._

---

## B3 — Ledger Write Model (Source of Truth)
**Objective:** Establish append-only ledger as the sole quantity authority.

**Core Guarantees:**
- Immutability
- Time-ordered events
- Deterministic reconciliation

**Out of Scope:**
- Ledger mutation
- Rollbacks

**Dependencies:** B1

**Pointers:**
- ledger/write
- domain/ledger

**Truth Claim:**  
_Inventory truth exists only as a sequence of ledger events._

---

## B4 — Audit Emission
**Objective:** Emit structured audit events for every significant action.

**Core Guarantees:**
- Action traceability
- Actor attribution
- Failure visibility

**Out of Scope:**
- SIEM forwarding
- Retention policy

**Dependencies:** B1–B3

**Pointers:**
- observability/audit

**Truth Claim:**  
_No meaningful action occurs without an audit footprint._

---

## B5 — Vendor Governance & Eligibility
**Objective:** Prevent non-compliant vendors from participating in inventory flow.

**Core Guarantees:**
- Eligibility checks before use
- Deterministic rejection

**Out of Scope:**
- Vendor onboarding UX
- Contract management

**Dependencies:** B3, B4

**Pointers:**
- domain/vendors
- api/vendors

**Truth Claim:**  
_Vendors are governed entities, not free-form references._

---

## B6 — Procurement Lifecycle
**Objective:** Formalize requisition → PO → receiving.

**Core Guarantees:**
- Explicit state transitions
- Approval enforcement
- Ledger-backed receiving

**Out of Scope:**
- Pricing optimization
- Supplier portals

**Dependencies:** B3–B5

**Pointers:**
- api/requisitions
- api/purchaseOrders

**Truth Claim:**  
_Inventory acquisition is intentional, approved, and traceable._

---

## B7 — Receiving & Adjustments
**Objective:** Control inventory inflow and corrective actions.

**Core Guarantees:**
- Adjustment justification
- Ledger-backed corrections

**Out of Scope:**
- Automated shrink recovery

**Dependencies:** B3, B6

**Pointers:**
- api/receiving
- api/adjustments

**Truth Claim:**  
_All corrections are explicit and auditable._

---

## B8 — Reporting & Exports
**Objective:** Produce deterministic, ledger-backed reports.

**Core Guarantees:**
- Reconciliation to ledger
- Stable exports

**Out of Scope:**
- BI dashboards
- Custom formulas

**Dependencies:** B3

**Pointers:**
- domain/reports
- exports/

**Truth Claim:**  
_Reports are evidence, not interpretations._

---

## B9 — Mobile Offline (Read + Draft Only)
**Objective:** Allow offline tolerance without offline authority.

**Core Guarantees:**
- No offline mutation
- Server revalidation

**Out of Scope:**
- Offline sync authority

**Dependencies:** B2, B3

**Pointers:**
- domain/offline

**Truth Claim:**  
_Offline mode cannot corrupt truth._

---

## B10 — Alerts & Notifications
**Objective:** Surface conditions without side effects.

**Core Guarantees:**
- Non-mutating alerts
- Deterministic triggers

**Out of Scope:**
- Automated remediation

**Dependencies:** B3, B4

**Pointers:**
- domain/alerts
- api/notifications

**Truth Claim:**  
_Alerts inform; they do not act._

---

## B11 — Roles, Permissions & SoD
**Objective:** Enforce role-based authorization.

**Core Guarantees:**
- Least privilege
- Separation of duties

**Out of Scope:**
- Org chart modeling

**Dependencies:** B1

**Pointers:**
- domain/rbac

**Truth Claim:**  
_Authority is explicit and bounded._

---

## B12 — Plans, Limits & Commercial Enforcement
**Objective:** Enforce hard backend limits per tenant.

**Core Guarantees:**
- Fail-closed overages
- Audit on violation

**Out of Scope:**
- Billing
- Payments

**Dependencies:** B3, B11

**Pointers:**
- domain/plans
- enforcement hooks

**Truth Claim:**  
_Plans are execution constraints, not pricing ideas._

---

## B13 — Security Hardening
**Objective:** Reduce blast radius and ambiguity.

**Core Guarantees:**
- Deterministic errors
- No silent failures

**Out of Scope:**
- Pen testing automation

**Dependencies:** All prior

**Pointers:**
- middleware/*
- error handling

**Truth Claim:**  
_Asora fails loudly, clearly, and safely._

---

## B14 — Integrations (Additive Only)
**Objective:** Allow external systems without authority leakage.

**Core Guarantees:**
- No write authority
- Kill-switchable

**Out of Scope:**
- Two-way sync

**Dependencies:** B3, B4

**Pointers:**
- integrations/

**Truth Claim:**  
_Integrations observe; they do not decide._

---

## B15 — Go-To-Market Readiness Pack
**Objective:** Translate system truth into buyer language.

**Core Guarantees:**
- No behavior change
- Accurate mapping

**Out of Scope:**
- Marketing copy

**Dependencies:** B0–B14

**Pointers:**
- docs/gtm

**Truth Claim:**  
_Asora can be sold without misrepresentation._

---
