"use client";

export const runtime = "edge";

/**
 * Client-only, per-tab, in-memory cache for ledger events.
 * - No timers (deterministic)
 * - Cache is cleared only by calling clearLedgerCache() or hard refresh.
 * - dev_token is already handled by asoraFetch; cache is therefore per-tab and shared across views.
 */

let _cachedPromise = null;
let _cachedResult = null;
let _cachedError = null;

export function clearLedgerCache() {
  _cachedPromise = null;
  _cachedResult = null;
  _cachedError = null;
}

export async function getLedgerEventsCached(asoraGetJson) {
  if (_cachedResult) return _cachedResult;
  if (_cachedError) throw _cachedError;
  if (_cachedPromise) return _cachedPromise;

  _cachedPromise = (async () => {
    try {
      const r = await asoraGetJson("/v1/ledger/events", {});
      const events = Array.isArray(r?.events) ? r.events : [];
      const out = { events };
      _cachedResult = out;
      return out;
    } catch (e) {
      _cachedError = e;
      throw e;
    } finally {
      // Keep the result/error; clear the in-flight promise.
      _cachedPromise = null;
    }
  })();

  return _cachedPromise;
}
