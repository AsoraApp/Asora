import { api } from "../api.js";
import { renderPageFrame, renderErrorEnvelope } from "../render.js";

export async function pageLogin(ctx) {
  // Probe /auth/me again to avoid UI guessing.
  const meRes = await api.tryGet("/auth/me", ctx);
  const meBody = await meRes.safeJson();

  if (meRes.ok) {
    ctx.session = meBody;
    return renderPageFrame(ctx, {
      title: "Login",
      contentHtml: `
        <div class="panel">
          <div class="h1">Authenticated</div>
          <div class="muted">Session already active (backend confirmed).</div>
          <hr/>
          <div class="controls">
            <button class="btn" id="goHome">Go to /</button>
          </div>
        </div>
      `,
      postRender: () => {
        document.getElementById("goHome")?.addEventListener("click", () => ctx.router.go("/"));
      },
    });
  }

  // If backend provides a login endpoint, you can use it. If not, this screen remains informational.
  // U1: No auth hacks. No token prompts. No manual tenant selection.
  const content = `
    <div class="panel">
      <div class="h1">Login</div>
      <div class="muted">This UI does not implement authentication unless the backend exposes a supported login flow.</div>
      <hr/>
      <div class="h2">/auth/me response</div>
      ${renderErrorEnvelope(meRes, meBody)}
      <hr/>
      <div class="muted">If your backend uses SSO/IdP redirect, sign in through the configured provider, then reload.</div>
    </div>
  `;

  return renderPageFrame(ctx, { title: "Login", contentHtml: content });
}
