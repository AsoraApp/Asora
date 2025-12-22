"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAuthMode } from "@/lib/authStorage";
import { readLastSessionDenial } from "@/lib/asoraFetch";

const DISMISS_KEY = "asora_session:denial_dismissed_v1";

function safeReadDismissed(atUtc) {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed && parsed.atUtc === atUtc;
  } catch {
    return false;
  }
}

function safeWriteDismissed(atUtc) {
  try {
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify({ atUtc: atUtc || null }));
  } catch {
    // no-op
  }
}

function classify(code) {
  const c = String(code || "").toUpperCase();
  if (!c) return "SESSION_REQUIRED";
  if (c.includes("EXPIRED") || c.includes("EXP")) return "SESSION_EXPIRED";
  if (c.includes("INVALID") || c.includes("SIGN") || c.includes("HMAC") || c.includes("BAD")) return "SESSION_INVALID";
  if (c.includes("AUTH_REQUIRED")) return "SESSION_REQUIRED";
  return "SESSION_REQUIRED";
}

function messageFor(kind, mode) {
  // Fail-closed clarity, no blame, no ambiguity.
  if (kind === "SESSION_EXPIRED") return "Session expired. Re-authentication required.";
  if (kind === "SESSION_INVALID") return "Session invalid. Re-authentication required.";
  // Required (missing/denied)
  if (mode === "UNAUTH") return "Authentication required. Set Bearer or dev_token to continue.";
  return "Authentication required. Re-authentication may be required.";
}

export default function SessionBanner() {
  const [denial, setDenial] = useState(null);
  const [mode, setMode] = useState("UNAUTH");

  useEffect(() => {
    // Deterministic: read once on mount.
    try {
      setMode(getAuthMode());
    } catch {
      setMode("UNAUTH");
    }

    const d = readLastSessionDenial();
    setDenial(d || null);

    const onDenied = (ev) => {
      const next = ev?.detail || null;
      setDenial(next);
      try {
        setMode(getAuthMode());
      } catch {
        // ignore
      }
    };

    const onAuthChanged = () => {
      // When auth changes, refresh mode; keep denial visible until a successful call occurs.
      try {
        setMode(getAuthMode());
      } catch {
        setMode("UNAUTH");
      }
    };

    try {
      window.addEventListener("asora:session-denied", onDenied);
      window.addEventListener("asora:auth-changed", onAuthChanged);
      window.addEventListener("storage", onAuthChanged);
    } catch {
      // ignore
    }

    return () => {
      try {
        window.removeEventListener("asora:session-denied", onDenied);
        window.removeEventListener("asora:auth-changed", onAuthChanged);
        window.removeEventListener("storage", onAuthChanged);
      } catch {
        // ignore
      }
    };
  }, []);

  const isDismissed = useMemo(() => {
    if (!denial?.atUtc) return false;
    return safeReadDismissed(denial.atUtc);
  }, [denial?.atUtc]);

  const visible = Boolean(denial && denial.atUtc && !isDismissed && (denial.status === 401 || denial.status === 403));

  const kind = useMemo(() => classify(denial?.code), [denial?.code]);
  const msg = useMemo(() => messageFor(kind, mode), [kind, mode]);

  if (!visible) return null;

  return (
    <div
      style={{
        borderBottom: "1px solid #fecaca",
        background: "#fef2f2",
      }}
    >
      <div className="container row" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Access blocked</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {msg}{" "}
            <span className="muted">
              (status {denial.status}, code {String(denial.code || "—")})
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            path: {String(denial.path || "—")} • requestId: {String(denial.requestId || "—")}
          </div>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <Link className="button" href="/auth">
            Go to Auth
          </Link>

          <button
            className="button secondary"
            onClick={() => safeWriteDismissed(denial.atUtc)}
            title="Dismiss for this tab (does not change auth state)"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
