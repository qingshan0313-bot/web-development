/** Ark analysis relay shared by the local server and the hosted Site. */
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const UPSTREAM_ERRORS = {
  400: "模型或请求不受支持，请确认模型支持视觉输入。",
  401: "API Key 无效，请检查并重新填写。",
  403: "当前 Key 没有权限使用此模型，请检查服务开通状态。",
  404: "未找到模型或接口，请填写控制台已启用的模型 ID。",
  413: "火山方舟拒绝了过大的抽帧请求。",
  422: "火山方舟不接受当前模型或图片参数。",
  429: "服务额度不足或请求过于频繁，请稍后重试。",
};
let activeRequests = 0;

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function errorResponse(message, status, headers) {
  return json({ error: { message } }, status, headers);
}

export function isSmartRelayPath(pathname) {
  return pathname === "/api/capabilities" || pathname === "/api/smart/analyze";
}

function failure(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function relayFailure(code, message, status, details = {}) {
  console.warn("Ark relay failure", { code, ...details });
  return json({ error: { code, message } }, status);
}

function validatePayload(body) {
  let endpoint;
  try {
    endpoint = new URL(body?.endpoint);
  } catch {
    throw failure(400, "API 地址无效。");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "ark.cn-beijing.volces.com" ||
    endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !["/api/v3/chat/completions", "/api/plan/v3/chat/completions"].includes(
      endpoint.pathname,
    )
  )
    throw failure(
      400,
      "本应用仅转发火山方舟官方接口；其他服务请使用支持浏览器跨域访问的地址。",
    );
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey))
    throw failure(400, "请填写有效的 API Key。");
  const payload = body.payload;
  if (
    !payload ||
    typeof payload.model !== "string" ||
    !payload.model.trim() ||
    payload.model.length > 200 ||
    !Array.isArray(payload.messages) ||
    !payload.messages.length ||
    payload.messages.length > 4
  )
    throw failure(400, "AI 请求参数无效。");
  let images = 0;
  const messages = payload.messages.map((message) => {
    if (!message || !["system", "user"].includes(message.role))
      throw failure(400, "AI 消息类型无效。");
    const parts =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content;
    if (!Array.isArray(parts) || !parts.length || parts.length > 17)
      throw failure(400, "AI 消息内容无效。");
    const content = parts.map((part) => {
      if (
        part?.type === "text" &&
        typeof part.text === "string" &&
        part.text.length <= 30000
      )
        return { type: "text", text: part.text };
      if (
        part?.type === "image_url" &&
        typeof part.image_url?.url === "string" &&
        /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(
          part.image_url.url,
        )
      ) {
        images++;
        return { type: "image_url", image_url: { url: part.image_url.url } };
      }
      throw failure(400, "仅支持文字与本地抽取的图片，不支持远程媒体地址。");
    });
    return {
      role: message.role,
      content: typeof message.content === "string" ? content[0].text : content,
    };
  });
  if (images < 1 || images > 8) throw failure(400, "每次分析需要 1–8 张画面。");
  return {
    endpoint: endpoint.href,
    apiKey,
    payload: {
      model: payload.model.trim(),
      messages,
      stream: false,
      max_tokens: Math.min(
        4096,
        Math.max(256, Number(payload.max_tokens) || 2000),
      ),
      temperature: Math.min(2, Math.max(0, Number(payload.temperature) || 0)),
    },
  };
}

async function readJson(message, signal, limit, tooLarge, invalid) {
  signal.throwIfAborted();
  if (Number(message.headers.get("content-length")) > limit) throw tooLarge;
  if (!message.body) throw invalid;

  const reader = message.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        cancel();
        throw tooLarge;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw invalid;
  }
}

export async function handleSmartRelay(
  request,
  { expectedOrigin = new URL(request.url).origin, maxConcurrent = 4 } = {},
) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/capabilities") {
    return request.method === "GET"
      ? json({ smartAiRelay: true })
      : errorResponse("仅支持 GET。", 405, { Allow: "GET" });
  }
  if (pathname !== "/api/smart/analyze") return null;
  if (request.method !== "POST")
    return errorResponse("仅支持 POST。", 405, { Allow: "POST" });
  if (
    !expectedOrigin ||
    request.headers.get("origin") !== expectedOrigin ||
    request.headers.get("x-qs-smart") !== "1"
  )
    return errorResponse("请从本工具台发起分析请求。", 403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || ""))
    return errorResponse("请求需要使用 JSON。", 415);
  if (activeRequests >= maxConcurrent)
    return errorResponse("当前分析较多，请稍后重试。", 429, { "Retry-After": "2" });

  activeRequests++;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 90000);
  const signal = AbortSignal.any([request.signal, timeout.signal]);
  let stage = "request";
  try {
    const body = await readJson(
      request,
      signal,
      MAX_REQUEST_BYTES,
      failure(413, "抽取画面过大，请降低画面尺寸后重试。"),
      failure(400, "AI 请求内容不是有效 JSON。"),
    );
    const { endpoint, apiKey, payload } = validatePayload(body);
    stage = "fetch";
    const upstream = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {});
      const status = upstream.status;
      if (Object.hasOwn(UPSTREAM_ERRORS, status)) {
        const retryAfter = status === 429 ? upstream.headers.get("retry-after") : null;
        return errorResponse(
          UPSTREAM_ERRORS[status],
          status,
          retryAfter ? { "Retry-After": retryAfter } : undefined,
        );
      }
      return relayFailure(
        "ARK_HTTP",
        `火山方舟返回 HTTP ${status}，请稍后重试。`,
        502,
        { upstreamStatus: status },
      );
    }
    stage = "response";
    const result = await readJson(
      upstream,
      signal,
      MAX_RESPONSE_BYTES,
      failure(502, "火山方舟返回内容过长，请重试。", "ARK_RESPONSE_SIZE"),
      failure(502, "火山方舟未返回有效 JSON，请检查模型与接口地址。", "ARK_RESPONSE_FORMAT"),
    );
    return json(result);
  } catch (error) {
    if (error.status) {
      return error.code
        ? relayFailure(error.code, error.message, error.status)
        : errorResponse(error.message, error.status);
    }
    if (signal.aborted)
      return relayFailure("ARK_TIMEOUT", "方舟转发已取消或超时，请重试。", 504, { stage });
    if (stage === "request")
      return relayFailure("ARK_REQUEST_READ", "站点未能读取完整的分析请求，请重试。", 400);
    if (stage === "response")
      return relayFailure("ARK_RESPONSE_READ", "站点未能读取完整的方舟响应，请重试。", 502);
    const networkCode = error.cause?.code;
    const errorKind = typeof error.name === "string" && /^[A-Za-z]{3,32}$/.test(error.name)
      ? error.name
      : "Error";
    const transportError = String(error.message || "");
    const reason = [
      [/outbound|egress|denied|policy|blocked|not allowed/i, "access"],
      [/dns|resolve|enotfound/i, "dns"],
      [/tls|ssl|certificate/i, "tls"],
      [/redirect/i, "redirect"],
      [/connection|network/i, "network"],
      [/timeout|timed out/i, "timeout"],
    ].find(([pattern]) => pattern.test(transportError))?.[1] ?? "unknown";
    const details = { errorKind, reason };
    if (typeof networkCode === "string" && /^[A-Z_]{3,32}$/.test(networkCode))
      details.networkCode = networkCode;
    return relayFailure("ARK_CONNECT", "站点转发服务未能连接火山方舟，请稍后重试。", 502, details);
  } finally {
    clearTimeout(timer);
    activeRequests--;
  }
}
