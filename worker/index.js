import { handleSmartRelay, isSmartRelayPath } from "./smart-relay-core.mjs";

export default {
  async fetch(request, env) {
    if (isSmartRelayPath(new URL(request.url).pathname))
      return handleSmartRelay(request, { maxConcurrent: 2 });
    return env.ASSETS.fetch(request);
  },
};
