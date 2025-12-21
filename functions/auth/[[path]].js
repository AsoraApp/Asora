// functions/auth/[[path]].js
/**
 * Cloudflare Pages Function: /auth/* proxy -> Asora Worker
 *
 * Supports legacy UI calls like /auth/me (Worker normalizes /auth/me -> /api/auth/me).
 */

const DEFAULT_ORIGIN = "https://asora-ui.dblair1027.workers.dev";

function getWorkerOrigin(env) {
  const v = (env?.ASORA_WORKER_ORIGIN || "").trim();
  return v || DEFAULT_ORIGIN;
}

function stripHopByHopHeaders(headers) {
  const h = new Headers(headers);
  h.delete("connection");
  h.delete("keep-alive");
  h.delete("proxy-authenticate");
  h.delete("proxy-authorization");
  h.delete("te");
  h.delete("trailers");
  h.delete("transfer-encoding");
  h.delete("upgrade");
  h.delete("host");
  return h;
}

export async function onRequest(context) {
