"use client";

import { useEffect, useState } from "react";

export const runtime = "edge";

function safeGet(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return typeof v === "string" ? v : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

/**
 * usePersistedString
 * - client-only
 * - deterministic default
 * - persists on change
 */
export function usePersistedString(storageKey, defaultValue = "") {
  const [value, setValue] = useState(() => safeGet(storageKey, defaultValue));

  // keep in sync across tabs
  useEffect(() => {
    function onStorage(e) {
      if (e.key === storageKey) setValue(typeof e.newValue === "string" ? e.newValue : defaultValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey, defaultValue]);

  useEffect(() => {
    safeSet(storageKey, value ?? "");
  }, [storageKey, value]);

  return [value, setValue];
}
