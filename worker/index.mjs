import { createRequire } from "module";
const require = createRequire(import.meta.url);

const { handleFetch } = require("../backend/src/worker/handleFetch");

export default {
  async fetch(request, env, ctx) {
    return handleFetch(request, env, ctx);
  }
};
