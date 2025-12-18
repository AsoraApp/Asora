# Asora — Product Truth Summary

## What Asora Is
Asora is a **multi-tenant, inventory-only operations platform** designed for property-management organizations operating at scale.  
Its sole responsibility is to provide **deterministic, auditable, ledger-derived inventory truth** across buildings, hubs, bins, vendors, and categories.

Asora treats inventory as a first-class operational asset with strict controls, enforcement, and reconciliation.

## What Asora Is Not
Asora is explicitly **not**:
- A CMMS
- A work-order system
- A dispatch or ticketing platform
- A labor, scheduling, or job-costing system
- A predictive automation engine

Any system behavior that would mutate inventory indirectly (via work orders, tasks, or automation) is intentionally out of scope.

## Ledger-Derived Truth
All inventory quantities, movements, and adjustments in Asora are derived from an **append-only ledger**:
- No in-place mutation of quantity
- Every change is an immutable event
- Current state is a deterministic projection of ledger history

This design ensures:
- Full historical reconstruction
- Shrink attribution
- Audit defensibility
- Deterministic reporting and exports

## Determinism, UTC, and Fail-Closed Philosophy
Asora enforces strict operational discipline:
- **Deterministic execution only** — identical inputs yield identical outputs
- **UTC timestamps only** — no local-time ambiguity
- **Fail-closed on ambiguity** — uncertain or invalid actions are rejected, never partially applied

There are no “best effort” writes.

## Mobile Offline Posture
Asora supports **offline tolerance**, not offline authority:
- Inventory reads may be cached for offline viewing
- Write intents may be captured as **drafts only**
- No offline action mutates inventory truth
- All drafts require full server-side revalidation

Offline mode never bypasses enforcement, plans, or audits.
