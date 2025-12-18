import { createRouter } from "./router.js";
import { api } from "./api.js";
import { renderAppShell, renderPageFrame, renderErrorEnvelope } from "./render.js";

import { pageLogin } from "./pages/login.js";
import { pageShellHome } from "./pages/shell.js";
import { pageList } from "./pages/list.js";
import { pageLedger } from "./pages/ledger.js";
import { pageReports } from "./pages/reports.js";
import { pageExports } from "./pages/exports.js";
import { pageIntegrations } from "./pages/integrations.js";
import { pageAudits } from "./pages/audits.js";

const appEl = document.getElementById("app");

const routes = {
  "/login": pageLogin,
  "/logout": async (ctx) => {
    // U1: logout is a backend call if present; otherwise just show guidance.
    const res = await api.tryPost("/auth/logout", null, ctx);
    const body = await res.safeJson();
    return renderPageFrame(ctx, {
      title: "Logout",
      contentHtml: res.ok
        ? `<div class="panel"><div class="h1">Logout</div><div class="muted">Backend confirmed logout.</div><hr/><div class="codebox">${escapeHtml(JSON.stringify(body, null, 2))}</div></div>`
        : renderErrorEnvelope(res, body),
      postRender: () => {
        // After logout attempt, probe /auth/me; if 401, navigate to /login.
        setTimeout(async () => {
          const me = await api.tryGet("/auth/me", ctx);
          if (!me.ok) ctx.router.go("/login");
        }, 250);
      },
    });
  },
  "/": pageShellHome,

  "/inventory/items": (ctx) => pageList(ctx, { title: "Items", path: "/inventory/items" }),
  "/inventory/categories": (ctx) => pageList(ctx, { title: "Categories", path: "/inventory/categories" }),
  "/inventory/hubs": (ctx) => pageList(ctx, { title: "Hubs", path: "/inventory/hubs" }),
  "/inventory/bins": (ctx) => pageList(ctx, { title: "Bins", path: "/inventory/bins" }),
  "/inventory/vendors": (ctx) => pageList(ctx, { title: "Vendors", path: "/inventory/vendors", fallbackPaths: ["/vendors"] }),

  "/ledger": pageLedger,
  "/reports": pageReports,
  "/exports": pageExports,
  "/integrations": pageIntegrations,
  "/audits": pageAudits,
};

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function bootstrap() {
  const router = createRouter(routes);

  const ctx = {
    router,
    appEl,
    apiBase: "", // same-origin
    session: null, // populated via /auth/me
  };

  renderAppShell(appEl, { loading: true });

  // Always resolve session from backend truth.
  const meRes = await api.tryGet("/auth/me", ctx);
  const meBody = await meRes.safeJson();

  if (meRes.ok) {
    ctx.session = meBody;
    router.start(ctx);
    return;
  }

  // Not authenticated (or forbidden). U1 doctrine: show envelope verbatim.
  // If 401, route to /login. Else render shell with error.
  if (meRes.status === 401) {
    ctx.session = null;
    router.start(ctx, "/login");
    return;
  }

  renderAppShell(appEl, {
    loading: false,
    headerRightHtml: `<span class="badge">Unauthenticated</span>`,
    bodyHtml: `<div class="container">${renderErrorEnvelope(meRes, meBody)}</div>`,
  });
}

bootstrap();
