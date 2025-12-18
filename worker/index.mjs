// worker/index.mjs
import { handleFetch as namedHandleFetch } from "../backend/src/worker/handleFetch.mjs";
import defaultHandleFetch from "../backend/src/worker/handleFetch.mjs";

function resolveHandleFetch() {
  if (typeof namedHandleFetch === "function") return namedHandleFetch;
  if (typeof defaultHandleFetch === "function") return defaultHandleFetch;
  if (defaultHandleFetch && typeof defaultHandleFetch.handleFetch === "function") return defaultHandleFetch.handleFetch;
  throw new Error("WORKER_ENTRYPOINT_INVALID: handleFetch not found");
}

const handleFetch = resolveHandleFetch();

export default {
  async fetch(request, env, ctx) {
    // All routing/auth/audit behavior lives in backend/src/worker/handleFetch.mjs
    return handleFetch(request, env, ctx);
  },
};
