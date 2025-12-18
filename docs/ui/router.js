export function createRouter(routeTable) {
  function normalize(path) {
    if (!path) return "/";
    if (!path.startsWith("/")) path = "/" + path;
    return path.replace(/\/+$/, "") || "/";
  }

  async function render(path, ctx) {
    const n = normalize(path);
    const handler = routeTable[n];
    if (!handler) {
      ctx.appEl.innerHTML = `<div class="container"><div class="panel"><div class="h1">Not Found</div><div class="muted">UI route not found.</div><hr/><div class="codebox">${escapeHtml(JSON.stringify({ error: "NOT_FOUND", code: "UI_ROUTE_NOT_FOUND", path: n }, null, 2))}</div></div></div>`;
      return;
    }
    const html = await handler(ctx);
    ctx.appEl.innerHTML = html;
    if (ctx.__postRender) {
      const fn = ctx.__postRender;
      ctx.__postRender = null;
      fn();
    }
  }

  function go(path) {
    const n = normalize(path);
    history.pushState({}, "", "#" + n);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  function currentPath() {
    const h = location.hash || "#/";
    return normalize(h.slice(1));
  }

  function start(ctx, initialPath = null) {
    ctx.router = { go, currentPath };

    window.addEventListener("hashchange", () => {
      render(currentPath(), ctx);
    });

    window.addEventListener("popstate", () => {
      render(currentPath(), ctx);
    });

    if (initialPath) {
      history.replaceState({}, "", "#" + normalize(initialPath));
    } else if (!location.hash) {
      history.replaceState({}, "", "#/");
    }

    render(currentPath(), ctx);
  }

  return { start, go, currentPath };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
