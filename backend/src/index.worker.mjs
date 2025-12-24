// backend/src/index.worker.mjs
//
// U20: Worker entrypoint.
// - MUST export Durable Object classes referenced by wrangler bindings.
// - MUST export the fetch handler used by the service.
//
// Wrangler error being fixed:
// "Durable Objects ... not exported in your entrypoint file: SessionRegistryDO."

import { handleFetch } from "./worker/handleFetch.mjs";
import { SessionRegistryDO } from "./auth/sessionRegistry.do.mjs";

// Durable Object export (required by wrangler binding: class_name = "SessionRegistryDO")
export { SessionRegistryDO };

// Service Worker fetch export
export default {
  async fetch(request, env, ctx) {
    return handleFetch(request, env, ctx);
  },
};
