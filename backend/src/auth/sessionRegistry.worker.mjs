// backend/src/auth/sessionRegistry.worker.mjs
import { SessionRegistry } from "./sessionRegistry.do.mjs";

export const SessionRegistryDO = {
  fetch(request, env) {
    return new SessionRegistry(env).fetch(request);
  },
};
