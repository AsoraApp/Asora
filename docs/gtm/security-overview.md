# Asora — Security & Compliance Overview

## Threat Boundaries
Asora is designed around explicit containment:
- Tenant isolation enforced at session resolution
- No cross-tenant data access paths
- All writes require validated tenant context

## Audit Event Categories
Audits are emitted for:
- Authentication failures
- Authorization violations
- Ledger writes
- Plan limit violations
- Vendor eligibility failures

## Data Handling & Redaction
Asora stores only operational inventory data.  
No PII beyond user identifiers required for access control.

Sensitive values are excluded from logs and audits by design.

## Integration Safety Model
Integrations:
- Cannot bypass enforcement
- Cannot mutate inventory state directly
- Operate through validated, additive interfaces

## Change Management Posture
All changes follow:
- Branch-based development
- PR review discipline
- Explicit phase locking
- Deterministic deployments

There is no direct production mutation.
