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
  if (body && Array.isArray(body.integrations)) return body.integrations;
  if (body && Array.isArray(body.items)) return body.items;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}

export async function pageIntegrations(ctx) {
  const meRes = await api.tryGet("/auth/me", ctx);
  const meBody = await meRes.safeJson();
  if (!meRes.ok) {
    if (meRes.status === 401) {
      ctx.session = null;
      ctx.router.go("/login");
      return "";
    }
    return renderPageFrame(ctx, { title: "Integrations", contentHtml: renderErrorEnvelope(meRes, meBody) });
  }
  ctx.session = meBody;

  const res = await api.tryGet("/integrations", ctx);
  const body = await res.safeJson();

  if (!res.ok) {
    return renderPageFrame(ctx, { title: "Integrations", contentHtml: renderErrorEnvelope(res, body) });
  }

  const rows = asArray(body);
  const empty = rows.length === 0;

  return renderPageFrame(ctx, {
    title: "Integrations",
    contentHtml: `
      <div class="panel">
        <div class="h1">Integrations Viewer (Status Only)</div>
        <div class="muted">No enable/disable actions.</div>
        <hr/>
        ${empty ? `<div class="muted">No records returned.</div>` : `
          <table class="table">
            <thead>
              <tr>
                <th>name</th>
                <th>status</th>
                <th>details</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((i) => {
                const name = i.name ?? i.key ?? i.id ?? null;
                const status = i.status ?? (i.enabled === true ? "enabled" : (i.enabled === false ? "disabled" : null));
                const details = i.details ?? i.meta ?? null;
                return `
                  <tr>
                    <td>${escapeHtml(String(name ?? "null"))}</td>
                    <td>${escapeHtml(String(status ?? "null"))}</td>
                    <td>${escapeHtml(details === null ? "null" : JSON.stringify(details))}</td>
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
