"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { asoraGetJson, getStoredDevToken } from "@/lib/asoraFetch";
import { clearLedgerCache } from "@/lib/ledgerCache";
import AdminHeader from "../../_ui/AdminHeader.jsx";
import LedgerFreshnessBar from "../../_ui/LedgerFreshnessBar.jsx";

const PAGE_SIZES = [25, 50, 100, 250];

export default function LedgerClient() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("fresh");

  const devToken = useMemo(() => getStoredDevToken(), []);
  const missingToken = !devToken;

  async function load({ force = false } = {}) {
    setLoading(true);
    try {
      if (force) {
        clearLedgerCache();
        setCacheStatus("fresh");
      } else {
        setCacheStatus("cached");
      }
      const r = await asoraGetJson("/v1/ledger/events", {});
      setResult(r);
      setLastFetchedUtc(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
  }, []);

  return (
    <>
      <AdminHeader
        title="Ledger Viewer"
        freshnessSlot={
          <LedgerFreshnessBar
            lastFetchedUtc={lastFetchedUtc}
            cacheStatus={cacheStatus}
            onRefresh={() => load({ force: false })}
            onForceRefresh={() => load({ force: true })}
          />
        }
      />

      <section style={{ opacity: missingToken ? 0.6 : 1 }}>
        {/* EXISTING LedgerClient body remains unchanged below this line */}
        {/* ⬇⬇⬇ DO NOT MODIFY EXISTING RENDER LOGIC ⬇⬇⬇ */}
        {/* paste the remainder of the original component body here unchanged */}
      </section>
    </>
  );
}
