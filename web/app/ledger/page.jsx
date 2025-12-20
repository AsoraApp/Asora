"use client";

import LedgerClient from "./ui/LedgerClient";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function LedgerPage() {
  return (
    <main style={styles.shell}>
      <LedgerClient />
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24 },
};
