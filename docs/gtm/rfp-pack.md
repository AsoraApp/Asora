# Asora — RFP Response Pack (Non-Contractual)

This document provides standard RFP-ready responses.  
All statements are descriptive, not contractual.

---

## Multi-Tenant Isolation
Asora enforces tenant isolation at the session and execution layer.  
Tenants cannot be selected or overridden by clients.

**Reference:** B1 — Auth & Tenant Context

---

## Auditability
All inventory changes emit immutable ledger events and structured audits.  
No destructive updates exist.

**Reference:** B3 — Ledger Model, B11 — Audits

---

## Data Export
All reports reconcile directly to ledger events and support deterministic CSV exports.

**Reference:** B8 — Reporting & Exports

---

## RBAC / Segregation of Duties
Asora supports explicit role-based permissions and separation of duties.  
Authorization is enforced server-side.

**Reference:** B11 — Permissions & SoD

---

## Integrations
Integrations are **additive-only**:
- No integration may mutate inventory directly
- All mutations must pass core enforcement paths

**Reference:** B14 — Integrations

---

## Offline Behavior
Offline mode supports read caching and draft capture only.  
Inventory truth cannot be modified offline.

**Reference:** B9 — Mobile Offline

---

## SLA Posture
Asora does not provide binding SLAs in-product.  
Operational expectations are discussed separately and outside system behavior.

---

## Assumptions & Boundaries
- Asora is inventory-only
- No work-order or CMMS functionality
- No billing or subscription logic
