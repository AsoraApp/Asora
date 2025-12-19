export function getBaseUrl() {
  // Prefer explicit env var for deployments, otherwise default to your Worker.
  // Do not guess tenant. Dev token is UI-provided.
  return process.env.NEXT_PUBLIC_ASORA_BASE_URL || "https://asora.dblair1027.workers.dev";
}
