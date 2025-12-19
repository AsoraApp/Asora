"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";

function jsonStringifyStable(x) {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function normStr(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function normStrLower(v) {
  return normStr(v).toLowerCase();
}

function pickQtyField(item) {
  if (!item || typeof item !== "object") return null;

  const candidates = [
    "qty",
    "quantity",
    "onHand",
    "on_hand",
    "onhand",
    "availableQty",
    "available_qty",
    "available",
  ];

  for (const k of candidates) {
    if (Object.prototype.hasOwnProperty.call(item, k)) return k;
  }
  return null;
}

function getQtyValue(item, qtyKey) {
  if (!qtyKey) return null;
  const v = item?.[qtyKey];
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compareStringsDeterministic(a, b) {
  const al = normStrLower(a);
  const bl = normStrLower(b);
  if (al < bl) return -1;
  if (al > bl) return 1;

  // Tie-breaker: original string (case-sensitive) for determinism
  const as = normStr(a);
  const bs = normStr(b);
  if (as < bs) return -1;
  if (as > bs) return 1;

  return 0;
}

function compareNumbersDeterministic(a, b) {
  const an = Number.isFinite(a) ? a : null;
  const bn = Number.isFinite(b) ? b : null;

  if (an === null && bn === null) return 0;
  if (an === null) return 1; // nulls last
  if (bn === null) return -1;

  if (an < bn) return -1;
  if (an > bn) return 1;
  return 0;
}

export default function ItemsClient() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name"); // name | sku | itemId | qty (conditional)
  const [sortDir, setSortDir] = useState("asc"); // asc | desc

  async function load() {
    setLoading(true);
    try {
      const r = await asoraGetJson("/v1/inventory/items", {});
      setResult(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { items, errorEnvelope } = useMemo(() => {
    // Deterministic envelope handling:
    // - If backend returns { error, code, details }, preserve it
    // - If backend returns { items: [...] }, use that
    // - If backend returns array, accept it as items
    // - Otherwise treat as empty items
    const r = result;

    if (r && typeof r === "object" && !Array.isArray(r) && r.error && r.code) {
      return { items: [], errorEnvelope: r };
    }

    if (Array.isArray(r)) {
      const withIdx = r.map((it, idx) => ({ ...it, __idx: idx }));
      return { items: withIdx, errorEnvelope: null };
    }

    const rawItems = r?.items;
    if (Array.isArray(rawItems)) {
      const withIdx = rawItems.map((it, idx) => ({ ...it, __idx: idx }));
      return { items: withIdx, errorEnvelope: null };
    }

    return { items: [], errorEnvelope: null };
  }, [result]);

  const qtyKey = useMemo(() => {
    // Best-effort detection; do not assume it exists.
    for (const it of items) {
      const k = pickQtyField(it);
      if (k) return k;
    }
    return null;
  }, [items]);

  const hasAnyQty = useMemo(() => {
    if (!qtyKey) return false;
    return items.some((it) => getQtyValue(it, qtyKey) !== null);
  }, [items, qtyKey]);

  const filteredSorted = useMemo(() => {
    const q = normStrLower(search).trim();

    const filtered = q
      ? items.filter((it) => {
          const itemId = normStrLower(it?.itemId);
          const name = normStrLower(it?.name);
          const sku = normStrLower(it?.sku);

          // Explicitly deterministic, case-insensitive search across name/sku/itemId
          return (
            itemId.includes(q) ||
            name.includes(q) ||
            sku.includes(q)
          );
        })
      : items.slice();

    const dir = sortDir === "desc" ? -1 : 1;

    function stableTieBreak(a, b) {
      // Prefer itemId, then sku, then name, then original index (__idx)
      const c1 = compareStringsDeterministic(a?.itemId, b?.itemId);
      if (c1 !== 0) return c1;

      const c2 = compareStringsDeterministic(a?.sku, b?.sku);
      if (c2 !== 0) return c2;

      const c3 = compareStringsDeterministic(a?.name, b?.name);
      if (c3 !== 0) return c3;

      const ai = Number.isFinite(a?.__idx) ? a.__idx : 0;
      const bi = Number.isFinite(b?.__idx) ? b.__idx : 0;
      return ai - bi;
    }

    function cmp(a, b) {
      if (sortBy === "qty") {
        const aq = getQtyValue(a, qtyKey);
        const bq = getQtyValue(b, qtyKey);
        const c = compareNumbersDeterministic(aq, bq);
        if (c !== 0) return c * dir;
        return stableTieBreak(a, b) * dir;
      }

      if (sortBy === "sku") {
        const c = compareStringsDeterministic(a?.sku, b?.sku);
        if (c !== 0) return c * dir;
        return stableTieBreak(a, b) * dir;
      }

      if (sortBy === "itemId") {
        const c = compareStringsDeterministic(a?.itemId, b?.itemId);
        if (c !== 0) return c * dir;
        return stableTieBreak(a, b) * dir;
      }

      // default: name
      const c = compareStringsDeterministic(a?.name, b?.name);
      if (c !== 0) return c * dir;
      return stableTieBreak(a, b) * dir;
    }

    filtered.sort(cmp);
    return filtered;
  }, [items, search, sortBy, sortDir, qtyKey]);

  const sortOptions = useMemo(() => {
    const base = [
      { value: "name", label: "Name" },
      { value: "sku", label: "SKU" },
      { value: "itemId", label: "Item ID" },
    ];
    if (hasAnyQty) base.push({ value: "qty", label: "Quantity" });
    return base;
  }, [hasAnyQty]);

  function stableRowKey(it) {
    const itemId = normStr(it?.itemId).trim();
    if (itemId) return `itemId:${itemId}`;

    const sku = normStr(it?.sku).trim();
    if (sku) return `sku:${sku}`;

    const name = normStr(it?.name).trim();
    if (name) return `name:${name}`;

    const idx = Number.isFinite(it?.__idx) ? it.__idx : 0;
    return `idx:${idx}`;
  }

  const authRequired =
    errorEnvelope?.code === "AUTH_REQUIRED" ||
    errorEnvelope?.error === "UNAUTHORIZED";

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Inventory Items</h1>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          GET-only, ledger-derived
        </div>
      </div>

      {authRequired ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 8,
            background: "rgba(255, 180, 0, 0.12)",
          }}
        >
          <div style={{ fontWeight: 600 }}>Authentication required</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Set a dev_token in the global Dev Token bar (example: tenant:demo).
          </div>
        </div>
      ) : null}

      {errorEnvelope ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 8,
            background: "rgba(255,0,0,0.06)",
          }}
        >
          <div style={{ fontWeight: 600 }}>Error</div>
          <pre
            style={{
              marginTop: 8,
              marginBottom: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 12,
            }}
          >
            {jsonStringifyStable(errorEnvelope, null, 2)}
          </pre>
        </div>
      ) : null}

      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Search (name / sku / itemId)</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            style={{
              width: 320,
              maxWidth: "80vw",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.2)",
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Sort by</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.2)",
            }}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Direction</span>
          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value)}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.2)",
            }}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>

        <button
          onClick={() => {
            setSearch("");
            setSortBy("name");
            setSortDir("asc");
          }}
          style={{
            marginTop: 20,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(0,0,0,0.2)",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          Reset
        </button>

        <button
          onClick={load}
          disabled={loading}
          style={{
            marginTop: 20,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(0,0,0,0.2)",
            background: "transparent",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>

        <div style={{ marginTop: 20, fontSize: 12, opacity: 0.8 }}>
          Showing {filteredSorted.length} of {items.length}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {loading && !result ? (
          <div style={{ fontSize: 12, opacity: 0.8 }}>Loading…</div>
        ) : null}

        {!loading && !errorEnvelope && filteredSorted.length === 0 ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid rgba(0,0,0,0.15)",
              borderRadius: 8,
              background: "rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ fontWeight: 600 }}>No items</div>
            <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>
              No inventory items were returned for this tenant.
            </div>
          </div>
        ) : null}

        {filteredSorted.length > 0 ? (
          <div
            style={{
              marginTop: 12,
              border: "1px solid rgba(0,0,0,0.15)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", background: "rgba(0,0,0,0.04)" }}>
                    <th style={{ padding: "10px 12px", fontSize: 12, opacity: 0.85 }}>Item ID</th>
                    <th style={{ padding: "10px 12px", fontSize: 12, opacity: 0.85 }}>Name</th>
                    <th style={{ padding: "10px 12px", fontSize: 12, opacity: 0.85 }}>SKU</th>
                    <th style={{ padding: "10px 12px", fontSize: 12, opacity: 0.85 }}>UOM</th>
                    {hasAnyQty ? (
                      <th style={{ padding: "10px 12px", fontSize: 12, opacity: 0.85 }}>Quantity</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredSorted.map((it) => {
                    const qty = hasAnyQty ? getQtyValue(it, qtyKey) : null;

                    return (
                      <tr key={stableRowKey(it)} style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                        <td style={{ padding: "10px 12px", fontSize: 13, whiteSpace: "nowrap" }}>
                          {normStr(it?.itemId) || <span style={{ opacity: 0.5 }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: 13 }}>
                          {normStr(it?.name) || <span style={{ opacity: 0.5 }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: 13 }}>
                          {normStr(it?.sku) || <span style={{ opacity: 0.5 }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: 13, whiteSpace: "nowrap" }}>
                          {normStr(it?.uom) || <span style={{ opacity: 0.5 }}>—</span>}
                        </td>
                        {hasAnyQty ? (
                          <td style={{ padding: "10px 12px", fontSize: 13, whiteSpace: "nowrap" }}>
                            {qty === null ? <span style={{ opacity: 0.5 }}>—</span> : String(qty)}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <details style={{ padding: 12, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
              <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.85 }}>
                Raw response (deterministic envelope)
              </summary>
              <pre
                style={{
                  marginTop: 10,
                  marginBottom: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 12,
                }}
              >
                {jsonStringifyStable(result, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}
