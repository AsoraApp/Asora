import LedgerClient from "./ui/LedgerClient";
import AdminHeader from "../_ui/AdminHeader.jsx";
import { getStoredDevToken } from "@/lib/asoraFetch";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function LedgerPage() {
  const tenantId = getStoredDevToken?.() || "";

  return (
    <main style={styles.shell}>
      <AdminHeader
        title="Ledger Viewer"
        subtitle={
          <>
            Read-only. Fetches <code style={styles.code}>GET /v1/ledger/events</code> using dev_token.
          </>
        }
        tenantId={tenantId}
      />

      <LedgerClient />
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", background: "#0b0f14", color: "#e6edf3", padding: 24 },
  code: { background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 8 },
};
