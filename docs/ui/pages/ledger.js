import { api } from "../api.js";
import { renderPageFrame, renderErrorEnvelope } from "../render.js";

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asArray(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.events)) return body.events;
  if (body && Array.isArray(body.items)) return body.items;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}

export async function pageLedger(ctx) {
  const meRes = await api.tryGet("/auth/me", ctx);
  const meBody = await meRes.safeJson();
  if (!meRes.ok) {
    if (meRes.status === 401) {
      ctx.session = null;
      ctx.router.go("/login");
      return "";
    }
    return renderPageFrame(ctx, { title: "Ledger", contentHtml: renderErrorEnvelope(meRes, meBody) });
  }
  ctx.session = meBody;

  // Use your actual ledger read route. If your backend is /ledger/events, update here.
  let res = await api.tryGet("/ledger", ctx);
  let body = await res.safeJson();

  if (!res.ok) {
    const res2 = await api.tryGet("/ledger/events", ctx);
    const body2 = await res2.safeJson();
    if (res2.ok) { res = res2; body = body2; }
  }

  if (!res.ok) {
    return renderPageFrame(ctx, { title: "Ledger", contentHtml: renderErrorEnvelope(res, body) });
  }

  const events = asArray(body);
  const empty = events.length === 0;

  return renderPageFrame(ctx, {
    title: "Ledger",
    contentHtml: `
      <div class="panel">
        <div class="h1">Ledger Viewer</div>
        <div class="muted">Append-only events. Displayed in backend-provided order.</div>
        <hr/>
        ${
          empty
            ? `<div class="muted">No records returned.</div>`
            : `
              <table class="table">
                <thead>
                  <tr>
                    <th>ts</th>
                    <th>type</th>
                    <th>delta</th>
                    <th>ref</th>
                    <th>actor</th>
                  </tr>
                </thead>
                <tbody>
                  ${events.map((e) => {
                    const ts = e.ts ?? e.timestamp ?? e.at ?? null;
                    const type = e.eventType ?? e.type ?? null;
                    const delta = e.delta ?? e.qtyDelta ?? e.quantityDelta ?? null;
                    const ref = e.ref ?? e.reference ?? e.itemId ?? e.entityId ?? null;
                    const actor = e.actor ?? e.userId ?? e.by ?? null;
                    return `
                      <tr>
                        <td>${escapeHtml(String(ts ?? "null"))}</td>
                        <td>${escapeHtml(String(type ?? "null"))}</td>
                        <td>${escapeHtml(String(delta ?? "null"))}</td>
                        <td>${escapeHtml(String(ref ?? "null"))}</td>
                        <td>${escapeHtml(String(actor ?? "null"))}</td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            `
        }
        <hr/>
        <div class="h2">Raw response</div>
        <div class="codebox">${escapeHtml(JSON.stringify(body, null, 2))}</div>
      </div>
    `,
  });
}
