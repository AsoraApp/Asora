"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAuthMode, getBearerToken } from "@/lib/authStorage";
import { asoraGetJson } from "@/lib/asoraFetch";

/**
 * U15-2 + U15-4
 * - Auth indicator (DEV | BEARER | UNAUTH) w/ severity for invalid/expired Bearer
 * - Adds Audit nav entry
 * - No polling; one probe on mount + manual recheck + token-change refresh
 */

function classifyBearerFailure(code) {
  const c = String(code || "").toUpperCase();
  if (!c) return "INVALID";
  if (c.includes("EXPIRED") || c.includes("EXP")) return "EXPIRED";
  if (c.includes("INVALID") || c.includes("SIGN") || c.includes("HMAC") || c.includes("BAD")) return "INVALID";
  return "INVALID";
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return null;
  }
}

export default function AdminHeader() {
  const [mode, setMode] = useState("UNAUTH");
  const [me, setMe] = useState(null);

  const [health, setHealth] = useState({
    ok: false,
    checkedAtUtc: null,
    code: null,
    reason: null, // BEARER_EXPIRED | BEARER_INVALID | null
  });

  const badgeText = useMemo(() => {
    if (mode === "DEV") return "DEV";
    if (mode === "BEARER") return "BEARER";
    return "UNAUTH";
  }, [mode]);

  const badgeClass = useMemo(() => {
    if (mode === "BEARER" && health.ok !== true) return "badge bad";
    if (mode === "BEARER") return "badge bearer";
    if (mode === "DEV") return "badge dev";
    return "badge unauth";
  }, [mode, health.ok]);

  const badgeTitle = useMemo(() => {
    if (mode === "UNAUTH") return "No auth token present (fail-closed).";
    if (mode === "DEV") {
      return health.ok
        ? "DEV auth (deprecated bridge) accepted."
        : `DEV auth present but rejected (${health.code || "AUTH_REQUIRED"}).`;
    }
    if (health.ok) return "Bearer token accepted.";
    if (health.reason === "BEARER_EXPIRED") return "Bearer token present but expired.";
    if (health.reason === "BEARER_INVALID") return "Bearer token present but invalid.";
    return `Bearer token present but rejected (${health.code || "AUTH_REQUIRED"}).`;
  }, [mode, health.ok, health.code, health.reason]);

  async function probeAuthOnce() {
    let nextMode = "UNAUTH";
    try {
      nextMode = getAuthMode();
    } catch {
      nextMode = "UNAUTH";
    }
    setMode(nextMode);

    if (nextMode === "UNAUTH") {
      setMe(null);
      setHealth({ ok: false, checkedAtUtc: nowIso(), code: "AUTH_REQUIRED", reason: null });
      return;
    }

    try {
      const r = await asoraGetJson("/api/auth/me");
      setMe(r || null);
      setHealth({ ok: true, checkedAtUtc: nowIso(), code: null, reason: null });
      try {
        setMode(getAuthMode());
      } catch {
        // no-op
      }
    } catch (e) {
      setMe(null);

      const storedBearer = (() => {
        try {
          return Boolean(getBearerToken());
        } catch {
          return false;
        }
      })();

      let reason = null;
      if (storedBearer) {
        const kind = classifyBearerFailure(e?.code || e?.error);
        reason = kind === "EXPIRED" ? "BEARER_EXPIRED" : "BEARER_INVALID";
      }

      setHealth({
        ok: false,
        checkedAtUtc: nowIso(),
        code: e?.code || e?.error || "AUTH_REQUIRED",
        reason,
      });

      try {
        setMode(getAuthMode());
      } catch {
        // no-op
      }
    }
  }

  useEffect(() => {
    probeAuthOnce();

    const onStorage = (ev) => {
      if (!ev || !ev.key) {
        probeAuthOnce();
        return;
      }
      if (String(ev.key).startsWith("asora_auth:")) probeAuthOnce();
    };

    const onAuthChanged = () => probeAuthOnce();

    try {
      window.addEventListener("storage", onStorage);
      window.addEventListener("asora:auth-changed", onAuthChanged);
    } catch {
      // ignore
    }

    return () => {
      try {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("asora:auth-changed", onAuthChanged);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <Link className="muted" href="/audit">
              Audit
            </Link>
          </nav>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <span className={badgeClass} title={badgeTitle}>
            {badgeText}
          </span>

          <span className="muted" style={{ fontSize: 12 }}>
            tenant: {me?.tenantId ?? "—"}
            <span className="muted" style={{ marginLeft: 8 }}>
              actor: {me?.actorId ?? "—"}
            </span>
          </span>

          <button
            className="button secondary"
            style={{ padding: "8px 10px", fontSize: 12 }}
            onClick={() => probeAuthOnce()}
            title="Manual one-shot probe (no polling)"
          >
            Recheck
          </button>
        </div>
      </div>
    </header>
  );
}
