function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderAppShell(appEl, { loading, headerRightHtml, bodyHtml } = {}) {
  appEl.innerHTML = `
    <div class="topbar">
      <div class="brand">Asora — UI (U1 Read-Only)</div>
      <div>${headerRightHtml || (loading ? `<span class="badge">Loading</span>` : ``)}</div>
    </div>
    <div class="container">
      ${bodyHtml || (loading ? `<div class="panel"><div class="h1">Loading</div><div class="muted">Resolving session…</div></div>` : ``)}
    </div>
  `;
}

export function renderPageFrame(ctx, { title, contentHtml, postRender } = {}) {
  if (postRender) ctx.__postRender = postRender;

  const nav = renderNav(ctx);
  const sessionPanel = renderSessionPanel(ctx);

  return `
    <div class="topbar">
      <div class="brand">Asora — UI (U1 Read-Only)</div>
      <div class="nav">
        <a class="badge" href="#/login">Login</a>
        <a class="badge" href="#/logout">Logout</a>
      </div>
    </div>
    <div class="container">
      <div class="grid">
        <div>
          <div class="panel">
            <div class="h1">${escapeHtml(title || "Asora")}</div>
            <div class="muted">Read-only UI. Backend truth only.</div>
          </div>
          <div style="height:12px"></div>
          ${sessionPanel}
          <div style="height:12px"></div>
          ${nav}
        </div>
        <div>
          ${contentHtml || `<div class="panel"><div class="muted">No content.</div></div>`}
        </div>
      </div>
    </div>
  `;
}

function renderNav(ctx) {
  return `
    <div class="panel">
      <div class="h2">Routes (Read-Only)</div>
      <div class="nav" style="flex-direction:column; gap:8px;">
        <a href="#/">/</a>
        <a href="#/inventory/items">/inventory/items</a>
        <a href="#/inventory/categories">/inventory/categories</a>
        <a href="#/inventory/hubs">/inventory/hubs</a>
        <a href="#/inventory/bins">/inventory/bins</a>
        <a href="#/inventory/vendors">/inventory/vendors</a>
        <a href="#/ledger">/ledger</a>
        <a href="#/reports">/reports</a>
        <a href="#/exports">/exports</a>
        <a href="#/integrations">/integrations</a>
        <a href="#/audits">/audits</a>
      </div>
    </div>
  `;
}

function renderSessionPanel(ctx) {
  const s = ctx.session;
  if (!s) {
    return `
      <div class="panel">
        <div class="h2">Session</div>
        <div class="muted">No authenticated session loaded.</div>
      </div>
    `;
  }

  // UI does not assume schema; it renders common fields if present.
  const tenantId = s.tenantId ?? s.tenant?.id ?? null;
  const tenantName = s.tenantName ?? s.tenant?.name ?? null;
  const userId = s.userId ?? s.user?.id ?? null;
  const email = s.email ?? s.user?.email ?? null;
  const roles = s.roles ?? s.user?.roles ?? null;

  return `
    <div class="panel">
      <div class="h2">Session (Backend Truth)</div>
      <div class="kv">
        <div class="k">tenantId</div><div>${escapeHtml(String(tenantId ?? "null"))}</div>
        <div class="k">tenantName</div><div>${escapeHtml(String(tenantName ?? "null"))}</div>
        <div class="k">userId</div><div>${escapeHtml(String(userId ?? "null"))}</div>
        <div class="k">email</div><div>${escapeHtml(String(email ?? "null"))}</div>
        <div class="k">roles</div><div>${escapeHtml(JSON.stringify(roles ?? null))}</div>
      </div>
      <hr/>
      <div class="h2">Raw /auth/me</div>
      <div class="codebox">${escapeHtml(JSON.stringify(s, null, 2))}</div>
    </div>
  `;
}

export function renderErrorEnvelope(resWrap, body) {
  const status = resWrap?.status ?? "unknown";
  const envelope = body ?? { error: "UNKNOWN_ERROR", code: "NO_JSON_BODY", details: null };

  const requestId =
    envelope?.requestId ??
    envelope?.meta?.requestId ??
    null;

  const display = {
    status,
    error: envelope?.error ?? null,
    code: envelope?.code ?? null,
    details: envelope?.details ?? null,
    requestId,
    raw: envelope,
  };

  return `
    <div class="panel">
      <div class="h1">Error</div>
      <div class="muted">Backend error envelope (verbatim).</div>
      <hr/>
      <div class="codebox">${escapeHtml(JSON.stringify(display, null, 2))}</div>
    </div>
  `;
}
