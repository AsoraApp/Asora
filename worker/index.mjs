import handleFetch from "../backend/src/worker/handleFetch.mjs";

export default {
  async fetch(request, env, ctx) {
    return handleFetch(request, env, ctx);
  }
};

