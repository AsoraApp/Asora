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
  if (body && Array.isArray(body.exports)) return body.exports;
  if (body && Array.isArray(body.items)) return body.items;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}

export async function pageExports(ctx) {
  const meRes = await api.tryGet("/auth/me", ctx);
  const meBody = await meRes.safeJson();
  if (!meRes.ok) {
    if (meRes.status === 401) {
      ctx.session = null;
      ctx.router.go("/login");
      return "";
    }
    return renderPageFrame(ctx, { title: "Exports", contentHtml: renderErrorEnvelope(meRes, meBody) });
  }
  ctx.session = meBody;

  let res = await api.tryGet("/exports", ctx);
  let body = await res.safeJson();
  if (!res.ok) {
    const res2 = await api.tryGet("/reports/exports", ctx);
    const body2 = await res2.safeJson();
    if (res2.ok) { res = res2; body = body2; }
  }

  if (!res.ok) {
    return renderPageFrame(ctx, { title: "Exports", contentHtml: renderErrorEnvelope(res, body) });
  }

  const rows = asArray(body);
  const empty = rows.length === 0;

  return renderPageFrame(ctx, {
    title: "Exports",
    contentHtml: `
      <div class="panel">
        <div class="h1">Exports Viewer (History Only)</div>
        <div class="muted">No triggers. Status only.</div>
        <hr/>
        ${empty ? `<div class="muted">No records returned.</div>` : `
          <table class="table">
            <thead>
              <tr>
                <th>filename</th>
                <th>status</th>
                <th>ts</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((e) => {
                const filename = e.filename ?? e.file ?? e.name ?? null;
                const status = e.status ?? e.state ?? null;
                const ts = e.ts ?? e.createdAt ?? e.at ?? null;
                return `
                  <tr>
                    <td>${escapeHtml(String(filename ?? "null"))}</td>
                    <td>${escapeHtml(String(status ?? "null"))}</td>
                    <td>${escapeHtml(String(ts ?? "null"))}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        `}
        <hr/>
        <div class="h2">Raw response</div>
        <div class="codebox">${escapeHtml(JSON.stringify(body, null, 2))}</div>
      </div>
    `,
  });
}
