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
  if (body && Array.isArray(body.audits)) return body.audits;
  if (body && Array.isArray(body.items)) return body.items;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}

function buildQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || String(v).trim() === "") continue;
    q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function pageAudits(ctx) {
  const meRes = await api.tryGet("/auth/me", ctx);
  const meBody = await meRes.safeJson();
  if (!meRes.ok) {
    if (meRes.status === 401) {
      ctx.session = null;
      ctx.router.go("/login");
      return "";
    }
    return renderPageFrame(ctx, { title: "Audits", contentHtml: renderErrorEnvelope(meRes, meBody) });
  }
  ctx.session = meBody;

  // Filters are query-params only; UI does not validate semantics.
  const hash = location.hash || "#/audits";
  const qIndex = hash.indexOf("?");
  const currentParams = new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : "");

  const eventType = currentParams.get("eventType") || "";
  const from = currentParams.get("from") || "";
  const to = currentParams.get("to") || "";

  const query = buildQuery({ eventType, from, to });
  const res = await api.tryGet(`/audits${query}`, ctx);
  const body = await res.safeJson();

  const content = !res.ok
    ? renderErrorEnvelope(res, body)
    : renderAuditTable(asArray(body), body);

  return renderPageFrame(ctx, {
    title: "Audits",
    contentHtml: `
      <div class="panel">
        <div class="h1">Audit Viewer</div>
        <div class="muted">Filterable list. Redacted fields only (as returned by backend).</div>
        <hr/>
        <div class="controls">
          <input class="input" id="eventType" placeholder="eventType" value="${escapeHtml(eventType)}" />
          <input class="input" id="from" placeholder="from (ISO)" value="${escapeHtml(from)}" />
          <input class="input" id="to" placeholder="to (ISO)" value="${escapeHtml(to)}" />
          <button class="btn" id="apply">Apply</button>
        </div>
        <hr/>
        ${content}
      </div>
    `,
    postRender: () => {
      document.getElementById("apply")?.addEventListener("click", () => {
        const next = buildQuery({
          eventType: document.getElementById("eventType")?.value ?? "",
          from: document.getElementById("from")?.value ?? "",
          to: document.getElementById("to")?.value ?? "",
        });
        ctx.router.go(`/audits${next}`);
      });
    },
  });
}

function renderAuditTable(rows, rawBody) {
  const empty = rows.length === 0;

  const table = empty
    ? `<div class="muted">No records returned.</div>`
    : `
      <table class="table">
        <thead>
          <tr>
            <th>ts</th>
            <th>eventType</th>
            <th>actor</th>
            <th>outcome</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((a) => {
            const ts = a.ts ?? a.timestamp ?? a.at ?? null;
            const eventType = a.eventType ?? a.type ?? null;
            const actor = a.actor ?? a.userId ?? a.by ?? null;
            const outcome = a.outcome ?? a.result ?? a.status ?? null;
            return `
              <tr>
                <td>${escapeHtml(String(ts ?? "null"))}</td>
                <td>${escapeHtml(String(eventType ?? "null"))}</td>
                <td>${escapeHtml(String(actor ?? "null"))}</td>
                <td>${escapeHtml(String(outcome ?? "null"))}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;

  return `
    ${table}
    <hr/>
    <div class="h2">Raw response</div>
    <div class="codebox">${escapeHtml(JSON.stringify(rawBody, null, 2))}</div>
  `;
}
