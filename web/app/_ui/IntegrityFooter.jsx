// web/app/_ui/IntegrityFooter.jsx
"use client";

import { useMemo } from "react";
import { useDensity } from "./CompactBar.jsx";

export const runtime = "edge";

/**
 * U8 QA footer block for derived pages.
 * - No new logic: displays values computed by the page.
 *
 * Props:
 *  - ledgerEventsProcessed: number
 *  - skipped: Array<{ reason: string, count: number }>
 *  - renderUtc: string (ISO) | ""
 */

export default function IntegrityFooter({ ledgerEventsProcessed, skipped, renderUtc }) {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const rows = useMemo(() => {
    const list = Array.isArray(skipped) ? skipped : [];
    const cleaned = list
      .map((x) => ({
        reason: String(x?.reason || "").trim(),
        count: typeof x?.count === "number" && Number.isFinite(x.count) ? x.count : 0,
      }))
      .filter((x) => x.reason);
    cleaned.sort((a, b) => a.reason.localeCompare(b.reason));
    return cleaned;
  }, [skipped]);

  const processed =
    typeof ledgerEventsProcessed === "number" && Number.isFinite(ledgerEventsProcessed) ? ledgerEventsProcessed : 0;

  return (
    <footer style={s.shell}>
      <div style={s.title}>Integrity</div>

      <div style={s.grid}>
        <div style={s.kv}>
          <div style={s.k}>Ledger events processed</div>
          <div style={s.vMono}>{processed}</div>
        </div>

        <div style={s.kv}>
          <div style={s.k}>UTC render timestamp</div>
          <div style={s.vMono}>{renderUtc || "—"}</div>
        </div>
      </div>

      <div style={s.hr} />

      <div style={s.sectionTitle}>Skipped events (reasons)</div>

      {rows.length === 0 ? (
        <div style={s.muted}>None reported by this view.</div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>reason</th>
                <th style={s.thRight}>count</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.reason}>
                  <td style={s.td}>{r.reason}</td>
                  <td style={s.tdRight}>
                    <span style={s.vMono}>{r.count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={s.hr} />

      <div style={s.muted}>
        Determinism: this page is computed client-side from tenant-scoped read endpoints using stable ordering and UTC
        labels. No backend writes occur.
      </div>
    </footer>
  );
}

const styles = {
  shell: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
    color: "#e6edf3",
  },
  title: { fontSize: 13, fontWeight: 900, marginBottom: 10, opacity: 0.95 },

  grid: { display: "flex", gap: 16, flexWrap: "wrap" },
  kv: { display: "flex", flexDirection: "column", gap: 6, minWidth: 240 },

  k: { fontSize: 11, fontWeight: 800, opacity: 0.7 },
  vMono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.9 },

  sectionTitle: { marginTop: 2, fontSize: 12, fontWeight: 900, opacity: 0.9 },
  muted: { fontSize: 12, opacity: 0.75, lineHeight: 1.45 },

  hr: { height: 1, background: "rgba(255,255,255,0.08)", margin: "12px 0" },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 10 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 11, opacity: 0.75, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "8px 6px" },
  thRight: { textAlign: "right", fontSize: 11, opacity: 0.75, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "8px 6px" },
  td: { padding: "8px 6px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 12, opacity: 0.9 },
  tdRight: { padding: "8px 6px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 12, textAlign: "right" },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 12 },
  muted: { ...styles.muted, fontSize: 11 },
  vMono: { ...styles.vMono, fontSize: 11 },
  td: { ...styles.td, fontSize: 11 },
  tdRight: { ...styles.tdRight, fontSize: 11 },
};
