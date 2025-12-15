# Asora — Architecture Decision Records (ADR)

This directory contains Architecture Decision Records (ADRs).
ADRs govern structural, architectural, and governance decisions.

## When an ADR Is Required

An ADR is required when a decision:
- Affects system behavior or invariants
- Changes data flow, authority, or responsibility
- Clarifies ambiguity in specs
- Introduces or rejects an architectural approach

ADRs do NOT replace specs. They govern decisions around them.

## ADR Lifecycle

1. **Proposed**
   - Created as a new file: `ADR-000X-title.md`
   - Opened via Pull Request
   - Must reference relevant spec(s)

2. **Accepted (LOCKED)**
   - PR approved and merged
   - Title is updated to start with: `LOCKED —`
   - File must never be edited again

3. **Superseded**
   - A newer ADR explicitly replaces it
   - Original ADR remains unchanged

## Locking Rules (Strict)

- LOCKED ADRs are immutable.
- No edits, rewrites, or retroactive clarification.
- All changes require a new ADR.

## ADR Naming Convention

