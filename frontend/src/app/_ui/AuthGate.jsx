// frontend/src/app/_ui/AuthGate.jsx
"use client";

import { useEffect, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";
import { setAccessToken } from "@/lib/authStorage";

export default function AuthGate({ children }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    async function check() {
      try {
        // If you already have an access token, /api/auth/me will pass.
        // If you don't, you'll be redirected to /login unless your refresh flow is set up.
        await asoraGetJson("/api/auth/me");
        if (!alive) return;
        setReady(true);
      } catch (e) {
        if (!alive) return;
        // Redirect to login. (OIDC-first)
        window.location.href = "/login";
      }
    }

    // On return from callback, accessToken is provided as query param (UI sets it then redirects).
    try {
      const u = new URL(window.location.href);
      const t = u.searchParams.get("accessToken");
      if (t) {
        setAccessToken(t);
        u.searchParams.delete("accessToken");
        window.history.replaceState({}, "", u.toString());
      }
    } catch {
      // ignore
    }

    check();
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return null;
  return children;
}
