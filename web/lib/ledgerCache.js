"use client";

/**
 * Client-only, per-tab, in-memory cache for ledger events.
 * - No timers (deterministic)
 * - Cache is cleared only by calling clearLedgerCache() or hard refresh.
 * - dev_token is handled by asoraFetch; cache is therefore per-tab and shared across views.
 *
 * U8 addition (UI-only): cache metadata for operator clarity.
 * - lastFetchedUtc: when the last successful fetch completed (UTC ISO string)
 * - lastSource: "fresh" when a network fetch completed, "cached" when returned from memoized result
 */

let _cachedPromise = null;
let _cachedResult = null;
let _cachedError = null;

let _lastFetchedUtc = "";
let _lastSource = ""; // "fresh" | "cached" | ""

export function clearLedgerCache() {
  _cachedPromise = null;
  _cachedResult = null;
  _cachedError = null;
  _lastFetchedUtc = "";
  _lastSource = "";
}

export function getLedgerCacheInfo() {
  return {
    hasResult: Boolean(_cachedResult),
    hasError: Boolean(_cachedError),
    inFlight: Boolean(_cachedPromise),
    lastFetchedUtc: _lastFetchedUtc,
    lastSource: _lastSource,
  };
}

export async function getLedgerEventsCached(asoraGetJson) {
  if (_cachedResult) {
    _lastSource = "cached";
    return _cachedResult;
  }
  if (_cachedError) throw _cachedError;
  if (_cachedPromise) return _cachedPromise;

  _cachedPromise = (async () => {
    try {
      const r = await asoraGetJson("/v1/ledger/events", {});
      const events = Array.isArray(r?.events) ? r.events : [];
      const out = { events };
      _cachedResult = out;
      _lastFetchedUtc = new Date().toISOString();
      _lastSource = "fresh";
      return out;
    } catch (e) {
      _cachedError = e;
      throw e;
    } finally {
      _cachedPromise = null;
    }
  })();

  return _cachedPromise;
}
