// backend/src/index.worker.mjs
import { handleFetch } from "./worker/handleFetch.mjs";

/**
 * ASORA — Cloudflare Worker entrypoint
 * This is the file Wrangler must deploy via wrangler.jsonc "main".
 */
export default {
  async fetch(request, env, ctx) {
    return handleFetch(request, env, ctx);
  },
};
