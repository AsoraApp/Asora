# Asora — Specification Index (B00–B15)

This directory contains the authoritative functional specifications for Asora.
All product behavior must be derived from these specs.

## Locking Rules (Non-Negotiable)

- Specs are authoritative over memory, assumptions, or code.
- Once a spec is marked **LOCKED**, it must never be edited.
- Changes require a new spec or a superseding ADR.
- Code may only be written against LOCKED specs.

## Spec Index

| ID  | Name | Status |
|-----|------|--------|
| B00 | Foundation | LOCKED |
| B01 | Auth & Tenant Provisioning | LOCKED |
| B02 | Inventory Read Model (Hub-First, Read-Only) | LOCKED |
| B03 | Inventory Ledger & Write Operations | LOCKED |
| B04 | Cycle Counts & Variance Approval | LOCKED |
| B05 | Vendor Compliance & Eligibility | LOCKED |
| B06 | Procurement Lifecycle (Req → PO → Receiving) | LOCKED |
| B07 | RFQs & Vendor Comparison | LOCKED |
| B08 | Reporting & Exports | LOCKED |
| B09 | Mobile Offline (Read + Draft Capture Only) | LOCKED |
| B10 | Alerts & Thresholds (Observer-Only) | LOCKED |
| B11 | RBAC & Separation of Duties | LOCKED |
| B12 | Tenant Provisioning & Billing (Plan Gating) | LOCKED |
| B13 | Enterprise Readiness | LOCKED |
| B14 | Integrations (Strictly Additive) | LOCKED |
| B15 | Go-To-Market Readiness Pack | LOCKED |

## Enforcement

Any implementation, PR, or discussion that conflicts with a LOCKED spec
is invalid and must be rejected.
