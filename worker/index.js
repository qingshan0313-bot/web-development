import { handleSmartPresets, SMART_PRESET_PATH } from "../src/smart-preset-api.js";
import { handleSmartRelay, isSmartRelayPath } from "./smart-relay-core.mjs";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === SMART_PRESET_PATH) return handleSmartPresets(request, env.DB);
    if (isSmartRelayPath(pathname))
      return handleSmartRelay(request, { maxConcurrent: 2 });
    return env.ASSETS.fetch(request);
  },
};
