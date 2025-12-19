"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson, getStoredDevToken } from "@/lib/asoraFetch";

const PAGE_SIZES = [25, 50, 100, 250];

export default function LedgerClient() {
  const [eventType, setEventType] = useState("");
  const [itemId, setItemId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [order, setOrder] = useState("desc"); // newest-first default
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const devToken = useMemo(() => getStoredDevToken(), []);
  const missingToken = !devToken;

  const query = useMemo(() => {
    // Backend may not support filter params; fetch all and filter client-side.
    // dev_token is injected automatically by asoraFetch if present in localStorage.
    return {};
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await asoraGetJson("/v1/ledger/events", query);
      setResult(r);
      setPage(1); // deterministic UX: reset to first page on refresh
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errorBox = !result
    ? null
    : result.ok
      ? null
      : {
          status: result.status,
          error: result.error,
          code: result.code,
          url: result.url,
          details: result.details
        };

  const authRequired =
    !result?.ok &&
    (result?.status === 401 || result?.code === "AUTH_REQUIRED" || result?.error === "UNAUTHORIZED");

  const allEvents = useMemo(() => {
    const raw = result?.ok ? result?.data?.events : null;
    return Array.isArray(raw) ? raw : [];
  }, [result]);

  const filteredSorted = useMemo(() => {
    let filtered = allEvents;

    const et = eventType.trim();
    const iid = itemId.trim();
    const q = searchText.trim().toLowerCase();

    if (et) {
      filtered = filtered.filter((e) => String(e?.eventType || "") === et);
    }
    if (iid) {
      filtered = filtered.filter((e) => String(e?.itemId || "") === iid);
    }
    if (q) {
      filtered = filtered.filter((e) => matchesSearch(e, q));
    }

    // Deterministic ordering using a stable sort key:
    // 1) ts (string compare works with ISO-8601)
    // 2) ledgerEventId
    // 3) eventId
    // 4) stable JSON
    const withKey = filtered.map((e, idx) => {
      const ts = e?.ts ? String(e.ts) : "";
      const ledgerEventId = e?.ledgerEventId ? String(e.ledgerEventId) : "";
      const eventId = e?.eventId ? String(e.eventId) : "";
      const key = ts || ledgerEventId || eventId || safeStableKey(e) || String(idx);
      return { e, key, idx };
    });

    withKey.sort((a, b) => {
      if (a.key < b.key) return -1;
      if (a.key > b.key) return 1;
      return a.idx - b.idx;
    });

    if (order === "desc") withKey.reverse();

    return withKey.map((x) => x.e);
  }, [allEvents, eventType, itemId, searchText, order]);

  const pageCount = useMemo(() => {
    const n = filteredSorted.length;
    const ps = Number(pageSize) || 50;
    return Math.max(1, Math.ceil(n / ps));
  }, [filteredSorted.length, pageSize]);

  const clampedPage = useMemo(() => {
    if (page < 1) return 1;
    if (page > pageCount) return pageCount;
    return page;
  }, [page, pageCount]);

  const pagedEvents = useMemo(() => {
    const ps = Number(pageSize) || 50;
    const start = (clampedPage - 1) * ps;
    return filteredSorted.slice(start, start + ps);
  }, [filteredSorted, pageSize, clampedPage]);

  useEffect(() => {
    // If filters reduce total pages, clamp page deterministically.
    if (page !== clampedPage) setPage(clampedPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedPage]);

  function clearFilters() {
    setEventType("");
    setItemId("");
    setSearchText("");
    setPage(1);
  }

  const showingRange = useMemo(() => {
    const total = filteredSorted.length;
    const ps = Number(pageSize) || 50;
    if (total === 0) return { from: 0, to: 0, total: 0 };
    const from = (clampedPage - 1) * ps + 1;
    const to = Math.min(total, clampedPage * ps);
    return { from, to, total };
  }, [filteredSorted.length, pageSize, clampedPage]);

  return (
    <section style={styles.grid}>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>Controls</div>

        {missingToken ? (
          <div style={styles.bannerWarn}>
            <div style={styles.bannerTitle}>dev_token not set</div>
            <div style={styles.bannerBody}>
              Set <code style={styles.code}>dev_token</code> in the header bar, then refresh.
            </div>
          </div>
        ) : (
          <div style={styles.bannerOk}>
            <div style={styles.bannerTitle}>dev_token active</div>
            <div style={styles.bannerBody}>
              Requests are tenant-scoped via <code style={styles.code}>dev_token</code> from localStorage.
            </div>
          </div>
        )}

        <div style={styles.field}>
          <div style={styles.label}>Filter: eventType (exact)</div>
          <input
            style={styles.input}
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              setPage(1);
            }}
            placeholder="ITEM_CREATED"
            spellCheck={false}
          />
        </div>

        <div style={styles.field}>
          <div style={styles.label}>Filter: itemId (exact)</div>
          <input
            style={styles.input}
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value);
              setPage(1);
            }}
            placeholder="item_test_001"
            spellCheck={false}
          />
        </div>

        <div style={styles.field}>
          <div style={styles.label}>Search (text)</div>
          <input
            style={styles.input}
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setPage(1);
            }}
            placeholder="Search eventType, itemId, tenantId, ids, qtyDelta…"
            spellCheck={false}
          />
        </div>

        <div style={styles.field}>
          <div style={styles.label}>Order</div>
          <select style={styles.select} value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="desc">Newest first (desc)</option>
            <option value="asc">Oldest first (asc)</option>
          </select>
        </div>

        <div style={styles.field}>
          <div style={styles.label}>Page size</div>
          <select
            style={styles.select}
            value={String(pageSize)}
            onChange={(e) => {
              const ps = Number(e.target.value) || 50;
              setPageSize(ps);
              setPage(1);
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={String(n)}>
                {n} / page
              </option>
            ))}
          </select>
        </div>

        <div style={styles.row}>
          <button style={styles.button} onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button style={styles.buttonSecondary} onClick={clearFilters} disabled={loading}>
            Clear filters
          </button>
        </div>

        <div style={styles.hint}>
          Fetches all tenant-scoped events and applies filters/sort/pagination client-side. No writes are performed.
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.panelTitle}>Results</div>

        {authRequired ? (
          <div style={styles.bannerWarn}>
            <div style={styles.bannerTitle}>Authentication required</div>
            <div style={styles.bannerBody}>
              Backend returned 401. Set <code style={styles.code}>dev_token</code> in the header bar and refresh.
            </div>
          </div>
        ) : null}

        {errorBox ? (
          <div style={styles.error}>
            <div style={styles.errorTitle}>Fetch failed</div>
            <div style={styles.errorLine}>
              <b>Status:</b> {errorBox.status}
            </div>
            <div style={styles.errorLine}>
              <b>Error:</b> {errorBox.error} / {errorBox.code}
            </div>
            <div style={styles.errorLine}>
              <b>URL:</b> <span style={styles.mono}>{errorBox.url}</span>
            </div>
            <details style={styles.details}>
              <summary>details</summary>
              <pre style={styles.pre}>{safeStringify(errorBox.details)}</pre>
            </details>
          </div>
        ) : null}

        {!errorBox ? (
          <div style={styles.meta}>
            <div>
              <b>Filtered:</b> {filteredSorted.length}{" "}
              <span style={{ opacity: 0.8 }}>
                (showing {showingRange.from}-{showingRange.to})
              </span>
            </div>
            <div style={{ opacity: 0.85 }}>
              <b>Page:</b> {clampedPage} / {pageCount}
            </div>
            {result?.ok ? (
              <div style={{ opacity: 0.8 }}>
                <b>Source:</b> <span style={styles.mono}>{result.url}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {!errorBox && filteredSorted.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>No events</div>
            <div style={styles.emptyBody}>
              Adjust filters/search or refresh. If you expected data, verify the tenant has ledger events.
            </div>
          </div>
        ) : null}

        {!errorBox ? (
          <div style={styles.pager}>
            <button
              style={styles.pagerBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={clampedPage <= 1}
            >
              ← Prev
            </button>
            <div style={styles.pagerMid}>
              <span style={styles.monoSmall}>
                Page {clampedPage} of {pageCount}
              </span>
            </div>
            <button
              style={styles.pagerBtn}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={clampedPage >= pageCount}
            >
              Next →
            </button>
          </div>
        ) : null}

        <div style={styles.list}>
          {pagedEvents.map((e, i) => {
            const ts = e?.ts ? String(e.ts) : "";
            const tenantId = e?.tenantId ? String(e.tenantId) : "";
            const ledgerEventId = e?.ledgerEventId ? String(e.ledgerEventId) : "";
            const eventId = e?.eventId ? String(e.eventId) : "";
            const et = e?.eventType ? String(e.eventType) : "";
            const iid = e?.itemId ? String(e.itemId) : "";
            const qd = e?.qtyDelta !== undefined ? String(e.qtyDelta) : "";

            const stableId = ledgerEventId || eventId || `${ts}-${et}-${iid}-${i}`;
            const headerBits = [
              et || "UNKNOWN_EVENT",
              iid ? `itemId=${iid}` : null,
              qd ? `qtyDelta=${qd}` : null,
              tenantId ? `tenantId=${tenantId}` : null,
              ts ? `ts=${ts}` : null,
              ledgerEventId ? `ledgerEventId=${ledgerEventId}` : null
            ].filter(Boolean);

            return (
              <details key={stableId} style={styles.item}>
                <summary style={styles.summary}>
                  <span style={styles.badge}>{et || "UNKNOWN_EVENT"}</span>

                  <div style={styles.summaryCols}>
                    <div style={styles.summaryLine}>
                      {iid ? <span style={styles.monoSmall}>itemId={iid}</span> : null}
                      {qd ? <span style={styles.monoSmall}>qtyDelta={qd}</span> : null}
                      {tenantId ? <span style={styles.monoSmall}>tenantId={tenantId}</span> : null}
                    </div>
                    <div style={styles.summaryLine}>
                      {ts ? <span style={styles.monoSmall}>ts={ts}</span> : null}
                      {ledgerEventId ? (
                        <span style={styles.monoSmall}>ledgerEventId={ledgerEventId}</span>
                      ) : eventId ? (
                        <span style={styles.monoSmall}>eventId={eventId}</span>
                      ) : null}
                    </div>
                  </div>
                </summary>

                <div style={styles.itemMeta}>
                  <div style={styles.miniRow}>
                    <span style={styles.miniLabel}>Quick:</span>
                    <span style={styles.monoSmall}>{headerBits.join("  •  ")}</span>
                  </div>
                </div>

                <pre style={styles.pre}>{safeStringify(e)}</pre>
              </details>
            );
          })}
        </div>

        {!errorBox ? (
          <div style={styles.pagerBottom}>
            <button
              style={styles.pagerBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={clampedPage <= 1}
            >
              ← Prev
            </button>
            <button
              style={styles.pagerBtn}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={clampedPage >= pageCount}
            >
              Next →
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function matchesSearch(e, q) {
  const hay = [];

  // Common top-level fields
  hay.push(String(e?.eventType || ""));
  hay.push(String(e?.itemId || ""));
  hay.push(String(e?.tenantId || ""));
  hay.push(String(e?.ts || ""));
  hay.push(String(e?.qtyDelta ?? ""));
  hay.push(String(e?.ledgerEventId || ""));
  hay.push(String(e?.eventId || ""));

  // Common nested shapes (best-effort, client-side)
  const item = e?.item;
  if (item && typeof item === "object") {
    hay.push(String(item?.name || ""));
    hay.push(String(item?.sku || ""));
    hay.push(String(item?.uom || ""));
  }

  // If nothing matches, fall back to serialized JSON (bounded by try/catch)
  const joined = hay.join(" ").toLowerCase();
  if (joined.includes(q)) return true;

  const raw = safeStableKey(e);
  return raw.toLowerCase().includes(q);
}

function safeStableKey(x) {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function safeStringify(x) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

const styles = {
  grid: { display: "grid", gridTemplateColumns: "360px 1fr", gap: 14, alignItems: "start" },
  panel: {
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
    padding: 16,
    background: "rgba(255,255,255,0.02)"
  },
  panelTitle: { fontSize: 14, fontWeight: 700, marginBottom: 12, opacity: 0.9 },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 },
  label: { fontSize: 12, opacity: 0.8 },
  input: {
    padding: "10px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#e6edf3",
    outline: "none"
  },
  select: {
    padding: "10px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#e6edf3",
    outline: "none"
  },
  row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  button: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer"
  },
  buttonSecondary: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    color: "#e6edf3",
    cursor: "pointer"
  },
  hint: { marginTop: 10, fontSize: 12, opacity: 0.75, lineHeight: 1.35 },
  meta: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, fontSize: 13 },

  pager: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 12
  },
  pagerBottom: { display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12 },
  pagerBtn: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer"
  },
  pagerMid: { display: "flex", alignItems: "center", gap: 8 },

  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  monoSmall: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    opacity: 0.9
  },

  list: { display: "flex", flexDirection: "column", gap: 10 },
  item: {
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
    padding: 10,
    background: "rgba(0,0,0,0.18)"
  },
  summary: { cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" },
  badge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.05)",
    fontSize: 12,
    fontWeight: 700,
    marginTop: 1
  },
  summaryCols: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 auto" },
  summaryLine: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },

  itemMeta: { marginTop: 8 },
  miniRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  miniLabel: { fontSize: 12, opacity: 0.75 },

  pre: {
    margin: 0,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    background: "rgba(0,0,0,0.35)",
    overflowX: "auto",
    fontSize: 12,
    lineHeight: 1.35
  },

  error: {
    border: "1px solid rgba(255,80,80,0.35)",
    background: "rgba(255,80,80,0.08)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10
  },
  errorTitle: { fontWeight: 800, marginBottom: 6 },
  errorLine: { fontSize: 13, marginBottom: 4 },
  details: { marginTop: 8 },

  empty: {
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 12
  },
  emptyTitle: { fontWeight: 800, marginBottom: 6 },
  emptyBody: { fontSize: 13, opacity: 0.85, lineHeight: 1.35 },

  bannerWarn: {
    border: "1px solid rgba(255,200,80,0.35)",
    background: "rgba(255,200,80,0.08)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 12
  },
  bannerOk: {
    border: "1px solid rgba(100,220,160,0.35)",
    background: "rgba(100,220,160,0.08)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 12
  },
  bannerTitle: { fontWeight: 800, marginBottom: 6 },
  bannerBody: { fontSize: 13, opacity: 0.9, lineHeight: 1.35 },
  code: { background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 8 }
};
