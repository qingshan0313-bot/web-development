/** Pure pairing, validation and duplicate detection for browser-local batch mixing. */
export const MIX_DEFAULTS = Object.freeze({
  mode: "single",
  skipCompleted: true,
  width: 720,
  height: 1280,
  fps: 30,
  format: "mp4",
  fit: "contain",
  backgroundColor: "#000000",
  transparentBackground: true,
  videoBitsPerSecond: 6000000,
  prefix: "QS_混剪",
});

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function numeric(value, label, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (
    typeof value !== "number" &&
    !(
      typeof value === "string" &&
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
    )
  )
    throw new Error(`${label}必须是有效数字。`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label}必须是有限数字。`);
  return result;
}

function boundedNumber(value, label, fallback, min, max, integer = false) {
  const result = numeric(value, label, fallback);
  if (result < min || result > max || (integer && !Number.isInteger(result))) {
    throw new Error(
      `${label}必须是 ${min}–${max} 范围内的${integer ? "整数" : "数字"}。`,
    );
  }
  return result;
}

function option(value, allowed, fallback, label) {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) throw new Error(`${label}无效，请重新选择。`);
  return value;
}

/** Keep only supported settings; invalid values are never silently clamped. */
export function normalizeMixSettings(value = {}) {
  if (!isObject(value))
    throw new Error("混剪设置格式无效，请使用有效的项目设置。");
  const width = boundedNumber(
    value.width,
    "输出宽度",
    MIX_DEFAULTS.width,
    2,
    3840,
    true,
  );
  const height = boundedNumber(
    value.height,
    "输出高度",
    MIX_DEFAULTS.height,
    2,
    3840,
    true,
  );
  if (width % 2 || height % 2) throw new Error("输出宽度和高度必须是偶数。");
  if (
    value.skipCompleted !== undefined &&
    typeof value.skipCompleted !== "boolean"
  ) {
    throw new Error("跳过已完成任务必须为开启或关闭。");
  }
  if (
    value.transparentBackground !== undefined &&
    typeof value.transparentBackground !== "boolean"
  ) {
    throw new Error("透明留边必须为开启或关闭。");
  }
  let backgroundColor =
    value.backgroundColor === undefined
      ? MIX_DEFAULTS.backgroundColor
      : value.backgroundColor;
  if (
    typeof backgroundColor !== "string" ||
    !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(backgroundColor.trim())
  ) {
    throw new Error("背景颜色必须是有效的 HEX 色值，例如 #000000。");
  }
  backgroundColor = backgroundColor.trim().toLowerCase();
  if (backgroundColor.length === 4) {
    backgroundColor = `#${Array.from(backgroundColor.slice(1), (char) => char + char).join("")}`;
  }
  let prefix = value.prefix === undefined ? MIX_DEFAULTS.prefix : value.prefix;
  if (typeof prefix !== "string") throw new Error("文件名前缀必须是文字。");
  if (Array.from(prefix).length > 80)
    throw new Error("文件名前缀最多 80 个字符。");
  prefix =
    prefix
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
      .trim()
      .replace(/[. ]+$/g, "") || MIX_DEFAULTS.prefix;
  return {
    mode: option(
      value.mode,
      ["single", "all", "ordered"],
      MIX_DEFAULTS.mode,
      "组合方式",
    ),
    skipCompleted: value.skipCompleted ?? MIX_DEFAULTS.skipCompleted,
    width,
    height,
    fps: boundedNumber(value.fps, "帧率", MIX_DEFAULTS.fps, 1, 60, true),
    format: option(
      value.format,
      ["mp4", "mov", "webm"],
      MIX_DEFAULTS.format,
      "输出格式",
    ),
    fit: option(
      value.fit,
      ["contain", "cover"],
      MIX_DEFAULTS.fit,
      "画面适配方式",
    ),
    backgroundColor,
    transparentBackground:
      value.transparentBackground ?? MIX_DEFAULTS.transparentBackground,
    videoBitsPerSecond: boundedNumber(
      value.videoBitsPerSecond,
      "视频码率",
      MIX_DEFAULTS.videoBitsPerSecond,
      1000000,
      20000000,
      true,
    ),
    prefix,
  };
}

/** File identity uses metadata only and does not read or upload file contents. */
export function mixAssetKey(file) {
  if (!isObject(file) || typeof file.name !== "string" || !file.name.length) {
    throw new Error("素材文件信息不完整，无法识别文件。");
  }
  const size = boundedNumber(
    file.size,
    "素材文件大小",
    undefined,
    0,
    Number.MAX_SAFE_INTEGER,
    true,
  );
  const lastModified = boundedNumber(
    file.lastModified,
    "素材修改时间",
    0,
    0,
    Number.MAX_SAFE_INTEGER,
    true,
  );
  return `asset-v1:${encodeURIComponent(JSON.stringify([file.name, size, lastModified]))}`;
}

