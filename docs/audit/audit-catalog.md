# ASORA v1 — AUDIT CATALOG & EVIDENCE INDEX

## 1) Audit Philosophy (v1)

Asora v1 operates under a strict, append-only audit posture. Audit records are treated as immutable operational evidence and are never edited or deleted once emitted.

Audits are designed to emit on both:
- **Successful actions**, and
- **Meaningful rejections or fail-closed enforcement paths**

All audit payloads are deterministic in structure, timestamped in **UTC ISO 8601**, and scoped strictly to the tenant derived from session context.

Audit records intentionally exclude secrets, tokens, credentials, or authorization material. Payloads are designed to be safe for support review, security inspection, export, and external audit.

Verification reference:  
All claims in this document are evaluated against  
**ASORA v1 — VERIFICATION LOG (EVIDENCE-ONLY)** (Phase C2).

---

## 2) Standard Audit Envelope

All audit events in Asora v1 are expected to conform to a consistent envelope.

### Required Fields

- **eventType** (string, always present)  
  Namespaced identifier describing the audited action.

- **ts** (string, always present)  
  UTC timestamp in ISO 8601 format.

- **tenantId** (string or null)  
  Tenant derived from session context.  
  May be null only when tenant resolution fails prior to assignment.

- **actor** (object, always present)
  - **type**: `"user"` or `"system"`
  - **id**: string or null
  - **label**: string or null

- **request** (object, always present)
  - **requestId** (string)
  - **method** (string)
  - **path** (string)

- **outcome** (object, always present)
  - **status**: `"success" | "rejection" | "failure"`
  - **httpStatus**: number
  - **code**: string or null
  - **details**: object or null

### Nullability Rules

- `actor.id`, `actor.label` may be null for system or unauthenticated actions.
- `outcome.details` may be null.
- Secrets are never present (see Section 4).

Evidence status:  
Envelope structure is **DOCUMENTED**, but **NOT VERIFIED** in C2 due to absence of captured audit payloads.

---

## 3) Audit Event Families (Exhaustive)

> Important:  
> Per C3 constraints, **no new audit events are invented here**.  
> Where audit emission is not proven in C2, coverage is explicitly marked **UNVERIFIED**.

---

### auth.*

- **Phases**: B1, B11, B13  
- **Triggers**:
  - Missing authentication
  - Invalid authentication
- **Emitted On**:
  - Rejection paths (401)
- **Evidence Reference**:
  - C2 §1.1 – §1.4
- **Verification Status**: **UNVERIFIED**

---

### tenant.*

- **Phases**: B1, B2, B3, B13  
- **Triggers**:
  - Tenant resolution
  - Tenant override attempts (body, query, headers)
- **Emitted On**:
  - Rejection paths (403)
- **Evidence Reference**:
  - C2 §2.1 – §2.4
- **Verification Status**: **UNVERIFIED**

---

### inventory.*

- **Phases**: B2, B4, B6, B7, B13  
- **Triggers**:
  - Item, category, hub, bin creation
- **Emitted On**:
  - Successful writes
  - Rejections
- **Evidence Reference**:
  - C2 §4.1 – §4.4
- **Verification Status**: **UNVERIFIED**

---

### ledger.*

- **Phases**: B3, B4, B7, B13  
- **Triggers**:
  - Ledger append attempts
  - Invalid mutation attempts
- **Emitted On**:
  - Successful append
  - Rejection of update/delete
- **Evidence Reference**:
  - C2 §3.1 – §3.4
- **Verification Status**: **UNVERIFIED**

---

### cycle_count.*

- **Phases**: B4, B7  
- **Triggers**:
  - Cycle count reconciliation
- **Evidence Reference**:
  - C2 §3.5
- **Verification Status**: **UNVERIFIED**

---

### vendor.*

- **Phases**: B6, B13  
- **Triggers**:
  - Vendor creation
  - Eligibility/compliance evaluation
- **Evidence Reference**:
  - C2 §4.5
- **Verification Status**: **UNVERIFIED**

---

### procurement.*

- **Phases**: B6, B7, B13  
- **Triggers**:
  - Requisition, PO, receiving workflows
- **Evidence Reference**:
  - C2 §4.6
- **Verification Status**: **UNVERIFIED**

---

### receiving.*

- **Phases**: B6, B7, B3, B13  
- **Triggers**:
  - Receiving posting
- **Evidence Reference**:
  - C2 §4.6
- **Verification Status**: **UNVERIFIED**

---

### report.*

- **Phases**: B8  
- **Triggers**:
  - Report generation
- **Evidence Reference**:
  - C2 §5.1
- **Verification Status**: **UNVERIFIED**

---

### export.*

- **Phases**: B8, B13  
- **Triggers**:
  - CSV export execution
- **Evidence Reference**:
  - C2 §5.2
- **Verification Status**: **UNVERIFIED**

---

### alert.*

- **Phases**: B10, B13  
- **Triggers**:
  - Alert evaluation
  - Notification generation
- **Evidence Reference**:
  - C2 §8.1 – §8.2
- **Verification Status**: **UNVERIFIED**

---

### integration.*

- **Phases**: B14  
- **Triggers**:
  - Integration lifecycle actions
- **Evidence Reference**:
  - C2 §7.1 – §7.7
- **Verification Status**: **UNVERIFIED**

---

### plan.violation

- **Phases**: B12, B13  
- **Triggers**:
  - Any operation exceeding plan limits
- **Emitted On**:
  - Rejection only (fail-closed)
- **Evidence Reference**:
  - C2 §6.2
- **Verification Status**: **UNVERIFIED**

---

### security.*

- **Phases**: B13  
- **Triggers**:
  - Unknown routes
  - Unsupported methods
  - Deterministic error envelopes
- **Evidence Reference**:
  - C2 §9.1 – §9.3
- **Verification Status**: **UNVERIFIED**

---

## 4) Redaction & Sensitive Data Policy

The following are **never logged** in audit payloads:

- Authorization headers
- Tokens
- Cookies
- Secrets
- Credentials

If sensitive input must be referenced, it is replaced with a deterministic placeholder:

