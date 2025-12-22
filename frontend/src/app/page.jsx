import Link from "next/link";

export const runtime = "edge";

export default function HomePage() {
  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>Asora Admin Console</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        U15-1: Bearer onboarding + validation is available under Auth.
      </p>

      <hr />

      <div className="row">
        <Link className="button" href="/auth">
          Go to Auth
        </Link>
      </div>
    </div>
  );
}
