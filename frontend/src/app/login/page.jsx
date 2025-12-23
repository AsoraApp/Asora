"use client";

export const runtime = "edge";

export default function LoginPage() {
  function start() {
    // Start OIDC via Worker (proxied through Pages /api)
    window.location.href = "/api/auth/oidc/start";
  }

  return (
    <div className="container" style={{ paddingTop: 48, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2 }}>ASORA</div>
      </div>

      <div style={{ marginTop: 16, opacity: 0.85 }}>
        Sign in to access the Asora Admin Console. Unauthorized access is blocked.
      </div>

      <div style={{ marginTop: 24 }}>
        <button
          onClick={start}
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.06)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Continue with SSO
        </button>
      </div>

      <div style={{ marginTop: 18, fontSize: 13, opacity: 0.7 }}>
        If your company uses SSO, you will be redirected to your identity provider.
      </div>
    </div>
  );
}
