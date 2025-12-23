// frontend/src/app/login/page.jsx
"use client";

export const runtime = "edge";

function providerUrl(provider) {
  const u = new URL("/api/auth/login", window.location.origin);
  u.searchParams.set("provider", provider);
  return u.toString();
}

export default function LoginPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Asora Login</h1>
      <p style={{ opacity: 0.8, marginBottom: 16 }}>Enterprise SSO required.</p>

      <div style={{ display: "flex", gap: 12 }}>
        <a href="/api/auth/login?provider=entra" style={{ padding: 12, border: "1px solid #444", borderRadius: 10, textDecoration: "none" }}>
          Continue with Microsoft (Entra)
        </a>
        <a href="/api/auth/login?provider=okta" style={{ padding: 12, border: "1px solid #444", borderRadius: 10, textDecoration: "none" }}>
          Continue with Okta
        </a>
      </div>
    </div>
  );
}
