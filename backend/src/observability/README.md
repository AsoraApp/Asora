# Observability – Worker Rules (DO NOT BREAK)

## Audit

- `audit.worker.mjs` is the ONLY audit implementation allowed in Workers.
- `audit.mjs` MUST NOT be imported anywhere in `backend/src/worker/**`.
- Audit must NEVER:
  - block request execution
  - throw on failure
  - perform async work outside `waitUntil`

## Enforcement

- All writes must emit audit
- Audit failure must be swallowed
- Storage is best-effort only
