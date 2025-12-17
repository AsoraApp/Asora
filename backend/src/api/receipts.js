// backend/src/api/receipts.js
const crypto = require("crypto");
const { ok, created } = require("./http");
const { fail, assert } = require("./errors");
const { getById, list, upsertById } = require("../storage/jsonStore");
const { checkIdempotency, putIdempotency } = require("../storage/idempotency");
const { vendorEligibilityGate } = require("../domain/vendorEligibilityGate");
const { appendLedgerEvent } = require("../ledger/append");

function nowUtc() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

function getIdemKey(req) {
  return req.headers["idempotency-key"] || req.headers["Idempotency-Key"] || null;
}

function parsePath(pathname) {
  return pathname.split("/").filter(Boolean);
}

function receiptTransitionGuard(current, next) {
  const allowed = {
    DRAFT: ["POSTED"],
    POSTED: [],
    VOIDED: [],
  };
  return (allowed[current] || []).includes(next);
}

function computePoStatus(po) {
  const lines = po.lines || [];
  const allReceived = lines.every(
    (ln) => Number(ln.quantityReceivedToDate || 0) >= Number(ln.quantityOrdered || 0)
  );
  const anyReceived = lines.some((ln) => Number(ln.quantityReceivedToDate || 0) > 0);

  if (po.status === "CANCELLED") return "CANCELLED";
  if (allReceived) return "CLOSED";
  if (anyReceived) return "PARTIALLY_RECEIVED";
  return po.status;
}

function sanitizeReceiptLines(lines) {
  assert(Array.isArray(lines), "INVALID_REQUEST", "lines must be an array");
  lines.forEach((ln, i) => {
    assert(ln && typeof ln === "object", "INVALID_REQUEST", "line must be an object", { index: i });
    assert(ln.lineId, "INVALID_REQUEST", "lineId is required (deterministic)", { index: i });
    assert(
      Number.isFinite(Number(ln.quantityReceivedThisReceipt)) && Number(ln.quantityReceivedThisReceipt) >= 0,
      "INVALID_REQUEST",
      "quantityReceivedThisReceipt must be a number >= 0",
      { index: i }
    );
  });
  return lines.map((ln) => ({
    lineId: String(ln.lineId),
    quantityReceivedThisReceipt: Number(ln.quantityReceivedThisReceipt),
    hubId: ln.hubId ? String(ln.hubId) : null,
    binId: ln.binId ? String(ln.binId) : null,
    notes: ln.notes ? String(ln.notes) : null,
  }));
}

