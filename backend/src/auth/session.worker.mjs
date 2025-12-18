// Run this in Chrome DevTools Console (on any page)

(async () => {
  const BASE = "https://asora.dblair1027.workers.dev";
  const TOKEN = "dev-test-token"; // any non-empty string works per resolveSessionFromHeaders()

  async function hit(path) {
    const r = await fetch(`${BASE}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
      },
    });
    const text = await r.text();
    console.log("=== GET", path, "===");
    console.log("STATUS:", r.status);
    console.log("BODY:", text);
    return { status: r.status, body: text };
  }

  await hit("/api/auth/me");
  await hit("/api/inventory/items");
})();
