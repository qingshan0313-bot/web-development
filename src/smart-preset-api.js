import { normalizeSmartUniform } from "./smart-model.js";

export const SMART_PRESET_PATH = "/api/smart/presets";
const MAX_BODY_BYTES = 16_384;
const MAX_PRESETS = 100;

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function readPreset(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function handleSmartPresets(request, db) {
  // Sites dispatch supplies the authenticated ID on hosted requests.
  const owner = request.headers.get("oai-authenticated-user-id");
  if (!owner) return json({ error: "请先用 ChatGPT 登录。" }, 401);
  if (request.method !== "GET" && request.method !== "POST")
    return json({ error: "不支持此操作。" }, 405);
  if (!db) return json({ error: "预设数据库暂不可用。" }, 503);

  try {
    if (request.method === "GET") {
      const { results } = await db.prepare(
        "SELECT id, name, settings FROM smart_presets WHERE owner_id = ? ORDER BY created_at DESC, id DESC",
      ).bind(owner).all();
      return json({
        presets: results.map(({ id, name, settings }) => ({
          id, name, ...normalizeSmartUniform(JSON.parse(settings)),
        })),
      });
    }

    if (request.headers.get("Origin") !== new URL(request.url).origin)
      return json({ error: "请从 Frame 页面保存预设。" }, 403);
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ error: "预设格式有误。" }, 415);

    const payload = await readPreset(request);
    const name = typeof payload?.name === "string" ? payload.name.trim() : "";
    if (!name || name.length > 60)
      return json({ error: "请输入 1 到 60 个字符的预设名称。" }, 400);

    const settings = normalizeSmartUniform(payload);
    const id = crypto.randomUUID();
    const result = await db.prepare(`
      INSERT INTO smart_presets (owner_id, id, name, settings, created_at)
      SELECT ?, ?, ?, ?, ?
      WHERE (SELECT count(*) FROM smart_presets WHERE owner_id = ?) < ?
      ON CONFLICT(owner_id, name) DO NOTHING
    `).bind(owner, id, name, JSON.stringify(settings), Date.now(), owner, MAX_PRESETS).run();
    if (!result.meta.changes) {
      const existing = await db.prepare(
        "SELECT id FROM smart_presets WHERE owner_id = ? AND name = ?",
      ).bind(owner, name).first();
      return json({ error: existing ? "已有同名预设，请换个名称。" : "每个账号最多保存 100 个预设。" }, 409);
    }
    return json({ preset: { id, name, ...settings } }, 201);
  } catch {
    return json({ error: "预设服务暂不可用，请稍后重试。" }, 503);
  }
}
