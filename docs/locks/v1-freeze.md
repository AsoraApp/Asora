# ASORA v1 — SYSTEM FREEZE & SPEC LOCK

## Status
LOCKED

## Effective Date
<UTC DATE OF COMMIT>

## Scope
This document formally locks Asora v1 as defined by build phases B0–B15.

No behavior, schema, or enforcement semantics defined in these phases may be modified without an explicit, versioned expansion proposal (B16+).

---

## Locked Build Phases

The following phases collectively define Asora v1:

- B0 — Global Constraints & MVP Cutline
- B1 — Authentication & Tenant Context
- B2 — Inventory Read Models
- B3 — Append-Only Inventory Ledger
- B4 — Cycle Counts & Reconciliation
- B5 — Vendor Governance & Eligibility
- B6 — Procurement Lifecycle (Requisitions → POs → Receiving)
- B7 — Receiving & Ledger Integration
- B8 — Reporting & Deterministic Exports
- B9 — Mobile Offline (Reads + Draft Capture Only)
- B10 — Alerts & Notifications (Evaluative Only)
- B11 — Roles, Permissions & Separation of Duties
- B12 — Plans, Limits & Commercial Enforcement
- B13 — Security Posture & Audit Hardening
- B14 — Integrations (Strictly Additive Observers)
- B15 — Go-To-Market Readiness Pack (Spec-Only)

These phases are immutable for v1.

---

## Core Invariants (Non-Negotiable)

The following invariants define Asora’s identity and may not be weakened:

- Inventory-only system (no CMMS, work orders, dispatch, labor, or job costing)
- Ledger-derived inventory truth (append-only, immutable)
- Tenant-scoped isolation everywhere (session-derived only)
- Deterministic behavior over convenience
- UTC timestamps everywhere
- Fail-closed on ambiguity
- Auditable outcomes for success and rejection
- Plans as execution constraints, not billing logic
- Integrations are additive observers only

---

## Explicitly Out of Scope (v1)

The following are explicitly excluded from Asora v1:

- Billing, payments, subscriptions, invoicing
- UI-driven enforcement logic
- Client-selected tenant context
- Two-way or authoritative integrations
- Offline inventory mutation
- Implicit automation or background mutation
- SLA guarantees or uptime commitments

---

## Change Control Policy

Any modification to locked behavior requires:

1. A new, versioned build phase (B16+)
2. Explicit documentation of:
   - New guarantees
   - New failure modes
   - Audit implications
3. A new lock document for the subsequent version

No exceptions.

---

## Enforcement

- Pull requests that alter locked behavior without a corresponding B16+ phase are invalid.
- Sales, support, or UI requirements do not override this lock.
- This document is the final authority on what Asora v1 is and is not.

---

## Intent

This freeze exists to ensure that Asora remains:

- Technically defensible
- Enterprise-auditable
- Operationally reliable
- Resistant to scope erosion

Asora v1 is complete.