function normalizeAsset(asset, index, kind, fps) {
  const label = `${kind}第 ${index + 1} 项`;
  if (!isObject(asset)) throw new Error(`${label}的素材信息无效。`);
  if (
    typeof asset.id !== "string" ||
    !asset.id.length ||
    asset.id.length > 200
  ) {
    throw new Error(`${label}缺少有效素材标识，请重新添加。`);
  }
  if (
    typeof asset.key !== "string" ||
    !asset.key.length ||
    asset.key.length > 8192
  ) {
    throw new Error(`${label}缺少有效文件标识，请重新添加。`);
  }
  if (
    typeof asset.name !== "string" ||
    !asset.name.length ||
    asset.name.length > 1024
  ) {
    throw new Error(`${label}缺少有效文件名。`);
  }
  const duration = numeric(asset.duration, `${label}的视频时长`);
  if (duration <= 0) throw new Error(`${label}的视频时长必须大于 0 秒。`);
  let start = numeric(asset.start, `${label}的开始时间`, 0);
  let end = numeric(asset.end, `${label}的结束时间`, duration);
  const volume = boundedNumber(asset.volume, `${label}的音量`, 1, 0, 2);
  const epsilon = Math.max(
    1e-8,
    Number.EPSILON * Math.max(1, duration, Math.abs(start), Math.abs(end)) * 16,
  );
  if (start < -epsilon || end > duration + epsilon) {
    throw new Error(`${label}的裁切范围必须位于 0–${duration} 秒之间。`);
  }
  start = Math.max(0, start);
  end = Math.min(duration, end);
  if (end <= start) throw new Error(`${label}的结束时间必须大于开始时间。`);
  if (end - start < 1 / fps - epsilon) {
    throw new Error(
      `${label}裁切后不足一帧，请至少保留 ${(1 / fps).toFixed(4)} 秒（${fps} fps）。`,
    );
  }
  return {
    id: asset.id,
    key: asset.key,
    name: asset.name,
    duration,
    start,
    end,
    volume,
  };
}

function selectedAssets(value, kind, fps) {
  if (!Array.isArray(value)) throw new Error(`${kind}素材必须是文件列表。`);
  const selected = value.filter((asset) => asset?.selected !== false);
  if (!selected.length) throw new Error(`请至少选择一个${kind}素材。`);
  const assets = selected.map((asset, index) =>
    normalizeAsset(asset, index, kind, fps),
  );
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) {
    throw new Error(`${kind}素材标识重复，请移除重复素材后重试。`);
  }
  return assets;
}

function jobKey(hook, body, settings) {
  return `mix-v1:${encodeURIComponent(
    JSON.stringify([
      [hook.key, hook.start, hook.end, hook.volume],
      [body.key, body.start, body.end, body.volume],
      [
        settings.width,
        settings.height,
        settings.fps,
        settings.format,
        settings.fit,
        settings.backgroundColor,
        settings.videoBitsPerSecond,
        settings.format === "mov" && settings.transparentBackground,
      ],
    ]),
  )}`;
}

/** The maximum applies after completed jobs are skipped; no queue is truncated. */
export function buildMixQueue(hooks, bodies, value = {}, records = []) {
  const settings = normalizeMixSettings(value);
  const selectedHooks = selectedAssets(hooks, "片头", settings.fps);
  const selectedBodies = selectedAssets(bodies, "成片", settings.fps);
  if (settings.mode === "single" && selectedHooks.length !== 1) {
    throw new Error("单片头模式需要恰好选择一个片头，可选择多个成片。");
  }
  if (
    settings.mode === "ordered" &&
    selectedHooks.length !== selectedBodies.length
  ) {
    throw new Error("按顺序配对要求选中的片头和成片数量相同。");
  }
  const total =
    settings.mode === "ordered"
      ? selectedHooks.length
      : selectedHooks.length * selectedBodies.length;
  if (!Number.isSafeInteger(total))
    throw new Error("组合数量过多，请减少选中的素材。");
  const completed = new Set(
    settings.skipCompleted
      ? normalizeMixRecords(records)
          .filter(
            (record) =>
              record.status === "generated" || record.status === "completed",
          )
          .map((record) => record.key)
      : [],
  );
  const jobs = [];
  let skipped = 0,
    pairIndex = 0;
  const add = (hook, body) => {
    pairIndex++;
    const key = jobKey(hook, body, settings);
    if (completed.has(key)) {
      skipped++;
      return;
    }
    if (jobs.length >= 50)
      throw new Error(
        "待处理任务超过 50 个，请减少组合，或开启跳过已完成任务后重试。",
      );
    const duration = hook.end - hook.start + (body.end - body.start);
    if (!Number.isFinite(duration))
      throw new Error("组合总时长无效，请重新选择素材。");
    jobs.push({
      id: `mix-${pairIndex}`,
      key,
      hookId: hook.id,
      bodyId: body.id,
      hookName: hook.name,
      bodyName: body.name,
      duration,
      status: "pending",
    });
  };
  if (settings.mode === "ordered") {
    selectedHooks.forEach((hook, index) => add(hook, selectedBodies[index]));
  } else {
    for (const hook of selectedHooks)
      for (const body of selectedBodies) add(hook, body);
  }
  return { jobs, skipped, total };
}

function recordText(value, max, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[<>\u0000-\u001f\u007f]/.test(value)
  )
    return null;
  if (!allowEmpty && !value.trim()) return null;
  return value;
}

function isoTimestamp(value) {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return date.getUTCFullYear() >= 0 && date.getUTCFullYear() <= 9999
    ? date.toISOString()
    : null;
}

/** Keep the first 500 valid plain-data records, preserving caller-supplied order. */
export function normalizeMixRecords(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const record of value) {
    if (
      !isObject(record) ||
      !["generated", "completed", "failed"].includes(record.status)
    )
      continue;
    const key = recordText(record.key, 65536);
    const hookName = recordText(record.hookName, 1024);
    const bodyName = recordText(record.bodyName, 1024);
    const outputName = recordText(
      record.outputName,
      1024,
      record.status === "failed",
    );
    const createdAt = isoTimestamp(record.createdAt);
    if (
      key === null ||
      hookName === null ||
      bodyName === null ||
      outputName === null ||
      createdAt === null
    )
      continue;
    result.push({
      key,
      hookName,
      bodyName,
      outputName,
      status: record.status,
      createdAt,
    });
    if (result.length === 500) break;
  }
  return result;
}