async function receiptsRouter(req, res, ctx) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const parts = parsePath(path);

  if (parts[0] !== "api") return false;

  try {
    // POST /api/receipts/from-po/:poId (create DRAFT receipt)
    if (req.method === "POST" && parts[1] === "receipts" && parts[2] === "from-po" && parts[3]) {
      const poId = String(parts[3]);
      const po = getById(ctx.tenantId, "purchase_orders", "poId", poId);
      if (!po) return fail(res, "NOT_FOUND", "Purchase order not found");
      if (po.status === "CANCELLED") return fail(res, "STATE_CONFLICT", "PO is cancelled");
      if (po.status === "CLOSED") return fail(res, "STATE_CONFLICT", "PO is closed");

      // Eligibility enforcement at receipt creation point (B6 requirement)
      vendorEligibilityGate(ctx, String(po.vendorId));

      const receiptId = newId();
      const createdAtUtc = nowUtc();

      const receipt = {
        receiptId,
        tenantId: ctx.tenantId,
        status: "DRAFT",
        poId: String(poId),
        vendorId: String(po.vendorId),
        createdAtUtc,
        updatedAtUtc: createdAtUtc,
        postedAtUtc: null,
        voidedAtUtc: null,
        lines: (po.lines || []).map((ln) => ({
          lineId: String(ln.lineId),
          skuId: String(ln.skuId),
          quantityOrdered: Number(ln.quantityOrdered),
          quantityReceivedToDateAtCreation: Number(ln.quantityReceivedToDate || 0),
          quantityReceivedThisReceipt: 0,
          hubId: null,
          binId: null,
          notes: null,
        })),
      };

      upsertById(ctx.tenantId, "receipts", "receiptId", receipt);
      return created(res, { receipt });
    }

    // GET /api/receipts
    if (req.method === "GET" && parts[1] === "receipts" && parts.length === 2) {
      const items = list(ctx.tenantId, "receipts");
      return ok(res, { receipts: items });
    }

    // GET /api/receipts/:receiptId
    if (req.method === "GET" && parts[1] === "receipts" && parts[2] && parts.length === 3) {
      const receiptId = String(parts[2]);
      const receipt = getById(ctx.tenantId, "receipts", "receiptId", receiptId);
      if (!receipt) return fail(res, "NOT_FOUND", "Receipt not found");
      return ok(res, { receipt });
    }

    // PUT /api/receipts/:receiptId (DRAFT only)
    if (req.method === "PUT" && parts[1] === "receipts" && parts[2] && parts.length === 3) {
      const receiptId = String(parts[2]);
      const receipt = getById(ctx.tenantId, "receipts", "receiptId", receiptId);
      if (!receipt) return fail(res, "NOT_FOUND", "Receipt not found");
      if (receipt.status !== "DRAFT") return fail(res, "STATE_CONFLICT", "Receipt is not editable");

      const po = getById(ctx.tenantId, "purchase_orders", "poId", String(receipt.poId));
      if (!po) return fail(res, "NOT_FOUND", "Purchase order not found");

      // Eligibility enforcement while drafting (fail-closed)
      vendorEligibilityGate(ctx, String(po.vendorId));

      const body = ctx.body || {};
      assert(body && typeof body === "object", "INVALID_REQUEST", "Body must be an object");
      assert(body.lines !== undefined, "INVALID_REQUEST", "lines is required (deterministic replace)");

      const incoming = sanitizeReceiptLines(body.lines);

      // Deterministic replace: lineIds must match PO lines exactly
      const poLineIds = new Set((po.lines || []).map((x) => String(x.lineId)));
      const incomingIds = new Set(incoming.map((x) => String(x.lineId)));
      assert(
        poLineIds.size === incomingIds.size &&
          [...poLineIds].every((id) => incomingIds.has(id)),
        "INVALID_REQUEST",
        "lines must include exactly the PO lineIds"
      );

      // Validate not over-receiving vs current PO received-to-date
      const lineById = new Map((po.lines || []).map((ln) => [String(ln.lineId), ln]));
      incoming.forEach((ln) => {
        const pol = lineById.get(String(ln.lineId));
        const ordered = Number(pol.quantityOrdered);
        const receivedToDate = Number(pol.quantityReceivedToDate || 0);
        const remaining = Math.max(0, ordered - receivedToDate);
        if (Number(ln.quantityReceivedThisReceipt) > remaining) {
          const err = new Error("Received quantity exceeds remaining quantity");
          err.code = "CONFLICT";
          err.details = { lineId: String(ln.lineId), remaining };
          throw err;
        }
      });

      const nextLines = receipt.lines.map((rl) => {
        const upd = incoming.find((x) => String(x.lineId) === String(rl.lineId));
        return {
          ...rl,
          quantityReceivedThisReceipt: Number(upd.quantityReceivedThisReceipt),
          hubId: upd.hubId,
          binId: upd.binId,
          notes: upd.notes,
        };
      });

      const next = {
        ...receipt,
        lines: nextLines,
        updatedAtUtc: nowUtc(),
      };

      upsertById(ctx.tenantId, "receipts", "receiptId", next);
      return ok(res, { receipt: next });
    }

    // POST /api/receipts/:receiptId/post (append-only ledger receipt events; idempotent)
    if (req.method === "POST" && parts[1] === "receipts" && parts[2] && parts[3] === "post") {
      const receiptId = String(parts[2]);
      const idemKey = getIdemKey(req);
      if (!idemKey) return fail(res, "INVALID_REQUEST", "Missing Idempotency-Key header");

      const receipt = getById(ctx.tenantId, "receipts", "receiptId", receiptId);
      if (!receipt) return fail(res, "NOT_FOUND", "Receipt not found");

      const idem = checkIdempotency({
        tenantId: ctx.tenantId,
        namespace: `receipt.post.${receiptId}`,
        idemKey: String(idemKey),
        requestBody: { receiptId },
      });
      if (idem.hit) return ok(res, idem.response);

      if (!receiptTransitionGuard(receipt.status, "POSTED")) {
        return fail(res, "STATE_CONFLICT", "Invalid state transition");
      }

      const po = getById(ctx.tenantId, "purchase_orders", "poId", String(receipt.poId));
      if (!po) return fail(res, "NOT_FOUND", "Purchase order not found");
      if (po.status === "CANCELLED") return fail(res, "STATE_CONFLICT", "PO is cancelled");
      if (po.status === "CLOSED") return fail(res, "STATE_CONFLICT", "PO is closed");

      // Enforce vendor eligibility on posting
      vendorEligibilityGate(ctx, String(po.vendorId));

      // Validate receipt lines vs PO remaining at post time (revalidate deterministically)
      const poLineById = new Map((po.lines || []).map((ln) => [String(ln.lineId), ln]));
      const postable = [];
      for (const rl of receipt.lines || []) {
        const pol = poLineById.get(String(rl.lineId));
        assert(pol, "INVALID_REQUEST", "Receipt lineId not found on PO", { lineId: String(rl.lineId) });

        const ordered = Number(pol.quantityOrdered);
        const receivedToDate = Number(pol.quantityReceivedToDate || 0);
        const remaining = Math.max(0, ordered - receivedToDate);

        const qty = Number(rl.quantityReceivedThisReceipt || 0);
        if (qty < 0) return fail(res, "INVALID_REQUEST", "quantityReceivedThisReceipt must be >= 0");
        if (qty > remaining) return fail(res, "CONFLICT", "Received quantity exceeds remaining", { lineId: rl.lineId, remaining });

        if (qty > 0) {
          postable.push({
            lineId: String(rl.lineId),
            skuId: String(rl.skuId),
            quantity: qty,
            hubId: rl.hubId ? String(rl.hubId) : null,
            binId: rl.binId ? String(rl.binId) : null,
          });
        }
      }

      if (postable.length === 0) return fail(res, "INVALID_REQUEST", "Nothing to receive");

      // Append one ledger event for this receipt (receipt-level idempotency enforced here)
      const ledgerOut = appendLedgerEvent(ctx, {
        namespace: `ledger.receipt.${receiptId}`,
        idempotencyKey: `receipt:${receiptId}:${String(idemKey)}`,
        event: {
          eventType: "RECEIPT",
          occurredAtUtc: nowUtc(),
          objectType: "receipt",
          objectId: String(receiptId),
          lines: postable.map((x) => ({
            skuId: x.skuId,
            quantity: x.quantity,
            hubId: x.hubId,
            binId: x.binId,
          })),
          facts: {
            poId: String(po.poId),
            receiptId: String(receiptId),
            vendorId: String(po.vendorId),
          },
        },
      });

      // Update PO received-to-date deterministically
      const updatedPoLines = (po.lines || []).map((ln) => {
        const hit = postable.find((p) => String(p.lineId) === String(ln.lineId));
        if (!hit) return ln;
        return {
          ...ln,
          quantityReceivedToDate: Number(ln.quantityReceivedToDate || 0) + Number(hit.quantity),
        };
      });

      const updatedPo = {
        ...po,
        lines: updatedPoLines,
        totals: {
          ...(po.totals || {}),
          quantityReceivedToDate: updatedPoLines.reduce((a, x) => a + Number(x.quantityReceivedToDate || 0), 0),
        },
        updatedAtUtc: nowUtc(),
      };

      // PO status update (partial vs full)
      const nextStatus = computePoStatus(updatedPo);
      if (nextStatus !== updatedPo.status) {
        // Guarded transition (fail-closed if unexpected)
        const allowed = {
          DRAFT: ["PARTIALLY_RECEIVED", "CLOSED"],
          ISSUED: ["PARTIALLY_RECEIVED", "CLOSED"],
          PARTIALLY_RECEIVED: ["CLOSED"],
          CLOSED: [],
          CANCELLED: [],
        };
        const okNext = (allowed[updatedPo.status] || []).includes(nextStatus) || updatedPo.status === nextStatus;
        assert(okNext, "STATE_CONFLICT", "Invalid PO state transition", { from: updatedPo.status, to: nextStatus });
        updatedPo.status = nextStatus;
        if (nextStatus === "CLOSED") updatedPo.closedAtUtc = nowUtc();
      }

      upsertById(ctx.tenantId, "purchase_orders", "poId", updatedPo);

      // Mark receipt as POSTED
      const receiptNext = {
        ...receipt,
        status: "POSTED",
        postedAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
        ledgerEventId: ledgerOut.ledgerEvent.ledgerEventId,
      };
      upsertById(ctx.tenantId, "receipts", "receiptId", receiptNext);

      const response = { receipt: receiptNext, purchaseOrder: updatedPo, ledgerEvent: ledgerOut.ledgerEvent };
      putIdempotency(ctx.tenantId, `receipt.post.${receiptId}`, String(idemKey), idem.fingerprint, response);
      return ok(res, response);
    }

    return false;
  } catch (e) {
    return fail(res, e.code || "INVALID_REQUEST", e.message, e.details);
  }
}

module.exports = receiptsRouter;
