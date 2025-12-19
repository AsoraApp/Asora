export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function AuditPage() {
  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Audit Log</h1>
      <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85, maxWidth: 760, lineHeight: 1.5 }}>
        Not available yet.
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75, maxWidth: 760, lineHeight: 1.5 }}>
        This UI is a placeholder only. No audit read endpoint is currently wired in this console.
      </div>
    </main>
  );
}
