// frontend/src/app/_ui/AuthGate.jsx
"use client";

import { useEffect, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";

export default function AuthGate({ children }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    async function check() {
      try {
        await asoraGetJson("/api/auth/me");
        if (!alive) return;
        setReady(true);
      } catch {
        if (!alive) return;
        window.location.href = "/login";
      }
    }

    check();
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return null;
  return children;
}
