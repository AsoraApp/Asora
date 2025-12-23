"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setBearerToken } from "@/lib/authStorage";

export const runtime = "edge";

export default function AuthCallbackPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [msg, setMsg] = useState("Completing sign-in…");

  useEffect(() => {
    let alive = true;

    async function run() {
      // We intentionally call the Worker callback endpoint through Pages proxy.
      // It will exchange code and return { accessToken } while setting refresh cookie.
      const url = `/api/auth/oidc/callback?${sp.toString()}`;

      const res = await fetch(url, { method: "GET", cache: "no-store" });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }

      if (!res.ok) {
        if (!alive) return;
        setMsg(`Sign-in failed (${body?.code || res.status}).`);
        return;
      }

      const accessToken = String(body?.accessToken || "").trim();
      if (accessToken) setBearerToken(accessToken);

      if (!alive) return;
      setMsg("Signed in. Redirecting…");
      router.replace("/ledger");
    }

    run().catch(() => {
      if (alive) setMsg("Sign-in failed.");
    });

    return () => {
      alive = false;
    };
  }, [router, sp]);

  return (
    <div className="container" style={{ paddingTop: 48 }}>
      <div style={{ opacity: 0.85 }}>{msg}</div>
    </div>
  );
}
