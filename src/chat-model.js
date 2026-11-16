/** Serializable, deterministic model for the chat typing animation editor. */
export const CHAT_DEFAULTS = Object.freeze({
  version: 1,
  title: "创作伙伴",
  messages: Object.freeze([
    Object.freeze({
      id: "message-1",
      side: "left",
      text: "你现在有空吗？",
      hold: 1.2,
    }),
    Object.freeze({
      id: "message-2",
      side: "right",
      text: "有呀，怎么了？",
      hold: 1.2,
    }),
    Object.freeze({
      id: "message-3",
      side: "left",
      text: "想和你一起看一场电影。",
      hold: 1.2,
    }),
    Object.freeze({
      id: "message-4",
      side: "right",
      text: "好，今晚见。",
      hold: 1.5,
    }),
  ]),
  typingSpeed: 6,
  startHold: 1,
  endHold: 2,
  afterTyping: "send",
  keyboardLayout: "qwerty",
  keyboardLanguage: "en",
  backgroundMode: "light",
  backgroundColor: "#f5f5f7",
  fontSize: 34,
  showKeyHint: true,
  showHeader: true,
  leftBubble: "#ffffff",
  rightBubble: "#1265ff",
  leftText: "#222222",
  rightText: "#ffffff",
  outputWidth: 720,
  outputHeight: 1280,
  fps: 30,
  videoBitrate: 6000000,
  outputFormat: "mp4",
  transparentBackground: true,
  fileName: "Frame_对话动画",
});

const choices = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;
const number = (value, fallback, min, max) => {
  const parsed =
    typeof value === "number" || (typeof value === "string" && value.trim())
      ? Number(value)
      : NaN;
  return Math.min(
    max,
    Math.max(min, Number.isFinite(parsed) ? parsed : fallback),
  );
};
const boolean = (value, fallback) =>
  typeof value === "boolean" ? value : fallback;
const color = (value, fallback) => {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(candidate)) return candidate;
  if (/^#[0-9a-f]{3}$/.test(candidate))
    return `#${Array.from(candidate.slice(1), (char) => char + char).join("")}`;
  return fallback;
};
const boundedText = (value, fallback, max, label) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new Error(`${label}必须是文字。`);
  if (Array.from(value).length > max)
    throw new Error(`${label}最多 ${max} 个字符，请缩短后重试。`);
  return value;
};

/** Unknown keys are discarded. Overlong text is rejected rather than truncated. */
export function normalizeChatProject(input = CHAT_DEFAULTS) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("对话项目格式无效，请选择正确的 JSON 项目文件。");
  if (input.version !== undefined && input.version !== 1)
    throw new Error("暂不支持此对话项目版本，请使用版本 1 的项目文件。");
  const rawMessages =
    input.messages === undefined ? CHAT_DEFAULTS.messages : input.messages;
  if (!Array.isArray(rawMessages))
    throw new Error("项目中的 messages 必须是消息列表。");
  if (rawMessages.length > 20)
    throw new Error("每个项目最多包含 20 条消息，请减少消息后重试。");
  const ids = new Set();
  const messages = rawMessages.map((message, index) => {
    if (!message || typeof message !== "object" || Array.isArray(message))
      throw new Error(`第 ${index + 1} 条消息格式无效。`);
    const text = boundedText(message.text, "", 300, `第 ${index + 1} 条消息`);
    const baseId =
      typeof message.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(message.id)
        ? message.id
        : `message-${index + 1}`;
    let id = baseId,
      duplicate = 2;
    while (ids.has(id)) {
      const suffix = `-${duplicate++}`;
      id = `${baseId.slice(0, 80 - suffix.length)}${suffix}`;
    }
    ids.add(id);
    return {
      id,
      side: choices(message.side, ["left", "right"], "left"),
      text,
      hold: number(message.hold, 1.2, 0.2, 10),
    };
  });
  const fileName =
    boundedText(input.fileName, CHAT_DEFAULTS.fileName, 100, "文件名")
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim() || CHAT_DEFAULTS.fileName;
  const outputWidth =
    input.outputWidth === undefined
      ? CHAT_DEFAULTS.outputWidth
      : Number(input.outputWidth);
  const outputHeight =
    input.outputHeight === undefined
      ? CHAT_DEFAULTS.outputHeight
      : Number(input.outputHeight);
  if (!(
    (outputWidth === 720 && outputHeight === 1280) ||
    (outputWidth === 1080 && outputHeight === 1920)
  )) {
    throw new Error(
      "输出分辨率仅支持 720 × 1280 或 1080 × 1920，请选择对应的竖屏尺寸。",
    );
  }
  const keyboardLanguage = choices(
    input.keyboardLanguage,
    ["auto", "zh", "en"],
    CHAT_DEFAULTS.keyboardLanguage,
  );
  const keyboardLayout = choices(
    input.keyboardLayout,
    ["nine", "qwerty", "none"],
    CHAT_DEFAULTS.keyboardLayout,
  );
  return {
    version: 1,
    title: boundedText(input.title, CHAT_DEFAULTS.title, 80, "对话标题"),
    messages,
    typingSpeed: number(input.typingSpeed, CHAT_DEFAULTS.typingSpeed, 1, 30),
    startHold: number(input.startHold, CHAT_DEFAULTS.startHold, 0, 10),
    endHold: number(input.endHold, CHAT_DEFAULTS.endHold, 0, 10),
    afterTyping: choices(
      input.afterTyping,
      ["send", "hold"],
      CHAT_DEFAULTS.afterTyping,
    ),
    keyboardLayout:
      keyboardLanguage === "en" && keyboardLayout === "nine"
        ? "qwerty"
        : keyboardLayout,
    keyboardLanguage,
    backgroundMode: choices(
      input.backgroundMode,
      ["light", "dark", "custom"],
      CHAT_DEFAULTS.backgroundMode,
    ),
    backgroundColor: color(
      input.backgroundColor,
      CHAT_DEFAULTS.backgroundColor,
    ),
    fontSize: number(input.fontSize, CHAT_DEFAULTS.fontSize, 24, 54),
    showKeyHint: boolean(input.showKeyHint, CHAT_DEFAULTS.showKeyHint),
    showHeader: boolean(input.showHeader, CHAT_DEFAULTS.showHeader),
    leftBubble: color(input.leftBubble, CHAT_DEFAULTS.leftBubble),
    rightBubble: color(input.rightBubble, CHAT_DEFAULTS.rightBubble),
    leftText: color(input.leftText, CHAT_DEFAULTS.leftText),
    rightText: color(input.rightText, CHAT_DEFAULTS.rightText),
    outputWidth,
    outputHeight,
    fps: choices(Number(input.fps), [24, 30, 60], CHAT_DEFAULTS.fps),
    videoBitrate: choices(
      Number(input.videoBitrate),
      [4000000, 6000000, 12000000],
      CHAT_DEFAULTS.videoBitrate,
    ),
    outputFormat: choices(
      input.outputFormat,
      ["mp4", "mov", "webm"],
      CHAT_DEFAULTS.outputFormat,
    ),
    transparentBackground: boolean(
      input.transparentBackground,
      CHAT_DEFAULTS.transparentBackground,
    ),
    fileName,
  };
}

