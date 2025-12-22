"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAuthMode } from "@/lib/authStorage";
import { asoraGetJson } from "@/lib/asoraFetch";

export default function AdminHeader() {
  const [mode, setMode] = useState("UNAUTH");
  const [me, setMe] = useState(null);
  const [meStatus, setMeStatus] = useState({ ok: true, code: null });

  useEffect(() => {
    // Deterministic: read localStorage once on mount.
    try {
      setMode(getAuthMode());
    } catch {
      setMode("UNAUTH");
    }
  }, []);

  useEffect(() => {
    // No polling. A single best-effort probe per mount, for operator clarity.
    let cancelled = false;

    async function probe() {
      try {
        const r = await asoraGetJson("/api/auth/me");
        if (cancelled) return;
        setMe(r || null);
        setMeStatus({ ok: true, code: null });

        // If /me succeeded, mode is inferred by stored tokens.
        try {
          setMode(getAuthMode());
        } catch {
          // no-op
        }
      } catch (e) {
        if (cancelled) return;
        setMe(null);
        setMeStatus({ ok: false, code: e?.code || "AUTH_REQUIRED" });

        try {
          setMode(getAuthMode());
        } catch {
          setMode("UNAUTH");
        }
      }
    }

    probe();
    return () => {
      cancelled = true;
    };
  }, []);

  const badgeClass = useMemo(() => {
    if (meStatus.ok !== true) return "badge bad";
    if (mode === "BEARER") return "badge bearer";
    if (mode === "DEV") return "badge dev";
    return "badge unauth";
  }, [mode, meStatus.ok]);

  return (
    <header style={{ borderBottom: "1px solid #e5e7eb" }}>
      <div className="container row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 14 }}>
          <Link href="/" style={{ fontWeight: 700 }}>
            Asora
          </Link>

          <nav className="row" style={{ gap: 12 }}>
            <Link className="muted" href="/auth">
              Auth
            </Link>
          </nav>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <span className={badgeClass} title={meStatus.ok ? "Authenticated probe: OK" : `Probe failed: ${meStatus.code}`}>
            {meStatus.ok ? mode : "UNAUTH"}
          </span>

          <span className="muted" style={{ fontSize: 12 }}>
            tenant: {me?.tenantId ?? "—"}{" "}
            <span className="muted" style={{ marginLeft: 8 }}>
              actor: {me?.actorId ?? "—"}
            </span>
          </span>
        </div>
      </div>
    </header>
  );
}
