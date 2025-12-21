// backend/src/index.worker.mjs
import { handleFetch } from "./worker/handleFetch.mjs";

/**
 * ASORA — Cloudflare Worker entrypoint (Modules syntax)
 *
 * Wrangler MUST deploy this file via wrangler.jsonc "main".
 * This entrypoint is intentionally thin:
 * - no side effects
 * - no state
 * - delegates all routing to backend/src/worker/handleFetch.mjs
 */
export default {
  async fetch(request, env, cfctx) {
    return handleFetch(request, env, cfctx);
  },
};
