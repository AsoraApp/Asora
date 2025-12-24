// backend/src/auth/bootstrapCookie.worker.mjs
import { makeSetCookie } from "./cookies.worker.mjs";

export function issueBootstrapCookie(identity, env) {
  const secret = env.AUTH_SECRET;
  const body = JSON.stringify(identity);

  return makeSetCookie({
    name: "__asora_boot",
    value: btoa(body),
    maxAgeSec: 60,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
}