/** Incoming messages appear at start; outgoing messages are sent at typingEnd. */
export function buildChatSchedule(input = CHAT_DEFAULTS) {
  const config = normalizeChatProject(input);
  const segments = [
    {
      label: "开始停留",
      length: config.startHold,
      start: 0,
      end: config.startHold,
      kind: "start",
    },
  ];
  const messages = [];
  let cursor = config.startHold;
  for (const message of config.messages.filter(
    (item) => item.text.trim().length > 0,
  )) {
    const typingDuration =
      message.side === "right"
        ? Math.max(0.2, Array.from(message.text).length / config.typingSpeed)
        : 0;
    const start = cursor;
    const typingEnd = start + typingDuration;
    const end = typingEnd + message.hold;
    messages.push({ ...message, start, typingEnd, end });
    segments.push({
      label: `消息 ${messages.length}`,
      length: end - start,
      start,
      end,
      kind: "message",
      messageId: message.id,
    });
    cursor = end;
  }
  const duration = Math.max(0.1, cursor + config.endHold);
  segments.push({
    label: "结束停留",
    length: duration - cursor,
    start: cursor,
    end: duration,
    kind: "end",
  });
  return { duration, segments, messages, config };
}

/** Pure seeking: the same schedule/time always produces the same frame. */
export function getChatFrame(schedule, requestedTime = 0) {
  const parsed = Number(requestedTime);
  const time = Math.min(
    schedule.duration,
    Math.max(0, Number.isNaN(parsed) ? 0 : parsed),
  );
  const last = schedule.messages.at(-1);
  const retainLast =
    schedule.config.afterTyping === "hold" && last?.side === "right";
  const completed = schedule.messages.filter(
    (message) => time >= message.typingEnd && !(retainLast && message === last),
  );
  const active =
    schedule.messages.find(
      (message) => time >= message.start && time < message.end,
    ) || null;
  const finished = time >= schedule.duration;
  let phase = time < schedule.config.startHold ? "start" : "end";
  let inputText = retainLast && last && time >= last.typingEnd ? last.text : "";
  let activeCharacter = null;
  let typingProgress = phase === "end" && last ? 1 : 0;
  if (active) {
    if (time < active.typingEnd) {
      phase = "typing";
      typingProgress =
        (time - active.start) / (active.typingEnd - active.start);
      const characters = Array.from(active.text);
      const count = Math.min(
        characters.length - 1,
        Math.floor(typingProgress * characters.length + 1e-9),
      );
      inputText = characters.slice(0, count).join("");
      activeCharacter = characters[count] ?? null;
    } else {
      phase = "hold";
      typingProgress = 1;
    }
  }
  return {
    time,
    phase,
    completed,
    active,
    inputText,
    activeCharacter,
    typingProgress,
    finished,
  };
}
