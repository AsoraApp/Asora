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
  if (body && Array.isArray(body.items)) return body.items;
  if (body && Array.isArray(body.data)) return body.data;
  return null;
}

export async function pageList(ctx, { title, path, fallbackPaths = [] }) {
  // Auth probe
  const meRes = await api.tryGet("/auth/me", ctx);
  const meBody = await meRes.safeJson();
  if (!meRes.ok) {
    if (meRes.status === 401) {
      ctx.session = null;
      ctx.router.go("/login");
      return "";
    }
    return renderPageFrame(ctx, { title, contentHtml: renderErrorEnvelope(meRes, meBody) });
  }
  ctx.session = meBody;

  // Fetch primary path, then optional fallback(s).
  let res = await api.tryGet(path, ctx);
  let body = await res.safeJson();

  if (!res.ok && fallbackPaths.length) {
    for (const fp of fallbackPaths) {
      const r2 = await api.tryGet(fp, ctx);
      const b2 = await r2.safeJson();
      if (r2.ok) {
        res = r2; body = b2;
        break;
      }
    }
  }

  if (!res.ok) {
    return renderPageFrame(ctx, { title, contentHtml: renderErrorEnvelope(res, body) });
  }

  const rows = asArray(body) ?? [];
  const empty = rows.length === 0;

  const columns = deriveColumns(rows);

  return renderPageFrame(ctx, {
    title,
    contentHtml: `
      <div class="panel">
        <div class="h1">${escapeHtml(title)}</div>
        <div class="muted">Source: <span class="badge">${escapeHtml(res.status)} GET ${escapeHtml(path)}</span></div>
        <hr/>
        ${
          empty
            ? `<div class="muted">No records returned.</div>`
            : renderTable(rows, columns)
        }
        <hr/>
        <div class="h2">Raw response</div>
        <div class="codebox">${escapeHtml(JSON.stringify(body, null, 2))}</div>
      </div>
    `,
  });
}

function deriveColumns(rows) {
  const keys = new Set();
  for (const r of rows.slice(0, 50)) {
    if (r && typeof r === "object") {
      Object.keys(r).forEach((k) => keys.add(k));
    }
  }
  const cols = Array.from(keys);
  // Prefer common identifiers first, but do not invent:
  const preferred = ["id", "name", "sku", "code", "status", "createdAt", "updatedAt"];
  cols.sort((a, b) => {
    const ia = preferred.indexOf(a);
    const ib = preferred.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return cols.slice(0, 12);
}

function renderTable(rows, cols) {
  return `
    <table class="table">
      <thead>
        <tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            ${cols.map((c) => `<td>${escapeHtml(cellValue(r?.[c]))}</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function cellValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
