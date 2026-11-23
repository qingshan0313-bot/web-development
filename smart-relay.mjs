import { Readable } from "node:stream";
import { handleSmartRelay, isSmartRelayPath } from "./worker/smart-relay-core.mjs";

function expectedOrigin(request) {
  try {
    const origin = new URL(request.headers.origin);
    if (["https:", "http:"].includes(origin.protocol) && origin.host === request.headers.host)
      return origin.origin;
  } catch {}
  return null;
}

export async function handleSmartRequest(request, response) {
  let url;
  try {
    url = new URL(request.url, "http://localhost");
  } catch {
    return false;
  }
  if (!isSmartRelayPath(url.pathname)) return false;

  const controller = new AbortController();
  const cancel = () => {
    if (!response.writableEnded) controller.abort();
  };
  request.once("aborted", cancel);
  response.once("close", cancel);
  try {
    const allowedMethod = url.pathname === "/api/capabilities" ? "GET" : "POST";
    const method = request.method === allowedMethod ? allowedMethod : "OPTIONS";
    const body = method === "POST" ? Readable.toWeb(request) : undefined;
    const input = new Request(url, {
      method, headers: request.headers, body, duplex: "half", signal: controller.signal,
    });
    const result = await handleSmartRelay(input, { expectedOrigin: expectedOrigin(request) });
    const data = Buffer.from(await result.arrayBuffer());
    if (!response.destroyed && !response.writableEnded) {
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(data);
    }
  } finally {
    request.removeListener("aborted", cancel);
    response.removeListener("close", cancel);
  }
  return true;
}
