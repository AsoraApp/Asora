// frontend/src/app/login/page.jsx
"use client";

export default function LoginPage() {
  function startSso() {
    window.location.href = "/api/auth/oidc/start";
  }

  return (
    <div style={{ maxWidth: 520, margin: "48px auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Asora</div>
      </div>

      <div style={{ marginBottom: 12, opacity: 0.8 }}>
        Sign in to continue. Access is blocked without authentication.
      </div>

      <button
        onClick={startSso}
        style={{
          width: "100%",
          padding: "12px 14px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(255,255,255,0.08)",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        Continue with SSO
      </button>
    </div>
  );
}
