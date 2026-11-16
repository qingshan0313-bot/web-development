/** Same-origin relay for the user's own Ark key. No credentials or media are saved. */
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
let activeRequests = 0;

function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function sameOrigin(request) {
  try {
    const origin = new URL(request.headers.origin);
    return (
      ["http:", "https:"].includes(origin.protocol) &&
      origin.host === request.headers.host &&
      request.headers["x-qs-smart"] === "1"
    );
  } catch {
    return false;
  }
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
    if (!Array.isArray(parts) || !parts.length || parts.length > 10)
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

async function readBody(request, signal) {
  signal.throwIfAborted();
  if (Number(request.headers["content-length"]) > MAX_REQUEST_BYTES)
    throw failure(413, "抽取画面过大，请降低画面尺寸后重试。");
  const chunks = [];
  let size = 0;
  const cancel = () => request.destroy();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES)
        throw failure(413, "抽取画面过大，请降低画面尺寸后重试。");
      chunks.push(chunk);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw failure(400, "AI 请求内容不是有效 JSON。");
  }
}

async function readUpstream(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_RESPONSE_BYTES)
      throw failure(502, "AI 返回内容过长，请重试。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw failure(502, "AI 服务未返回有效 JSON，请检查模型与接口地址。");
  }
}

export async function handleSmartRequest(request, response) {
  let pathname;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    return false;
  }
  if (pathname === "/api/capabilities") {
    sendJson(
      response,
      request.method === "GET" ? 200 : 405,
      request.method === "GET"
        ? { smartAiRelay: true }
        : { error: { message: "仅支持 GET。" } },
    );
    return true;
  }
  if (pathname !== "/api/smart/analyze") return false;
  if (request.method !== "POST") {
    sendJson(response, 405, { error: { message: "仅支持 POST。" } });
    return true;
  }
  if (!sameOrigin(request)) {
    sendJson(response, 403, {
      error: { message: "请从本工具台发起分析请求。" },
    });
    return true;
  }
  if (
    !/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")
  ) {
    sendJson(response, 415, { error: { message: "请求需要使用 JSON。" } });
    return true;
  }
  if (activeRequests >= 4) {
    sendJson(response, 429, {
      error: { message: "当前分析较多，请稍后重试。" },
    });
    return true;
  }
  activeRequests++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const cancel = () => {
    if (!response.writableEnded) controller.abort();
  };
  request.once("aborted", cancel);
  response.once("close", cancel);
  try {
    const { endpoint, apiKey, payload } = validatePayload(
      await readBody(request, controller.signal),
    );
    controller.signal.throwIfAborted();
    const upstream = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const status = [400, 401, 403, 404, 429].includes(upstream.status)
        ? upstream.status
        : 502;
      const reason = {
        400: "模型或请求不受支持，请确认模型支持视觉输入。",
        401: "API Key 无效，请检查并重新填写。",
        403: "当前 Key 没有权限使用此模型，请检查服务开通状态。",
        404: "未找到模型或接口，请填写控制台已启用的模型 ID。",
        429: "服务额度不足或请求过于频繁，请稍后重试。",
        502: "AI 服务暂时不可用，请稍后重试。",
      }[status];
      throw failure(status, reason);
    }
    sendJson(response, 200, await readUpstream(upstream));
  } catch (error) {
    sendJson(
      response,
      error.status || (controller.signal.aborted ? 504 : 502),
      {
        error: {
          message: error.status
            ? error.message
            : controller.signal.aborted
              ? "AI 分析已取消或超时，请重试。"
              : "无法连接 AI 服务，请检查网络后重试。",
        },
      },
    );
  } finally {
    clearTimeout(timer);
    request.removeListener("aborted", cancel);
    response.removeListener("close", cancel);
    activeRequests--;
  }
  return true;
}
