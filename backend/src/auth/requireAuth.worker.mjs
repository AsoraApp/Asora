// backend/src/auth/requireAuth.worker.mjs
import { verifySessionToken } from "./token.worker.mjs";

export async function requireAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer (.+)$/);

  if (!match) return null;

  try {
    return await verifySessionToken(match[1], env);
  } catch {
    return null;
  }
}
