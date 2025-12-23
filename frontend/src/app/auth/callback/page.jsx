// frontend/src/app/auth/callback/page.jsx
"use client";

import { useEffect, useState } from "react";
import { setBearerToken } from "@/lib/authStorage";

export const runtime = "edge";

export default function AuthCallbackPage() {
  const [msg, setMsg] = useState("Finalizing session...");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        const body = await res.json();
        if (!res.ok || !body?.ok || !body?.accessToken) {
          setMsg("Login failed. Returning to login...");
          window.location.href = "/login";
          return;
        }

        setBearerToken(body.accessToken);
        window.location.href = "/";
      } catch {
        setMsg("Login failed. Returning to login...");
        window.location.href = "/login";
      }
    })();
  }, []);

  return <div style={{ padding: 24 }}>{msg}</div>;
}
