import { api } from "../api.js";
import { renderPageFrame, renderErrorEnvelope } from "../render.js";

export async function pageShellHome(ctx) {
  const meRes = await api.tryGet("/auth/me", ctx);
  const meBody = await meRes.safeJson();

  if (!meRes.ok) {
    if (meRes.status === 401) {
      ctx.session = null;
      ctx.router.go("/login");
      return "";
    }
    return renderPageFrame(ctx, { title: "Home", contentHtml: renderErrorEnvelope(meRes, meBody) });
  }

  ctx.session = meBody;

  return renderPageFrame(ctx, {
    title: "Home",
    contentHtml: `
      <div class="panel">
        <div class="h1">Authenticated Shell</div>
        <div class="muted">This UI is read-only. All truth comes from the backend.</div>
        <hr/>
        <div class="h2">What you can do in U1</div>
        <ul class="muted">
          <li>View inventory lists (items, categories, hubs, bins, vendors)</li>
          <li>View ledger event history (append-only)</li>
          <li>View reports (stock on hand, valuation, movement) as returned by API</li>
          <li>View export records (history only)</li>
          <li>View integrations (status only)</li>
          <li>View audits (filterable list, redacted fields only)</li>
        </ul>
      </div>
    `,
  });
}
