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

async function fetchFirstOk(ctx, paths) {
  for (const p of paths) {
    const r = await api.tryGet(p, ctx);
    const b = await r.safeJson();
    if (r.ok) return { ok: true, path: p, res: r, body: b };
    // If last, return failure
    if (p === paths[paths.length - 1]) return { ok: false, path: p, res: r, body: b };
  }
  return { ok: false, path: paths[0], res: null, body: null };
}

export async function pageReports(ctx) {
  const meRes = await api.tryGet("/auth/me", ctx);
  const meBody = await meRes.safeJson();
  if (!meRes.ok) {
    if (meRes.status === 401) {
      ctx.session = null;
      ctx.router.go("/login");
      return "";
    }
    return renderPageFrame(ctx, { title: "Reports", contentHtml: renderErrorEnvelope(meRes, meBody) });
  }
  ctx.session = meBody;

  const stock = await fetchFirstOk(ctx, ["/reports/stock-on-hand", "/reports/stock", "/reporting/stock-on-hand"]);
  const valuation = await fetchFirstOk(ctx, ["/reports/valuation", "/reporting/valuation"]);
  const movement = await fetchFirstOk(ctx, ["/reports/movement", "/reports/movements", "/reporting/movement"]);

  const section = (label, r) => {
    if (!r.res) return "";
    if (!r.ok) return `
      <div class="panel">
        <div class="h1">${escapeHtml(label)}</div>
        ${renderErrorEnvelope(r.res, r.body)}
      </div>
    `;
    const isEmpty =
      r.body === null ||
      (Array.isArray(r.body) && r.body.length === 0) ||
      (typeof r.body === "object" && r.body && Object.keys(r.body).length === 0);

    return `
      <div class="panel">
        <div class="h1">${escapeHtml(label)}</div>
        <div class="muted">Source: <span class="badge">GET ${escapeHtml(r.path)}</span></div>
        <hr/>
        ${isEmpty ? `<div class="muted">No records returned.</div>` : ``}
        <div class="codebox">${escapeHtml(JSON.stringify(r.body, null, 2))}</div>
      </div>
    `;
  };

  return renderPageFrame(ctx, {
    title: "Reports",
    contentHtml: `
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${section("Stock on Hand", stock)}
        ${section("Valuation Snapshot", valuation)}
        ${section("Movement Summary", movement)}
      </div>
    `,
  });
}
