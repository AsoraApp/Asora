// backend/src/worker/ledger.write.worker.mjs
import { emitAudit } from "../observability/audit.mjs";
import { authorizeRequestOrThrow, authzErrorEnvelope, authzDenialReason } from "../auth/authorization.worker.mjs";

function json(statusCode, body, headersObj) {
  const h = new Headers(headersObj || {});
  h.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: statusCode, headers: h });
}

export async function writeLedgerEventFromJson(req, env, rctx, tenant) {
  // U11: Explicit ledger write authorization check (fail-closed)
  try {
    authorizeRequestOrThrow({ req, session: rctx.session });
  } catch (err) {
    try {
      await emitAudit(env, {
        type: "authz.denied",
        requestId: rctx.requestId,
        tenantId: rctx.session?.tenantId ?? null,
        actorId: rctx.session?.actorId ?? null,
        authLevel: rctx.session?.authLevel ?? null,
        method: (req.method || "POST").toUpperCase(),
        route: new URL(req.url).pathname,
        ok: false,
        at: rctx.now,
        details: {
          reason: authzDenialReason(err),
          envelope: authzErrorEnvelope(err),
          scope: "ledger.write",
        },
      });
    } catch {
      // never throw from audit
    }

    return json(403, authzErrorEnvelope(err), { "x-request-id": rctx.requestId });
  }

  // At this point the actor is authorized for ledger writes.
  // IMPORTANT: Do not mix authorization logic into ledger math.
  // Your existing ledger append-only implementation continues below unchanged.

  // ---- BEGIN: existing implementation (keep your current behavior) ----
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "BAD_REQUEST", code: "INVALID_JSON", details: null }, { "x-request-id": rctx.requestId });
  }

  // The rest of your ledger write logic should remain exactly as it was:
  // - validate event shape
  // - append to ledger store
  // - emit success audit
  // - return deterministic envelope
  //
  // If your repo already has this logic below, paste it here unchanged.
  return json(
    501,
    {
      error: "NOT_IMPLEMENTED",
      code: "LEDGER_WRITE_STUB",
      details: {
        note: "Paste your existing ledger write implementation here unchanged (U11 only adds authz gating).",
      },
    },
    { "x-request-id": rctx.requestId },
  );
  // ---- END: existing implementation ----
}
