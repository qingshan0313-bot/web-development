const WIDTH = 720;
const HEIGHT = 1280;
const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const hasChinese = (text) => /[\u3400-\u9fff\uf900-\ufaff]/u.test(text || "");
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ENGLISH_KEY_EQUIVALENTS = {
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": ".",
};
const englishKey = (character) =>
  ENGLISH_KEY_EQUIVALENTS[character] || character || "";

function effectiveLayout(layout, language) {
  if (layout === "none") return "none";
  return language === "en" ? "qwerty" : layout || "nine";
}

/** Main keyboard rows. The Chinese layout is a visual demonstration, not an IME. */
export function getKeyboardLabels(
  layout = "qwerty",
  language = "zh",
  { uppercase = true, symbols = false, symbolPage = "main" } = {},
) {
  layout = effectiveLayout(layout, language);
  if (layout === "none") return [];
  if (language === "en" && symbols) {
    return symbolPage === "more"
      ? [
          ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="],
          ["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "·"],
          ["123", ".", ",", "?", "!", "`", "⌫"],
          ["ABC", "#+=", "space", "send"],
        ]
      : [
          [..."1234567890"],
          ["-", "/", ":", ";", "(", ")", "$", "&", "@", '"'],
          ["#+=", ".", ",", "?", "!", "'", "⌫"],
          ["ABC", "#+=", "space", "send"],
        ];
  }
  if (layout === "nine")
    return [
      ["1\n符号", "2\nABC", "3\nDEF"],
      ["4\nGHI", "5\nJKL", "6\nMNO"],
      ["7\nPQRS", "8\nTUV", "9\nWXYZ"],
      ["文", language === "zh" ? "0\n空格" : "0\nSPACE", "⌫"],
    ];
  const letters = (value) => [
    ...(language === "en" && !uppercase ? value.toLowerCase() : value),
  ];
  return [
    letters("QWERTYUIOP"),
    letters("ASDFGHJKL"),
    ["↑", ...letters("ZXCVBNM"), "⌫"],
    [
      "123",
      language === "zh" ? "文" : "ABC",
      language === "zh" ? "空格" : "space",
      language === "zh" ? "发送" : "send",
    ],
  ];
}

function rounded(ctx, x, y, width, height, radius, fill, stroke) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function text(ctx, value, x, y, size, color, weight = 400, align = "left") {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

function wrap(ctx, value, maxWidth) {
  const lines = [];
  for (const paragraph of String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of Array.from(paragraph)) {
      if (line && ctx.measureText(line + character).width > maxWidth) {
        // Keep ordinary English words together when space is available.
        const lastSpace = line.lastIndexOf(" ");
        if (
          lastSpace > 0 &&
          /[A-Za-z]/.test(character) &&
          /[A-Za-z]$/.test(line)
        ) {
          lines.push(line.slice(0, lastSpace));
          line = line.slice(lastSpace + 1) + character;
        } else {
          lines.push(line);
          line = character;
        }
      } else line += character;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

function languageFor(config, frame) {
  if (config.keyboardLanguage === "zh" || config.keyboardLanguage === "en")
    return config.keyboardLanguage;
  const ownActive = frame.active?.side !== "left" ? frame.active : null;
  const lastOwn = (frame.completed || []).findLast(
    (message) => message.side === "right",
  );
  const firstOwn = Array.isArray(config.messages)
    ? config.messages.find((message) => message.side === "right")
    : null;
  const content =
    ownActive?.text ||
    (frame.active?.side !== "left" ? frame.inputText : "") ||
    lastOwn?.text ||
    firstOwn?.text ||
    "";
  return content && !hasChinese(content) ? "en" : "zh";
}

function drawHeader(ctx, config, theme, language) {
  text(ctx, "9:41", 35, 35, 23, theme.text, 600);
  for (let i = 0; i < 4; i++) {
    rounded(ctx, 583 + i * 8, 39 - i * 4, 5, 7 + i * 4, 1, theme.text);
  }
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(636, 36, 12, Math.PI * 1.2, Math.PI * 1.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(636, 36, 6, Math.PI * 1.2, Math.PI * 1.8);
  ctx.stroke();
  rounded(ctx, 665, 24, 31, 16, 4, null, theme.text);
  rounded(ctx, 668, 27, 23, 10, 2, theme.text);
  rounded(ctx, 698, 29, 3, 6, 1, theme.text);
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(39, 83);
  ctx.lineTo(27, 95);
  ctx.lineTo(39, 107);
  ctx.stroke();
  let title = String(config.title || (language === "en" ? "Chat" : "对话"));
  let titleSize = 29;
  ctx.font = `600 ${titleSize}px ${FONT}`;
  while (ctx.measureText(title).width > 500 && titleSize > 18) {
    titleSize--;
    ctx.font = `600 ${titleSize}px ${FONT}`;
  }
  if (ctx.measureText(title).width > 500) {
    const characters = Array.from(title);
    while (
      characters.length &&
      ctx.measureText(characters.join("") + "…").width > 500
    )
      characters.pop();
    title = characters.join("") + "…";
  }
  text(ctx, title, WIDTH / 2, 96, titleSize, theme.text, 600, "center");
  [0, 1, 2].forEach((i) => rounded(ctx, 665 + i * 9, 93, 4, 4, 2, theme.text));
}

function drawCover(ctx, image, area) {
  const width = image.naturalWidth || image.videoWidth || image.width;
  const height = image.naturalHeight || image.videoHeight || image.height;
  if (!(width > 0 && height > 0)) return;
  const scale = Math.max(area.width / width, area.height / height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.width, area.height);
  ctx.clip();
  ctx.drawImage(
    image,
    area.x + (area.width - width * scale) / 2,
    area.y + (area.height - height * scale) / 2,
    width * scale,
    height * scale,
  );
  ctx.restore();
}

function drawMessages(ctx, config, frame, area, fontSize, theme) {
  const lineHeight = Math.round(fontSize * 1.42);
  ctx.font = `400 ${fontSize}px ${FONT}`;
  const messages = (frame.completed || []).map((message) => {
    const lines = wrap(ctx, message.text, 478);
    const contentWidth = Math.max(
      ...lines.map((line) => ctx.measureText(line).width),
      24,
    );
    return {
      message,
      lines,
      width: Math.min(526, contentWidth + 42),
      height: lines.length * lineHeight + 32,
    };
  });
  const totalHeight = messages.reduce(
    (sum, message) => sum + message.height + 22,
    0,
  );
  const scrollOffset = Math.max(0, totalHeight - (area.height - 40));
  let y = area.y + 20 - scrollOffset;
  const bounds = [];
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.width, area.height);
  ctx.clip();
  for (const item of messages) {
    const right = item.message.side === "right";
    const x = right ? area.x + area.width - 20 - item.width : area.x + 20;
    bounds.push({
      id: item.message.id,
      x,
      y,
      width: item.width,
      height: item.height,
    });
    if (y + item.height > area.y && y < area.y + area.height) {
      const bubble = right
        ? config.rightBubble || "#1265ff"
        : config.leftBubble || theme.leftBubble;
      const ink = right
        ? config.rightText || "#ffffff"
        : config.leftText || theme.text;
      rounded(ctx, x, y, item.width, item.height, 17, bubble);
      item.lines.forEach((line, index) =>
        text(
          ctx,
          line,
          x + 21,
          y + 16 + lineHeight * (index + 0.5),
          fontSize,
          ink,
        ),
      );
    }
    y += item.height + 22;
  }
  ctx.restore();
  return { bubbles: bounds, scrollOffset };
}

function drawComposer(
  ctx,
  frame,
  area,
  fontSize,
  inputLines,
  lineHeight,
  theme,
  language,
) {
  ctx.fillStyle = theme.panel;
  ctx.fillRect(0, area.y, WIDTH, area.height);
  ctx.fillStyle = theme.divider;
  ctx.fillRect(0, area.y, WIDTH, 1);
  const field = { x: 66, y: area.y + 14, width: 512, height: area.height - 28 };
  rounded(ctx, field.x, field.y, field.width, field.height, 16, theme.field);
  // A compact add symbol keeps the composer familiar without suggesting a live input.
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(33, area.y + area.height / 2, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(26, area.y + area.height / 2);
  ctx.lineTo(40, area.y + area.height / 2);
  ctx.moveTo(33, area.y + area.height / 2 - 7);
  ctx.lineTo(33, area.y + area.height / 2 + 7);
  ctx.stroke();
  const content = String(frame.inputText || "");
  const visibleLines = inputLines.slice(-3);
  ctx.save();
  ctx.beginPath();
  ctx.rect(field.x + 15, field.y + 8, field.width - 30, field.height - 16);
  ctx.clip();
  if (!content) {
    text(
      ctx,
      language === "en" ? "Message…" : "输入消息…",
      field.x + 17,
      field.y + field.height / 2,
      Math.min(fontSize, 28),
      theme.muted,
    );
  } else {
    visibleLines.forEach((line, index) =>
      text(
        ctx,
        line,
        field.x + 17,
        field.y + 15 + lineHeight * (index + 0.5),
        fontSize,
        theme.text,
      ),
    );
    if (
      (frame.phase === "typing" || frame.phase === "hold") &&
      Math.floor((frame.time || 0) * 2) % 2 === 0
    ) {
      ctx.font = `400 ${fontSize}px ${FONT}`;
      const cursorX =
        field.x + 18 + ctx.measureText(visibleLines.at(-1) || "").width;
      const cursorY = field.y + 15 + (visibleLines.length - 1) * lineHeight;
      ctx.fillStyle = "#1265ff";
      ctx.fillRect(cursorX, cursorY + 4, 2.5, lineHeight - 8);
    }
  }
  ctx.restore();
  rounded(
    ctx,
    593,
    area.y + (area.height - 57) / 2,
    108,
    57,
    14,
    content ? "#1265ff" : theme.inactive,
  );
  text(
    ctx,
    language === "en" ? "Send" : "发送",
    647,
    area.y + area.height / 2,
    25,
    content ? "#ffffff" : theme.muted,
    500,
    "center",
  );
  return {
    field,
    visibleInputLines: visibleLines,
    hiddenInputLines: Math.max(0, inputLines.length - 3),
  };
}

function keyMatches(label, character, layout, language) {
  if (!character) return false;
  if (hasChinese(character)) return label === "文";
  if (/\s/u.test(character))
    return (
      label.includes("空格") ||
      label.includes("space") ||
      label.includes("SPACE")
    );
  if (layout === "nine") {
    if (/^[0-9]$/.test(character)) return label.startsWith(character);
    if (/^[a-z]$/i.test(character))
      return label.split("\n")[1]?.includes(character.toUpperCase()) || false;
    return label.startsWith("1");
  }
  if (/^[a-z]$/i.test(character))
    return label.toUpperCase() === character.toUpperCase();
  if (language === "en") return label === englishKey(character);
  return label === "123";
}

function drawKeyboard(ctx, config, frame, area, language, theme, layout) {
  if (layout === "none") {
    ctx.fillStyle = theme.panel;
    ctx.fillRect(0, area.y, WIDTH, area.height);
    return {
      keys: [],
      highlightedKey: null,
      displayedKey: null,
      language,
      keyboardLayout: layout,
      keyboardMode: "none",
      shiftActive: false,
      demonstration: false,
    };
  }
  ctx.fillStyle = theme.keyboard;
  ctx.fillRect(0, area.y, WIDTH, area.height);
  const activeCharacter =
    frame.phase === "typing" && frame.active?.side !== "left"
      ? frame.activeCharacter
      : null;
  const isChineseCharacter = hasChinese(activeCharacter);
  const reference =
    activeCharacter ||
    (frame.active?.side !== "left"
      ? Array.from(frame.inputText || "").at(-1)
      : "") ||
    "";
  const keyReference = englishKey(reference);
  const mainSymbols = getKeyboardLabels("qwerty", "en", {
    symbols: true,
  }).flat();
  const moreSymbols = getKeyboardLabels("qwerty", "en", {
    symbols: true,
    symbolPage: "more",
  }).flat();
  const symbols =
    language === "en" &&
    (mainSymbols.includes(keyReference) || moreSymbols.includes(keyReference));
  const symbolPage = mainSymbols.includes(keyReference) ? "main" : "more";
  const uppercase = !reference || /^[A-Z]$/.test(reference);
  const shiftActive = language === "en" && !symbols && uppercase;
  const state = language === "zh" ? "中文" : "English";
  text(ctx, state, WIDTH / 2, area.y + 27, 20, theme.muted, 400, "center");
  const rows = getKeyboardLabels(layout, language, {
    uppercase,
    symbols,
    symbolPage,
  });
  const keys = [];
  const top = area.y + 54;
  const rowHeight = layout === "nine" ? 62 : 52;
  const gap = layout === "nine" ? 9 : 10;
  let highlighted;
  rows.forEach((row, rowIndex) => {
    const inset = layout === "nine" ? 17 : rowIndex === 1 ? 43 : 12;
    const weights =
      layout !== "nine" && rowIndex === 3 ? [1.3, 1, 5, 1.7] : row.map(() => 1);
    const available = WIDTH - inset * 2 - gap * (row.length - 1);
    const unit = available / weights.reduce((sum, value) => sum + value, 0);
    let x = inset;
    row.forEach((label, index) => {
      const width = unit * weights[index];
      const y = top + rowIndex * (rowHeight + gap);
      const highlightedKey = keyMatches(
        label,
        activeCharacter,
        layout,
        language,
      );
      const shifted = label === "↑" && shiftActive;
      const key = {
        label,
        x,
        y,
        width,
        height: rowHeight,
        highlighted: highlightedKey,
        shifted,
      };
      keys.push(key);
      if (highlightedKey) highlighted = key;
      rounded(ctx, x, y + 2, width, rowHeight, 9, theme.keyShadow);
      rounded(
        ctx,
        x,
        y,
        width,
        rowHeight,
        9,
        highlightedKey ? "#1265ff" : shifted ? "#dce8ff" : theme.key,
      );
      const labels = label.split("\n");
      const ink = highlightedKey ? "#ffffff" : shifted ? "#1265ff" : theme.text;
      if (labels.length === 2) {
        text(ctx, labels[0], x + width / 2, y + 20, 27, ink, 500, "center");
        text(
          ctx,
          labels[1],
          x + width / 2,
          y + 46,
          16,
          highlightedKey ? "#e2ecff" : theme.muted,
          400,
          "center",
        );
      } else {
        text(
          ctx,
          label,
          x + width / 2,
          y + rowHeight / 2 + 1,
          label.length > 2 ? 21 : 25,
          ink,
          400,
          "center",
        );
      }
      x += width + gap;
    });
  });
  if (highlighted && config.showKeyHint !== false) {
    const hintWidth = Math.max(66, Math.min(100, highlighted.width));
    const x = clamp(
      highlighted.x + (highlighted.width - hintWidth) / 2,
      6,
      WIDTH - hintWidth - 6,
    );
    const y = Math.max(area.y + 3, highlighted.y - 58);
    rounded(ctx, x, y, hintWidth, 54, 11, theme.hint, theme.divider);
    text(
      ctx,
      /\s/u.test(activeCharacter) ? "␣" : String(activeCharacter),
      x + hintWidth / 2,
      y + 27,
      31,
      theme.text,
      500,
      "center",
    );
  }
  return {
    keys,
    highlightedKey:
      highlighted?.label && /^[a-z]$/i.test(highlighted.label)
        ? highlighted.label.toUpperCase()
        : highlighted?.label || null,
    displayedKey: highlighted?.label || null,
    language,
    keyboardLayout: layout,
    keyboardMode: symbols ? "symbols" : "letters",
    shiftActive,
    demonstration: language === "zh" || isChineseCharacter,
  };
}

/** Draw one immutable animation frame in a 720 × 1280 logical coordinate space. */
export function renderChat(ctx, config = {}, frame = {}, assets = {}) {
  const dark = config.backgroundMode === "dark";
  const theme = dark
    ? {
        background: "#14171c",
        panel: "#20242a",
        keyboard: "#262b33",
        field: "#333941",
        text: "#f1f2f4",
        muted: "#9aabb7",
        divider: "#363c44",
        leftBubble: "#30363d",
        key: "#424a56",
        keyShadow: "#151a20",
        hint: "#55616d",
        inactive: "#343b46",
      }
    : {
        background: "#f2f3f5",
        panel: "#f7f8f9",
        keyboard: "#dfe3e8",
        field: "#ffffff",
        text: "#242b33",
        muted: "#7b8792",
        divider: "#dce1e5",
        leftBubble: "#ffffff",
        key: "#ffffff",
        keyShadow: "#b7c0ca",
        hint: "#ffffff",
        inactive: "#e4e7ed",
      };
  const fontSize = clamp(Number(config.fontSize) || 32, 24, 54);
  const language = languageFor(config, frame);
  const keyboardLayout = effectiveLayout(config.keyboardLayout, language);
  const keyboardHeight =
    keyboardLayout === "none" ? 28 : keyboardLayout === "nine" ? 366 : 330;
  const showHeader = config.showHeader !== false;
  const headerHeight = showHeader ? 140 : 0;
  ctx.save();
  ctx.setTransform(
    (ctx.canvas?.width || config.outputWidth || WIDTH) / WIDTH,
    0,
    0,
    (ctx.canvas?.height || config.outputHeight || HEIGHT) / HEIGHT,
    0,
    0,
  );
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.font = `400 ${fontSize}px ${FONT}`;
  const inputLines = wrap(ctx, frame.inputText || "", 475);
  const inputLineHeight = Math.round(fontSize * 1.35);
  const composerHeight = Math.max(
    91,
    Math.min(inputLines.length, 3) * inputLineHeight + 58,
  );
  const keyboard = {
    x: 0,
    y: HEIGHT - keyboardHeight,
    width: WIDTH,
    height: keyboardHeight,
  };
  const composer = {
    x: 0,
    y: keyboard.y - composerHeight,
    width: WIDTH,
    height: composerHeight,
  };
  const chat = {
    x: 0,
    y: headerHeight,
    width: WIDTH,
    height: composer.y - headerHeight,
  };
  const background =
    config.backgroundMode === "custom"
      ? config.backgroundColor || theme.background
      : theme.background;
  const transparentBackground =
    config.outputFormat === "mov" && config.transparentBackground !== false;
  if (transparentBackground) {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
  } else {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (assets.backgroundImage) drawCover(ctx, assets.backgroundImage, chat);
  }
  if (showHeader) {
    ctx.fillStyle = theme.panel;
    ctx.fillRect(0, 0, WIDTH, headerHeight);
    drawHeader(ctx, config, theme, language);
  }
  const messageInfo = drawMessages(
    ctx,
    config,
    frame,
    chat,
    fontSize,
    theme,
  );
  const composerInfo = drawComposer(
    ctx,
    frame,
    composer,
    fontSize,
    inputLines,
    inputLineHeight,
    theme,
    language,
  );
  const keyboardInfo = drawKeyboard(
    ctx,
    config,
    frame,
    keyboard,
    language,
    theme,
    keyboardLayout,
  );
  rounded(ctx, 264, HEIGHT - 12, 192, 5, 3, dark ? "#c9d0d5" : "#68717a");
  ctx.restore();
  return {
    logicalWidth: WIDTH,
    logicalHeight: HEIGHT,
    chat,
    composer,
    keyboard,
    fontSize,
    ...messageInfo,
    ...composerInfo,
    ...keyboardInfo,
  };
}
