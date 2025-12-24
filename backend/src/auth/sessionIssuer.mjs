// backend/src/auth/sessionIssuer.mjs
import { signSessionToken } from "./token.worker.mjs";

export async function issueSession({ tenantId, subject, claims }, env) {
  return signSessionToken(
    {
      tenantId,
      sub: subject,
      claims,
    },
    env
  );
}
