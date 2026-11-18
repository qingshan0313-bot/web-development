import { copyUndoState, createUndoHistory } from "./undo-history.js";
import { download, zipFiles, loadImage, canvasBlob } from "./media.js";
import {
  loadVideo,
  disposeVideo,
  drawComposition,
  exportVideo,
} from "./video.js";
import { setupChatEditor } from "./chat-ui.js";
import { setupMixEditor } from "./mix-ui.js";
import { setupSmartEditor } from "./smart-ui.js";
import {
  VIDEO_FORMATS,
  exportCanvasVideo,
  videoFilename,
} from "./video-export.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const paths = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  layers: "m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5",
  video: "M3 5h14v14H3zM17 9l4-3v12l-4-3M8 9l5 3-5 3z",
  image: "M3 3h18v18H3zM3 16l6-6 5 5 3-3 4 4M15 7h.01",
  folder: "M3 6h7l2 3h9v11H3zM3 6V4h6l2 2",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  shield: "M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6zM8 12l3 3 5-6",
  help: "M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 16h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-2 4 6 6",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  close: "m6 6 12 12M6 18 18 6",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  download: "M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5",
  play: "m8 5 11 7-11 7z",
  pause: "M8 5v14M16 5v14",
  rewind: "M5 5v14m14-14L8 12l11 7z",
  refresh: "M20 8V3l-3 3A8 8 0 1 0 3 14M20 3h-5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  file: "M5 3h9l5 5v13H5zM14 3v6h5M9 13h6M9 17h4",
  check: "m5 12 4 4L19 6",
  plus: "M12 4v16M4 12h16",
  copy: "M8 8h12v13H8zM16 8V3H3v13h5",
  timer:
    "M9 2h6M12 2v3M18 7l2-2M12 9v5l3 2M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
const hydrateIcons = (root = document) =>
  $$("[data-icon]", root).forEach(
    (el) => (el.innerHTML = icon(el.dataset.icon)),
  );
const categories = [
  { id: "all", name: "工作台", icon: "grid" },
  { id: "video", name: "视频与动画", icon: "video" },
  { id: "batch", name: "批量制作", icon: "layers" },
  { id: "image", name: "图片与设计", icon: "image" },
  { id: "files", name: "素材与效率", icon: "folder" },
];
const tools = [
  {
    id: "compose",
    name: "视频居中",
    category: "video",
    description: "竖屏变横屏，让画面恰到好处",
    meta: "视频合成 · MP4 / MOV / WebM",
    tag: "常用",
    subtitle: "添加背景，将竖屏视频等比居中，保留原声。",
    format: "MP4 / MOV / WebM · 本地合成",
  },
  {
    id: "mix",
    name: "批量混剪",
    category: "batch",
    description: "一个片头，一个成片，批量组合创意",
    meta: "裁切拼接 · MP4 / MOV / WebM",
    tag: "新工具",
    subtitle: "选择片头与成片，调整截取范围，批量拼接并记录制作进度。",
    format: "本地拼接 · 保留原声",
  },
  {
    id: "rename",
    name: "批量重命名",
    category: "files",
    description: "一套命名规则，整理所有素材",
    meta: "批量处理 · ZIP",
    tag: "常用",
    subtitle: "选择文件，设定规则，打包下载已重命名的副本。",
    format: "ZIP · 保留原文件",
  },
  {
    id: "smart",
    name: "智能命名",
    category: "files",
    description: "用画面补齐字段，让素材命名更省心",
    meta: "画面识别 · ZIP / CSV",
    tag: "AI 辅助",
    subtitle: "本地读取素材信息，按规则命名，也可用 AI 分析画面后逐条校正。",
    format: "可选 AI 分析 · 原文件保留",
  },
  {
    id: "subtitles",
    name: "字幕编辑",
    category: "files",
    description: "把文字变成时间轴上的字幕",
    meta: "字幕制作 · SRT",
    subtitle: "粘贴文案，按行生成字幕，逐条调整时间和内容。",
    format: "SRT · UTF-8",
  },
  {
    id: "chat",
    name: "对话打字动画",
    category: "video",
    description: "让每一句对话，自然发生",
    meta: "动态素材 · MP4 / MOV / WebM",
    subtitle: "写下对话，让文字逐字出现，导出竖屏动画。",
    format: "MP4 / MOV / WebM · 竖屏动画",
  },
  {
    id: "timer",
    name: "数字计时器",
    category: "video",
    description: "为重要时刻，留一点期待",
    meta: "动态素材 · MP4 / MOV / WebM",
    subtitle: "自定义倒计时、颜色和画幅，制作简洁的计时动画。",
    format: "MP4 / MOV / WebM · 动画素材",
  },
  {
    id: "choices",
    name: "选项动画",
    category: "video",
    description: "一个问题，让观众参与进来",
    meta: "互动素材 · MP4 / MOV / WebM",
    subtitle: "设置问题与选项，按时揭晓答案，导出完整动画。",
    format: "720 × 1280 · MP4 / MOV / WebM",
  },
  {
    id: "polaroid",
    name: "相纸图",
    category: "image",
    description: "给日常片刻，加一层温度",
    meta: "图片排版 · PNG",
    subtitle: "选择图片，写一句注释，留住一个值得收藏的瞬间。",
    format: "1080 × 1280 · PNG",
  },
  {
    id: "bubbles",
    name: "对话气泡",
    category: "image",
    description: "让文字，多一点情绪表达",
    meta: "透明素材 · PNG",
    subtitle: "自定义气泡文字与颜色，导出透明背景素材。",
    format: "1080 × 600 · PNG",
  },
  {
    id: "palette",
    name: "图片取色",
    category: "image",
    description: "收藏画面里的每一种好颜色",
    meta: "色彩灵感 · HEX",
    subtitle: "上传图片提取代表色，或点击画面精准取色。",
    format: "HEX · PNG 色卡",
  },
];

function artwork(id) {
  const files = ["素材_001.mp4", "素材_002.mp4", "素材_003.mp4"];
  return {
    compose:
      '<div class="mini-screen"><div class="mini-mountain"></div><div class="mini-ruler"></div><div class="mini-phone"></div></div>',
    mix: `<div class="mix-card-art"><div><span>01 / HOOK</span>${icon("play")}</div>${icon("plus")}<div><span>02 / VIDEO</span>${icon("video")}</div></div>`,
    rename: `<div class="rename-rows">${files.map((x) => `<div class="rename-row">${icon("file")}<span>${x}</span><em>✓</em></div>`).join("")}</div>`,
    smart: `<div class="rename-rows">${["读取画面 · 提取字段", "US_261115_QS_01.mp4", "命名就绪 · 保留原文件"].map((text, index) => `<div class="rename-row">${icon(index === 0 ? "image" : "file")}<span>${text}</span><em>${index === 0 ? "✦" : "✓"}</em></div>`).join("")}</div>`,
    subtitles: `<div class="subtitle-art"><div class="subtitle-wave">${Array.from({ length: 29 }, (_, i) => `<i style="height:${8 + Math.sin(i * 1.9) ** 2 * 23}px"></i>`).join("")}</div><div class="subtitle-line"><b>00:01</b><span>把每一个瞬间</span></div><div class="subtitle-line"><b>00:04</b><span>都变成值得记录的故事</span></div></div>`,
    chat: '<div class="chat-art"><div class="chat-bubble">今天，也要去看风景吗？</div><div class="chat-bubble reply">当然，出发吧。</div><div class="chat-bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div></div>',
    timer:
      '<div class="timer-art"><span class="timer-digit">0</span><span class="timer-digit">0</span><span class="timer-colon">:</span><span class="timer-digit">1</span><span class="timer-digit">0</span></div>',
    choices: `<div class="choice-art"><div class="choice-line"><b>A</b><i></i></div><div class="choice-line selected"><b>B</b><i></i>${icon("check")}</div><div class="choice-line"><b>C</b><i></i></div></div>`,
    polaroid:
      '<div class="polaroid-art"><div class="polaroid-photo"></div></div><div class="polaroid-art second"><div class="polaroid-photo"></div></div>',
    bubbles: '<div class="bubble-sample">灵感，正在发生。</div>',
    palette: `<div class="palette-art">${'<span class="palette-swatch"></span>'.repeat(5)}</div>`,
  }[id];
}

let favorites;
try {
  const saved = JSON.parse(localStorage.getItem("frame-favorites") || "[]");
  favorites = new Set(
    Array.isArray(saved)
      ? saved.filter((id) => tools.some((t) => t.id === id))
      : [],
  );
} catch {
  favorites = new Set();
}
let activeCategory = "all",
  expandedCategory = null,
  mobileNavigationOpen = false,
  toastTimeout,
  toolController,
  cleanups = [],
  currentTool = null,
  operationController = null;
const compactNavigation = window.matchMedia("(max-width: 950px)");
const navigationAnimations = new Set();
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(
    () => $("#toast").classList.remove("visible"),
    3500,
  );
}
function renderNavigation() {
  const navigation = $("#navigation");
  const previousPanels = new Map(
    $$(".nav-submenu", navigation)
      .filter((panel) => !panel.hidden)
      .map((panel) => [
        panel.id,
        {
          bounds: panel.getBoundingClientRect(),
          opacity: getComputedStyle(panel).opacity,
        },
      ]),
  );
  for (const animation of navigationAnimations) animation.cancel();
  navigationAnimations.clear();
  const groups = [
    ...categories,
    { id: "favorites", name: "我的收藏", icon: "star" },
  ];
  navigation.innerHTML = groups
    .map((category) => {
      const items = tools.filter(
        (tool) =>
          category.id === "all" ||
          (category.id === "favorites"
            ? favorites.has(tool.id)
            : tool.category === category.id),
      );
      const expandable = category.id !== "all";
      const expanded =
        expandable &&
        expandedCategory === category.id &&
        (!compactNavigation.matches || mobileNavigationOpen);
      const selected = activeCategory === category.id;
      const panelId = `nav-tools-${category.id}`;
      return `${category.id === "favorites" ? '<div class="nav-divider"></div>' : ""}<div class="nav-group">
      <button id="nav-category-${category.id}" class="nav-item ${selected ? "active" : ""}" data-category="${category.id}" aria-label="${category.name}" title="${category.name}" ${selected && !currentTool ? 'aria-current="page"' : ""} ${expandable ? `aria-expanded="${expanded}" aria-controls="${panelId}"` : ""}><span data-icon="${category.icon}"></span><span class="nav-text">${category.name}</span>${category.id === "all" ? "" : `<span class="nav-count">${items.length}</span>`}${expandable ? '<svg class="nav-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>' : ""}</button>
      ${expandable ? `<div id="${panelId}" class="nav-submenu" aria-labelledby="nav-category-${category.id}" ${expanded ? "" : "hidden"}><div class="nav-submenu-heading"><strong>${category.name}</strong><button type="button" data-action="close-navigation" aria-label="关闭工具菜单">${icon("close")}</button></div>${items.length ? items.map((tool) => `<button type="button" class="nav-tool ${selected && currentTool === tool.id ? "active" : ""}" data-nav-tool="${tool.id}" data-nav-category="${category.id}" ${selected && currentTool === tool.id ? 'aria-current="page"' : ""}><span class="nav-tool-dot" aria-hidden="true"></span><span>${tool.name}</span></button>`).join("") : '<p class="nav-empty">还没有收藏。<br>点击工具卡片上的星标添加。</p>'}</div>` : ""}
    </div>`;
    })
    .join("");
  hydrateIcons(navigation);
  positionNavigationMenu();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const panel of $$(".nav-submenu", navigation)) {
    const previous = previousPanels.get(panel.id);
    const opening = !panel.hidden;
    if (!opening && !previous) continue;
    const height = opening ? panel.getBoundingClientRect().height : 0;
    if (opening && previous && Math.abs(previous.bounds.height - height) < 1)
      continue;
    if (!opening) {
      panel.hidden = false;
      panel.inert = true;
      panel.setAttribute("aria-hidden", "true");
      if (compactNavigation.matches) {
        panel.style.setProperty("--nav-menu-left", `${previous.bounds.left}px`);
        panel.style.setProperty("--nav-menu-top", `${previous.bounds.top}px`);
        panel.style.setProperty(
          "--nav-menu-width",
          `${previous.bounds.width}px`,
        );
      }
    }
    const keyframes = compactNavigation.matches
      ? [
          {
            opacity: previous?.opacity || 0,
            transform: previous ? "translateX(0)" : "translateX(-8px)",
          },
          {
            opacity: opening ? 1 : 0,
            transform: opening ? "translateX(0)" : "translateX(-8px)",
          },
        ]
      : [
          {
            height: `${previous?.bounds.height || 0}px`,
            opacity: previous?.opacity || 0,
            overflow: "hidden",
          },
          {
            height: `${height}px`,
            opacity: opening ? 1 : 0,
            overflow: "hidden",
          },
        ];
    const animation = panel.animate(keyframes, {
      duration: opening ? 240 : 190,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    });
    navigationAnimations.add(animation);
    animation.finished
      .then(() => {
        if (!opening && panel.isConnected) panel.hidden = true;
      })
      .catch(() => {})
      .finally(() => navigationAnimations.delete(animation));
  }
}
function positionNavigationMenu() {
  if (!compactNavigation.matches || !mobileNavigationOpen || !expandedCategory)
    return;
  const menu = $(`#nav-tools-${expandedCategory}`);
  const trigger = $(`#nav-category-${expandedCategory}`);
  if (!menu || !trigger) return;
  const left = Math.round($(".sidebar").getBoundingClientRect().right + 8);
  menu.style.setProperty("--nav-menu-left", `${left}px`);
  menu.style.setProperty(
    "--nav-menu-width",
    `${Math.max(0, Math.min(264, window.innerWidth - left - 12))}px`,
  );
  const top = Math.max(
    12,
    Math.min(
      trigger.getBoundingClientRect().top,
      window.innerHeight - menu.offsetHeight - 12,
    ),
  );
  menu.style.setProperty("--nav-menu-top", `${top}px`);
}
function closeNavigationMenu(restoreFocus = false) {
  if (!mobileNavigationOpen) return;
  const category = expandedCategory;
  mobileNavigationOpen = false;
  renderNavigation();
  if (restoreFocus) $(`#nav-category-${category}`)?.focus();
}
function renderTools() {
  $("#tool-total").textContent = String(tools.length);
  const query = $("#search").value.trim().toLowerCase();
  const visible = tools.filter(
    (t) =>
      (activeCategory === "all" ||
        activeCategory === t.category ||
        (activeCategory === "favorites" && favorites.has(t.id))) &&
      `${t.name} ${t.description} ${t.meta}`.toLowerCase().includes(query),
  );
  const categoryName =
    activeCategory === "favorites"
      ? "我的收藏"
      : categories.find((c) => c.id === activeCategory).name;
  $("#section-title").innerHTML =
    activeCategory === "all"
      ? categoryName
      : `${categoryName} <span id="tool-count">${visible.length}</span>`;
  if (!currentTool) $("#breadcrumb-current").textContent = categoryName;
  $("#filters").innerHTML = categories
    .filter((category) => category.id !== "all")
    .map(
      (c) =>
        `<button class="filter ${activeCategory === c.id ? "active" : ""}" data-category="${c.id}" aria-pressed="${activeCategory === c.id}">${c.name}</button>`,
    )
    .join("");
  $("#tool-grid").innerHTML = visible
    .map(
      (t) =>
        `<article class="tool-card"><button class="favorite ${favorites.has(t.id) ? "active" : ""}" data-favorite="${t.id}" aria-label="${favorites.has(t.id) ? "取消收藏" : "收藏"}${t.name}" aria-pressed="${favorites.has(t.id)}">${icon("star")}</button><button class="card-open" data-open="${t.id}"><div class="card-art art-${t.id}" aria-hidden="true">${artwork(t.id)}</div><div class="card-content"><div class="card-title-line"><h3>${t.name}</h3>${t.tag ? `<span class="card-tag">${t.tag}</span>` : ""}</div><p>${t.description}</p><div class="card-footer"><span>${t.meta}</span>${icon("arrow")}</div></div></button></article>`,
    )
    .join("");
  $("#empty-state").hidden = visible.length > 0;
  $("#empty-text").textContent =
    activeCategory === "favorites" && !query
      ? "点击工具卡片右上角的星标，把常用工具留在这里。"
      : "试试其他关键词，或切换分类。";
  renderNavigation();
}
const undoHistory = createUndoHistory();
const toolStates = new Map();
let undoEditor = null;
let recordingUndo = false;

function syncUndoButton() {
  const button = $("#undo");
  const latest = undoHistory.latest;
  button.disabled = !latest || Boolean(operationController);
  button.title = latest
    ? `撤销${tools.find(({ id }) => id === latest.tool).name}的上一步（Ctrl / ⌘ + Z）`
    : "撤销（Ctrl / ⌘ + Z）";
}

const settingsControls =
  "#settings input[id]:not([type=file]):not([type=password]), #settings textarea[id], #settings select[id]";

function registerUndo({ capture = () => null, restore = () => {}, controls }) {
  const fields = controls ? $$(controls) : [];
  const readFields = () => fields.map((field) =>
    field.type === "checkbox" ? field.checked : field.value,
  );
  let previousFields = readFields();
  undoEditor = {
    capture: () => ({ model: copyUndoState(capture()), fields: readFields() }),
    before: () => ({ model: copyUndoState(capture()), fields: previousFields }),
    refreshFields: () => { previousFields = readFields(); },
    restore(state) {
      fields.forEach((field, index) => {
        if (field.type === "checkbox") field.checked = state.fields[index];
        else field.value = state.fields[index];
      });
      restore(copyUndoState(state.model));
      previousFields = readFields();
    },
  };
}

function recordEdit(edit, key) {
  const editor = undoEditor;
  if (!editor || recordingUndo) return edit();
  const tool = currentTool;
  const before = editor.before();
  recordingUndo = true;
  try {
    return edit();
  } finally {
    recordingUndo = false;
    if (undoEditor === editor) {
      undoHistory.record(tool, before, editor.capture(), key);
      editor.refreshFields();
      syncUndoButton();
    }
  }
}

// Used when a modal operation owns the editor until its asynchronous work finishes.
function beginUndoEdit() {
  const editor = undoEditor;
  const tool = currentTool;
  const before = editor.capture();
  return () => {
    if (undoEditor !== editor) return;
    undoHistory.record(tool, before, editor.capture());
    syncUndoButton();
  };
}

function undoLastEdit() {
  if (operationController || !undoHistory.latest) return false;
  const { tool, before } = undoHistory.pop();
  if (currentTool !== tool) openTool(tool, activeCategory, before);
  else undoEditor.restore(before);
  syncUndoButton();
  toast(`已撤销${tools.find(({ id }) => id === tool).name}的上一步。`);
  return true;
}

function closeWorkspace() {
  mobileNavigationOpen = false;
  if (currentTool && undoEditor) toolStates.set(currentTool, undoEditor.capture());
  undoEditor = null;
  undoHistory.breakGroup();
  toolController?.abort();
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
  cleanups = [];
  currentTool = null;
  $("#workspace").hidden = true;
  $("#home").hidden = false;
  $("#processing-label").textContent = "浏览器处理";
  renderTools();
}
function on(element, event, handler) {
  const signal = toolController.signal;
  const track = ["input", "change", "click", "submit", "focusout"].includes(event)
    && $("#workspace").contains(element);
  element.addEventListener(event, track ? (e) => {
    const key = (e.type === "input" || e.type === "change") &&
      e.target.matches('textarea,input:not([type="checkbox"]):not([type="radio"])')
      ? e.target : null;
    const result = recordEdit(() => handler(e), key);
    if (e.type === "change") undoHistory.breakGroup();
    return result;
  } : handler, { signal });
}
function field(label, control, hint = "") {
  return `<label class="field"><span>${label}${hint ? `<small>${hint}</small>` : ""}</span>${control}</label>`;
}
function input(id, value, type = "text", extra = "") {
  return `<input id="${id}" type="${type}" value="${escapeHTML(value)}" ${extra}>`;
}
function select(id, options, value) {
  return `<select id="${id}">${options.map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
}
function upload(id, title, hint, accept, multiple = false, compact = false) {
  return `<label class="upload-box ${compact ? "compact" : ""}" tabindex="0" role="button" aria-label="${title}">${icon("upload")}<strong>${title}</strong><small>${hint}</small><input id="${id}" type="file" accept="${accept}" ${multiple ? "multiple" : ""}></label>`;
}
function exportButton(label = "导出 PNG") {
  return `<button id="export" class="button primary export-button">${icon("download")}${label}</button>`;
}
function canvasPreview(width, height, empty = "", tall = false) {
  return `<div class="preview-surface ${tall ? "tall" : ""}"><canvas id="canvas" width="${width}" height="${height}" aria-label="素材预览"></canvas>${empty ? `<div id="preview-empty" class="preview-empty">${icon("video")}<h3>${empty}</h3><p>选择文件后，画面将在这里呈现。<br>你可以随时调整参数。</p></div>` : ""}</div><div class="preview-caption"><span id="preview-info">${width} × ${height} · 实时预览</span><button id="replay" hidden>${icon("play")}播放预览</button></div>`;
}

function previewTime(seconds) {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return `${String(Math.floor(tenths / 600)).padStart(2, "0")}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}

/** One playback clock drives the canvas, transport, and draggable playhead. */
function createAnimationTimeline({ duration, draw, segments }) {
  const panel = document.createElement("section");
  panel.className = "preview-timeline";
  panel.setAttribute("aria-label", "动画时间线");
  panel.innerHTML = `<div class="timeline-heading"><strong>时间线</strong><span>拖动查看任意时刻</span></div>
    <div class="timeline-transport"><button id="timeline-play" class="timeline-play" aria-label="播放预览" aria-pressed="false">${icon("play")}<span>播放</span></button><button id="timeline-restart" class="timeline-restart" aria-label="回到开头" title="回到开头">${icon("rewind")}</button><div class="timeline-clock"><output id="timeline-current">00:00.0</output><span>/</span><span id="timeline-duration"></span></div></div>
    <input id="timeline-seek" class="timeline-seek" type="range" min="0" step="0.01" value="0" aria-label="时间线进度">
    <div id="timeline-ticks" class="timeline-ticks" aria-hidden="true"></div><div id="timeline-segments" class="timeline-segments"></div>`;
  $(".preview-panel").append(panel);
  const playButton = $("#timeline-play", panel);
  const seekInput = $("#timeline-seek", panel);
  const currentOutput = $("#timeline-current", panel);
  let current = 0,
    playing = false,
    frame = 0,
    previousFrame = 0;
  let segmentElements = [];

  function render() {
    const total = duration();
    current = Math.max(0, Math.min(total, current));
    draw(current);
    seekInput.value = String(current);
    seekInput.style.setProperty("--played", `${(current / total) * 100}%`);
    seekInput.setAttribute(
      "aria-valuetext",
      `${previewTime(current)}，共 ${previewTime(total)}`,
    );
    currentOutput.value = previewTime(current);
    for (const { element, start, end } of segmentElements) {
      element.classList.toggle(
        "active",
        current >= start &&
          (current < end || (current === total && end === total)),
      );
    }
  }

  function updateButton() {
    playButton.innerHTML = `${icon(playing ? "pause" : "play")}<span>${playing ? "暂停" : "播放"}</span>`;
    playButton.setAttribute("aria-label", playing ? "暂停预览" : "播放预览");
    playButton.setAttribute("aria-pressed", String(playing));
  }

  function pause() {
    cancelAnimationFrame(frame);
    frame = 0;
    playing = false;
    updateButton();
  }

  function play() {
    if (playing) return;
    if (current >= duration()) current = 0;
    playing = true;
    updateButton();
    previousFrame = performance.now();
    render();
    function tick(now) {
      current += (now - previousFrame) / 1000;
      previousFrame = now;
      render();
      if (current >= duration()) pause();
      else frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }

  function seek(time) {
    pause();
    current = time;
    render();
  }

  function refresh() {
    pause();
    const total = duration();
    seekInput.max = String(total);
    $("#timeline-duration", panel).textContent = previewTime(total);
    $("#timeline-ticks", panel).innerHTML = Array.from(
      { length: 5 },
      (_, i) => `<span>${previewTime((total * i) / 4)}</span>`,
    ).join("");
    let start = 0;
    const list = segments();
    $("#timeline-segments", panel).innerHTML = list
      .map(
        (segment) =>
          `<button class="timeline-segment" style="flex:${segment.length}" title="${escapeHTML(segment.label)}" aria-label="跳转到${escapeHTML(segment.label)}">${escapeHTML(segment.label)}</button>`,
      )
      .join("");
    segmentElements = $$(".timeline-segment", panel).map((element, i) => {
      const segment = { element, start, end: start + list[i].length };
      start = segment.end;
      return segment;
    });
    render();
  }

  on(playButton, "click", () => (playing ? pause() : play()));
  on($("#timeline-restart", panel), "click", () => seek(0));
  on(seekInput, "pointerdown", pause);
  on(seekInput, "input", () => seek(Number(seekInput.value)));
  on($("#timeline-segments", panel), "click", (event) => {
    const segment = segmentElements.find(
      (item) => item.element === event.target.closest(".timeline-segment"),
    );
    if (segment) seek(segment.start);
  });
  on(document, "keydown", (event) => {
    if (
      event.code !== "Space" ||
      event.repeat ||
      operationController ||
      document.querySelector("dialog[open]") ||
      event.target.closest(
        "input, textarea, select, button, a, [contenteditable]",
      )
    )
      return;
    event.preventDefault();
    playing ? pause() : play();
  });
  cleanups.push(pause);
  refresh();
  return { pause, refresh, render, play, seek, getCurrentTime: () => current };
}

function mountTool(id, settings, preview) {
  $("#workspace").classList.toggle("chat-workspace", id === "chat");
  $("#workspace").classList.toggle("mix-workspace", id === "mix");
  $("#workspace").classList.toggle("smart-workspace", id === "smart");
  $("#processing-label").textContent =
    id === "smart" ? "可选 AI 分析" : "浏览器处理";
  const tool = tools.find((t) => t.id === id);
  $("#workspace").innerHTML =
    `<button class="back-button" data-action="back">${icon("arrow")}返回工具台</button><div class="workspace-heading"><div><h1>${tool.name}</h1><p>${tool.subtitle}</p></div><span class="workspace-badge">${tool.format}</span></div><div class="editor-layout"><section class="settings-panel"><div class="panel-heading">创作设置<small>01 / SETTINGS</small></div><div id="settings" class="settings-body">${settings}</div></section><section class="preview-panel"><div class="panel-heading">${["rename", "smart"].includes(id) ? "命名预览" : id === "subtitles" ? "字幕时间轴" : "作品预览"}<small>02 / PREVIEW</small></div>${preview}</section></div>`;
  $("#breadcrumb-current").textContent = tool.name;
  $$(".upload-box").forEach((box) => {
    const fileInput = $("input", box);
    on(box, "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });
    on(box, "dragover", (e) => {
      e.preventDefault();
      box.classList.add("dragover");
    });
    on(box, "dragleave", () => box.classList.remove("dragover"));
    on(box, "drop", (e) => {
      e.preventDefault();
      box.classList.remove("dragover");
      const dt = new DataTransfer();
      [...e.dataTransfer.files]
        .slice(0, fileInput.multiple ? undefined : 1)
        .forEach((f) => dt.items.add(f));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}
function previewContext() {
  const canvas = $("#canvas");
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }) };
}
function number(id, min, max, fallback) {
  const value = Number($(id).value);
  return Math.max(
    min,
    Math.min(max, Number.isFinite(value) ? value : fallback),
  );
}
function font(size, weight = 400) {
  return `${weight} ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;
}
function rounded(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  String(text)
    .split("\n")
    .forEach((paragraph) => {
      let line = "";
      for (const char of paragraph) {
        if (ctx.measureText(line + char).width > maxWidth && line) {
          lines.push(line);
          line = char;
        } else line += char;
      }
      lines.push(line);
    });
  return lines;
}
function linesText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 30) {
  const lines = wrapText(ctx, text, maxWidth).slice(0, maxLines);
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return lines.length * lineHeight;
}
function scene(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, "#c9def2");
  sky.addColorStop(1, "#bdcbde");
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#f3f8ff";
  ctx.beginPath();
  ctx.arc(x + w * 0.75, y + h * 0.25, w * 0.08, 0, Math.PI * 2);
  ctx.fill();
  for (const [color, base, peaks] of [
    [
      "#99b9d4",
      0.85,
      [
        [0, 0.65],
        [0.3, 0.25],
        [0.62, 0.7],
        [0.9, 0.2],
        [1, 0.48],
      ],
    ],
    [
      "#6495bd",
      1,
      [
        [0, 0.9],
        [0.23, 0.55],
        [0.45, 0.86],
        [0.7, 0.45],
        [1, 0.8],
      ],
    ],
    [
      "#346495",
      1,
      [
        [0, 0.88],
        [0.25, 0.74],
        [0.55, 0.96],
        [0.85, 0.76],
        [1, 0.82],
      ],
    ],
  ]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    peaks.forEach((p) => ctx.lineTo(x + p[0] * w, y + p[1] * h));
    ctx.lineTo(x + w, y + h * base);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
function coverImage(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(
    image,
    x + (w - image.naturalWidth * scale) / 2,
    y + (h - image.naturalHeight * scale) / 2,
    image.naturalWidth * scale,
    image.naturalHeight * scale,
  );
  ctx.restore();
}
function cleanFilename(name) {
  const cleaned =
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/[. ]+$/, "")
      .trim() || "未命名";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
}
function localDate() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}
async function imageFile(file) {
  if (!file || !file.type.startsWith("image/"))
    throw new Error("请选择有效的图片文件。");
  if (file.size > 60 * 1024 * 1024)
    throw new Error("图片过大，请选择小于 60 MB 的图片。");
  return loadImage(file);
}
function errorToast(error) {
  if (error.name !== "AbortError")
    toast(error.message || "处理失败，请换一个文件重试。");
}
async function runOperation(title, action) {
  if (operationController) return;
  operationController = new AbortController();
  syncUndoButton();
  const overlay = document.createElement("div");
  overlay.className = "processing-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title);
  overlay.innerHTML = `<div class="processing-card"><h3>${title}</h3><p>请保持当前页面在前台，完成后会自动下载。</p><div class="progress"><span id="operation-status">正在准备…</span><div class="progress-track"><div class="progress-fill"></div></div></div><button class="button secondary cancel-button">取消处理</button></div>`;
  document.body.append(overlay);
  const cancel = $("button", overlay);
  cancel.onclick = () => operationController?.abort();
  cancel.focus();
  const oldInert = $(".app-shell").inert;
  $(".app-shell").inert = true;
  const update = (value, label) => {
    $(".progress-fill", overlay).style.width =
      `${Math.max(0, Math.min(1, value)) * 100}%`;
    $("#operation-status", overlay).textContent =
      label || `正在处理 ${Math.round(value * 100)}%`;
  };
  try {
    await action(operationController.signal, update);
    if (!operationController.signal.aborted) toast("已生成文件，下载已开始。");
  } catch (error) {
    if (error.name === "AbortError") toast("已取消处理。");
    else errorToast(error);
  } finally {
    operationController = null;
    syncUndoButton();
    overlay.remove();
    $(".app-shell").inert = oldInert;
    $("#export")?.focus();
  }
}

function setupCompose() {
  const signal = toolController.signal;
  mountTool(
    "compose",
    upload(
      "videos",
      "添加视频",
      "拖入文件，支持多选 · MP4 / MOV / WebM",
      "video/*",
      true,
    ) +
      `<div id="video-files" class="file-list"></div><div id="batch-report" class="setting-hint" role="status" hidden></div>` +
      upload(
        "background",
        "添加背景图片",
        "可选，不添加时使用纯色背景",
        "image/*",
        false,
        true,
      ) +
      `<div id="background-status" class="setting-hint" hidden></div>` +
      field("背景颜色", input("bg-color", "#e8eef8", "color")) +
      field(
        "输出画幅",
        select(
          "resolution",
          [
            ["1280x720", "横屏 · 1280 × 720"],
            ["1920x1080", "横屏 · 1920 × 1080"],
            ["1080x1080", "方形 · 1080 × 1080"],
            ["720x1280", "竖屏 · 720 × 1280"],
          ],
          "1280x720",
        ),
      ) +
      field(
        "画面占比",
        input("video-scale", 92, "range", 'min="30" max="100"'),
        '<span id="scale-value">92%</span>',
      ) +
      field("输出格式", select("video-format", VIDEO_FORMATS, "mp4")) +
      `<label id="video-alpha-control" class="alpha-option" hidden><input id="video-alpha" type="checkbox" checked>透明留边（MOV · Alpha）<small>保留原视频内容，背景图和背景颜色不参与透明导出。</small></label>` +
      `<p class="setting-hint">支持 MP4、MOV 和 WebM，保留原声。批量文件会打包为 ZIP。</p>` +
      exportButton("导出视频"),
    canvasPreview(1280, 720, "为下一段作品，放入素材"),
  );
  const { canvas, ctx } = previewContext();
  let files = [],
    video = null,
    background = null,
    selected = 0,
    loadRevision = 0,
    backgroundRevision = 0,
    backgroundName = "",
    frame = 0;
  let completedResults = [],
    batchFailures = [],
    batchSummary = "";
  function renderBatchReport() {
    const report = $("#batch-report");
    report.hidden = !batchSummary;
    report.innerHTML = `<strong>${escapeHTML(batchSummary)}</strong>${batchFailures.length ? `<ul>${batchFailures.map(({ name, reason }) => `<li><b>${escapeHTML(name)}</b>：${escapeHTML(reason)}</li>`).join("")}</ul>` : ""}${completedResults.length ? `<p><button type="button" class="button secondary" data-download-completed>下载已完成的 ${completedResults.length} 个视频</button></p>` : ""}`;
  }
  async function downloadCompleted(signal, update) {
    if (signal.aborted) throw new DOMException("已取消", "AbortError");
    if (completedResults.length === 1) {
      download(completedResults[0].blob, completedResults[0].name);
      return;
    }
    const archive = await zipFiles(completedResults, {
      signal,
      onProgress: (progress) =>
        update(
          progress,
          `正在打包已完成的视频 · ${Math.round(progress * 100)}%`,
        ),
    });
    if (signal.aborted) throw new DOMException("已取消", "AbortError");
    download(archive, "Frame_视频合集.zip");
  }
  const options = () => {
    const [width, height] = $("#resolution").value.split("x").map(Number);
    return {
      width,
      height,
      bgImage: background,
      bgColor: $("#bg-color").value,
      fit: number("#video-scale", 30, 100, 92) / 100,
      format: $("#video-format").value,
      transparentBackground:
        $("#video-format").value === "mov" && $("#video-alpha").checked,
    };
  };
  const draw = () => {
    const opts = options();
    $("#video-alpha-control").hidden = opts.format !== "mov";
    $(".preview-surface").classList.toggle(
      "is-transparent",
      opts.transparentBackground,
    );
    if (canvas.width !== opts.width || canvas.height !== opts.height) {
      canvas.width = opts.width;
      canvas.height = opts.height;
    }
    if (video && video.readyState >= 2) drawComposition(ctx, video, opts);
    else if (opts.transparentBackground)
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    else {
      ctx.fillStyle = opts.bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    $("#scale-value").textContent = `${$("#video-scale").value}%`;
    $("#preview-info").textContent =
      `${canvas.width} × ${canvas.height} · ${video ? `${Math.round(video.duration)} 秒` : "实时预览"}`;
  };
  const tick = () => {
    if (video && !video.paused) {
      draw();
      frame = requestAnimationFrame(tick);
    }
  };
  const updateFiles = () => {
    $("#video-files").innerHTML = files
      .map(
        (f, i) =>
          `<div class="file-item ${i === selected ? "active" : ""}"><button data-select-video="${i}" aria-label="预览 ${escapeHTML(f.name)}">${icon("play")}</button><span>${escapeHTML(f.name)}</span><small>${(f.size / 1024 / 1024).toFixed(1)}M</small><button data-remove-video="${i}" aria-label="移除 ${escapeHTML(f.name)}">${icon("close")}</button></div>`,
      )
      .join("");
    $("#export").disabled = files.length === 0;
  };
  const showVideo = async (index) => {
    const revision = ++loadRevision;
    cancelAnimationFrame(frame);
    if (video) {
      disposeVideo(video);
      video = null;
    }
    selected = index;
    updateFiles();
    if (!files.length) {
      $("#preview-empty").hidden = false;
      $("#replay").hidden = true;
      draw();
      return;
    }
    try {
      const loaded = await loadVideo(files[index], { signal });
      if (revision !== loadRevision || signal.aborted) {
        disposeVideo(loaded);
        return;
      }
      video = loaded;
      video.muted = true;
      video.currentTime = 0;
      on(video, "loadeddata", draw);
      on(video, "seeked", draw);
      on(video, "ended", () => {
        $("#replay").innerHTML = `${icon("play")}播放预览`;
      });
      $("#preview-empty").hidden = true;
      $("#replay").hidden = false;
      $("#replay").innerHTML = `${icon("play")}播放预览`;
      draw();
    } catch (error) {
      if (revision === loadRevision && !signal.aborted) {
        errorToast(error);
        $("#preview-empty").hidden = false;
      }
    }
  };
  on($("#videos"), "change", async (e) => {
    const added = [...e.target.files].filter(
      (f) =>
        f.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(f.name),
    );
    if (!added.length) {
      toast("请选择视频文件。");
      return;
    }
    files.push(...added);
    e.target.value = "";
    await showVideo(files.length - added.length);
  });
  on($("#video-files"), "click", (e) => {
    const selectButton = e.target.closest("[data-select-video]");
    const remove = e.target.closest("[data-remove-video]");
    if (selectButton) showVideo(Number(selectButton.dataset.selectVideo));
    if (remove) {
      files.splice(Number(remove.dataset.removeVideo), 1);
      showVideo(Math.min(selected, Math.max(0, files.length - 1)));
    }
  });
  function renderBackground() {
    const status = $("#background-status");
    status.hidden = !background;
    status.innerHTML = background
      ? `已添加：${escapeHTML(backgroundName)} <button id="remove-background" class="text-link">移除</button>`
      : "";
  }
  on($("#background"), "change", async (e) => {
    const revision = ++backgroundRevision;
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    try {
      const image = await imageFile(file);
      if (signal.aborted || revision !== backgroundRevision) return;
      recordEdit(() => {
        background = image;
        backgroundName = file.name;
        renderBackground();
        draw();
      });
    } catch (error) {
      if (!signal.aborted && revision === backgroundRevision) errorToast(error);
    }
  });
  on($("#settings"), "input", draw);
  on($("#background-status"), "click", (e) => {
    if (!e.target.closest("#remove-background")) return;
    backgroundRevision++;
    background = null;
    $("#background").value = "";
    backgroundName = "";
    renderBackground();
    draw();
  });
  on($("#batch-report"), "click", (e) => {
    if (
      !e.target.closest("[data-download-completed]") ||
      !completedResults.length
    )
      return;
    runOperation("正在下载已完成的视频", downloadCompleted);
  });
  on($("#replay"), "click", async () => {
    if (!video) return;
    if (video.paused) {
      if (video.ended) video.currentTime = 0;
      try {
        await video.play();
        $("#replay").textContent = "暂停预览";
        tick();
      } catch (error) {
        errorToast(error);
      }
    } else {
      video.pause();
      $("#replay").innerHTML = `${icon("play")}播放预览`;
    }
  });
  on($("#export"), "click", () => {
    if (!files.length) {
      toast("请先添加视频。");
      return;
    }
    video?.pause();
    const sourceFiles = [...files];
    const compositionOptions = options();
    completedResults = [];
    batchFailures = [];
    batchSummary = `正在处理 ${sourceFiles.length} 个视频…`;
    renderBatchReport();
    runOperation("正在合成视频", async (signal, update) => {
      const used = new Set();
      try {
        for (let i = 0; i < sourceFiles.length; i++) {
          if (signal.aborted) throw new DOMException("已取消", "AbortError");
          const f = sourceFiles[i];
          try {
            const blob = await exportVideo(f, {
              ...compositionOptions,
              signal,
              onProgress: (p, stage) =>
                update(
                  (i + p) / sourceFiles.length,
                  `${i + 1} / ${sourceFiles.length} · ${f.name} · ${stage || "正在处理"} · ${Math.round(p * 100)}%`,
                ),
            });
            let name = videoFilename(
              `${cleanFilename(f.name.replace(/\.[^.]+$/, ""))}_居中`,
              compositionOptions.format,
            );
            const base = name;
            let duplicate = 2;
            while (used.has(name.toLowerCase()))
              name = `${duplicate++}_${base}`;
            used.add(name.toLowerCase());
            completedResults.push({ name, blob });
          } catch (error) {
            if (signal.aborted || error.name === "AbortError") throw error;
            batchFailures.push({
              name: f.name,
              reason: error.message || "处理失败，请检查文件格式。",
            });
          }
        }
        batchSummary = `处理完成：${completedResults.length} / ${sourceFiles.length} 个成功${batchFailures.length ? `，${batchFailures.length} 个失败` : ""}。`;
        if (!completedResults.length) {
          throw new Error("没有可下载的视频，请查看下方各文件的失败原因。");
        }
        await downloadCompleted(signal, update);
      } catch (error) {
        if (signal.aborted || error.name === "AbortError") {
          batchSummary = `已取消处理，已保留 ${completedResults.length} 个完成的视频。${completedResults.length ? "可点击下方按钮下载。" : ""}`;
        } else if (completedResults.length) {
          batchSummary = `已保留 ${completedResults.length} 个完成的视频，下载未完成：${error.message || "请重试下载。"}`;
        }
        throw error;
      } finally {
        renderBatchReport();
      }
    });
  });
  cleanups.push(() => {
    loadRevision++;
    cancelAnimationFrame(frame);
    if (video) disposeVideo(video);
  });
  updateFiles();
  draw();
  registerUndo({
    controls: settingsControls,
    capture: () => ({ files, selected, background, backgroundName }),
    restore(state) {
      const reload = files.length !== state.files.length ||
        files.some((file, index) => file !== state.files[index]) ||
        selected !== state.selected;
      ({ files, selected, background, backgroundName } = state);
      backgroundRevision++;
      $("#background").value = "";
      renderBackground();
      if (reload) showVideo(selected);
      else draw();
    },
  });
}

function setupRename() {
  mountTool(
    "rename",
    upload(
      "rename-files",
      "添加素材文件",
      "拖入文件，支持任意类型与批量选择",
      "*",
      true,
    ) +
      field("名称前缀", input("prefix", "素材", "text", 'maxlength="80"')) +
      `<div class="field-row">${field("起始序号", input("start", 1, "number", 'min="0" max="999999"'))}${field(
        "序号位数",
        select(
          "digits",
          [
            [2, "2 位 · 01"],
            [3, "3 位 · 001"],
            [4, "4 位 · 0001"],
          ],
          3,
        ),
      )}</div>` +
      field(
        "命名规则",
        select(
          "pattern",
          [
            ["simple", "前缀_序号"],
            ["date", "前缀_日期_序号"],
            ["original", "前缀_原文件名_序号"],
          ],
          "simple",
        ),
      ) +
      `<p class="setting-hint">自动保留扩展名。你也可以直接编辑右侧的新名称。原始文件不会被修改。</p>` +
      exportButton("打包下载 ZIP"),
    `<div id="rename-table" class="rename-table-wrap"></div><div class="preview-caption"><span id="rename-info">等待添加文件</span><button id="clear-files">清空列表</button></div>`,
  );
  let files = [],
    names = [];
  function renameAll(preserveExisting = false) {
    const prefix = cleanFilename($("#prefix").value || "素材");
    const start = Math.floor(number("#start", 0, 999999, 1));
    names = files.map((file, i) => {
      if (preserveExisting && names[i] !== undefined) return names[i];
      const dot = file.name.lastIndexOf(".");
      const extension = dot > 0 ? file.name.slice(dot) : "";
      const original = dot > 0 ? file.name.slice(0, dot) : file.name;
      const sequence = String(start + i).padStart(
        Number($("#digits").value),
        "0",
      );
      const extra =
        $("#pattern").value === "date"
          ? `_${localDate()}`
          : $("#pattern").value === "original"
            ? `_${original}`
            : "";
      return cleanFilename(`${prefix}${extra}_${sequence}`) + extension;
    });
    render();
  }
  function render() {
    $("#export").disabled = !files.length;
    $("#rename-info").textContent = files.length
      ? `${files.length} 个文件 · ${(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB`
      : "等待添加文件";
    $("#rename-table").innerHTML = files.length
      ? `<table class="rename-table"><thead><tr><th>#</th><th>原文件名</th><th>新文件名</th></tr></thead><tbody>${files.map((f, i) => `<tr><td>${i + 1}</td><td class="old-name">${escapeHTML(f.name)}</td><td><input data-name-index="${i}" value="${escapeHTML(names[i])}" aria-label="文件 ${i + 1} 的新名称"></td></tr>`).join("")}</tbody></table>`
      : '<div class="list-placeholder">添加文件后，在这里预览新名称。</div>';
  }
  on($("#rename-files"), "change", (e) => {
    files.push(...e.target.files);
    e.target.value = "";
    renameAll(true);
  });
  on($("#settings"), "input", (e) => {
    if (e.target.type !== "file") renameAll();
  });
  on($("#rename-table"), "input", (e) => {
    if (e.target.matches("[data-name-index]"))
      names[Number(e.target.dataset.nameIndex)] = e.target.value;
  });
  on($("#clear-files"), "click", () => {
    files = [];
    names = [];
    render();
  });
  on($("#export"), "click", () => {
    const safeNames = names.map(cleanFilename);
    if (
      new Set(safeNames.map((n) => n.toLowerCase())).size !== safeNames.length
    ) {
      toast("存在重复文件名，请调整后导出。");
      return;
    }
    runOperation("正在打包素材", async (signal, update) => {
      update(0.2, "正在准备文件…");
      await new Promise((r) => setTimeout(r, 30));
      const blob = await zipFiles(
        files.map((blob, i) => ({ name: safeNames[i], blob })),
        {
          signal,
          onProgress: (progress) =>
            update(progress, `正在打包… ${Math.round(progress * 100)}%`),
        },
      );
      if (signal.aborted) throw new DOMException("已取消", "AbortError");
      download(blob, "Frame_重命名素材.zip");
      update(1);
    });
  });
  render();
  registerUndo({
    controls: settingsControls,
    capture: () => ({ files, names }),
    restore(state) {
      ({ files, names } = state);
      render();
    },
  });
}

function formatTime(seconds, srt = false) {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${srt ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
}
function parseTime(value) {
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  const match = value.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return NaN;
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4].padEnd(3, "0")) / 1000
  );
}
function setupSubtitles() {
  const signal = toolController.signal;
  mountTool(
    "subtitles",
    field(
      "字幕文案",
      '<textarea id="subtitle-source" rows="6" placeholder="每行一条字幕">把每一个瞬间\n都变成值得记录的故事\n现在，就开始吧。</textarea>',
      "每行一条",
    ) +
      field(
        "每条默认时长",
        input(
          "subtitle-duration",
          3,
          "number",
          'min="0.1" max="600" step="0.5"',
        ),
        "秒",
      ) +
      '<button id="generate-subtitles" class="button secondary" style="width:100%">生成时间轴</button><hr class="setting-divider">' +
      upload(
        "srt-file",
        "导入已有 SRT",
        "可选，支持 UTF-8 字幕文件",
        ".srt",
        false,
        true,
      ) +
      `<p class="setting-hint">支持手动编辑时间和文字。时间格式为 HH:MM:SS.mmm，也可直接输入秒数。本工具不包含语音识别。</p>` +
      exportButton("导出 SRT 字幕"),
    '<div id="subtitle-list" class="subtitle-list"></div><button id="add-subtitle" class="button secondary add-subtitle">添加一条字幕</button><div class="preview-caption"><span id="subtitle-info"></span><span>精确至毫秒</span></div>',
  );
  let rows = [], importRevision = 0;
  function render() {
    $("#subtitle-list").innerHTML = rows
      .map(
        (row, i) =>
          `<div class="subtitle-row"><span>${String(i + 1).padStart(2, "0")}</span><input data-row="${i}" data-key="start" value="${escapeHTML(row.start)}" aria-label="字幕 ${i + 1} 开始时间"><input data-row="${i}" data-key="end" value="${escapeHTML(row.end)}" aria-label="字幕 ${i + 1} 结束时间"><textarea class="subtitle-text" data-row="${i}" data-key="text" rows="2" aria-label="字幕 ${i + 1} 文字">${escapeHTML(row.text)}</textarea><button data-delete-row="${i}" aria-label="删除字幕 ${i + 1}">${icon("trash")}</button></div>`,
      )
      .join("");
    $("#subtitle-info").textContent = `${rows.length} 条字幕`;
    $("#export").disabled = !rows.length;
  }
  function generate() {
    const lines = $("#subtitle-source")
      .value.split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    const duration = number("#subtitle-duration", 0.1, 600, 3);
    rows = lines.map((text, i) => ({
      start: formatTime(i * duration),
      end: formatTime((i + 1) * duration),
      text,
    }));
    render();
  }
  on($("#generate-subtitles"), "click", generate);
  on($("#subtitle-list"), "input", (e) => {
    if (e.target.dataset.row !== undefined)
      rows[Number(e.target.dataset.row)][e.target.dataset.key] = e.target.value;
  });
  on($("#subtitle-list"), "click", (e) => {
    const remove = e.target.closest("[data-delete-row]");
    if (remove) {
      rows.splice(Number(remove.dataset.deleteRow), 1);
      render();
    }
  });
  on($("#add-subtitle"), "click", () => {
    const end = rows.length ? parseTime(rows.at(-1).end) : 0;
    const start = Number.isFinite(end) ? end : 0;
    rows.push({
      start: formatTime(start),
      end: formatTime(start + number("#subtitle-duration", 0.1, 600, 3)),
      text: "新字幕",
    });
    render();
    $("#subtitle-list").scrollTop = $("#subtitle-list").scrollHeight;
  });
  on($("#srt-file"), "change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    const revision = ++importRevision;
    try {
      const text = (await file.text())
        .replace(/^\uFEFF/, "")
        .replace(/\r/g, "");
      if (signal.aborted || revision !== importRevision) return;
      const parsed = text
        .split(/\n\s*\n/)
        .filter((s) => s.trim())
        .map((block) => {
          const lines = block.split("\n");
          const timing = lines.findIndex((line) => line.includes("-->"));
          if (timing < 0)
            throw new Error("无法读取 SRT 时间轴，请检查文件格式。");
          const [start, end] = lines[timing].split("-->").map((x) => x.trim());
          if (
            !Number.isFinite(parseTime(start)) ||
            !Number.isFinite(parseTime(end))
          )
            throw new Error("SRT 中有无效的时间格式。");
          return {
            start: start.replace(",", "."),
            end: end.replace(",", "."),
            text: lines
              .slice(timing + 1)
              .join("\n")
              .replace(/\n+$/, ""),
          };
        });
      if (!parsed.length) throw new Error("字幕文件为空。");
      recordEdit(() => {
        rows = parsed;
        render();
      });
      toast(`已导入 ${rows.length} 条字幕。`);
    } catch (error) {
      errorToast(error);
    }
    e.target.value = "";
  });
  on($("#export"), "click", () => {
    let previousEnd = 0;
    const blocks = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i],
        start = Math.round(parseTime(row.start) * 1000) / 1000,
        end = Math.round(parseTime(row.end) * 1000) / 1000;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        start < previousEnd ||
        !row.text.trim()
      ) {
        toast(`第 ${i + 1} 条字幕无效：请检查时间顺序、重叠或空白文字。`);
        return;
      }
      previousEnd = end;
      blocks.push(
        `${i + 1}\n${formatTime(start, true)} --> ${formatTime(end, true)}\n${row.text}`,
      );
    }
    download(
      new Blob(["\uFEFF" + blocks.join("\n\n") + "\n"], {
        type: "application/x-subrip;charset=utf-8",
      }),
      "Frame_字幕.srt",
    );
    toast("SRT 字幕已导出。");
  });
  generate();
  registerUndo({
    controls: settingsControls,
    capture: () => (rows),
    restore(state) {
      importRevision++;
      rows = state;
      render();
    },
  });
}

function setupPolaroid() {
  const signal = toolController.signal;
  mountTool(
    "polaroid",
    upload(
      "photo",
      "添加你的照片",
      "JPG / PNG / WebP · 可先体验示例",
      "image/*",
    ) +
      field(
        "照片注释",
        input("caption", "把日子过成喜欢的样子。", "text", 'maxlength="35"'),
      ) +
      field(
        "日期 / 署名",
        input("photo-date", "A LITTLE MOMENT", "text", 'maxlength="35"'),
      ) +
      field("相纸颜色", input("paper-color", "#ffffff", "color")) +
      field("文字颜色", input("photo-text-color", "#475b77", "color")) +
      `<p class="setting-hint">图片自动居中裁切为方形。默认展示内置风景示例。</p>` +
      exportButton(),
    canvasPreview(1080, 1280, "", true),
  );
  const { canvas, ctx } = previewContext();
  let photo = null,
    revision = 0;
  function draw() {
    ctx.fillStyle = $("#paper-color").value;
    ctx.fillRect(0, 0, 1080, 1280);
    if (photo) coverImage(ctx, photo, 70, 70, 940, 940);
    else scene(ctx, 70, 70, 940, 940);
    ctx.textAlign = "center";
    ctx.fillStyle = $("#photo-text-color").value;
    ctx.font = font(38);
    linesText(ctx, $("#caption").value, 540, 1098, 940, 48, 2);
    ctx.globalAlpha = 0.5;
    ctx.font = font(19);
    ctx.fillText($("#photo-date").value, 540, 1210);
    ctx.globalAlpha = 1;
  }
  on($("#photo"), "change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    const current = ++revision;
    try {
      const result = await imageFile(file);
      if (current !== revision || signal.aborted) return;
      recordEdit(() => {
        photo = result;
        draw();
      });
    } catch (error) {
      errorToast(error);
    }
  });
  on($("#settings"), "input", draw);
  on($("#export"), "click", async () => {
    try {
      download(await canvasBlob(canvas), "Frame_相纸图.png");
      toast("相纸图已导出。");
    } catch (error) {
      errorToast(error);
    }
  });
  draw();
  registerUndo({
    controls: settingsControls,
    capture: () => (photo),
    restore(state) {
      revision++;
      photo = state;
      draw();
    },
  });
}
function setupBubbles() {
  mountTool(
    "bubbles",
    field(
      "气泡内容",
      '<textarea id="bubble-text" maxlength="100">灵感，正在发生。</textarea>',
      "最多 100 字",
    ) +
      field(
        "气泡方向",
        select(
          "bubble-side",
          [
            ["right", "右侧 · 发出的消息"],
            ["left", "左侧 · 收到的消息"],
          ],
          "right",
        ),
      ) +
      `<div class="field-row">${field("气泡颜色", input("bubble-color", "#dceaff", "color"))}${field("文字颜色", input("bubble-text-color", "#254c88", "color"))}</div>` +
      field(
        "文字大小",
        input("bubble-size", 48, "range", 'min="24" max="64"'),
        "24 – 64 px",
      ) +
      `<p class="setting-hint">棋盘格代表透明区域，不会出现在导出的图片中。适合叠加到视频或设计画面。</p>` +
      exportButton("导出透明 PNG"),
    canvasPreview(1080, 600),
  );
  const { canvas, ctx } = previewContext();
  function draw() {
    ctx.clearRect(0, 0, 1080, 600);
    let size = number("#bubble-size", 24, 64, 48);
    ctx.font = font(size);
    let lines = wrapText(ctx, $("#bubble-text").value || " ", 830);
    while (lines.length * size * 1.5 + 60 > 500 && size > 12) {
      size -= 1;
      ctx.font = font(size);
      lines = wrapText(ctx, $("#bubble-text").value || " ", 830);
    }
    const width = Math.min(
      950,
      Math.max(180, ...lines.map((line) => ctx.measureText(line).width + 100)),
    );
    const height = Math.max(120, lines.length * size * 1.5 + 60);
    const x = (1080 - width) / 2,
      y = (600 - height) / 2;
    const right = $("#bubble-side").value === "right";
    rounded(
      ctx,
      x,
      y,
      width,
      height,
      right ? [36, 36, 8, 36] : [36, 36, 36, 8],
      $("#bubble-color").value,
    );
    ctx.fillStyle = $("#bubble-text-color").value;
    ctx.textAlign = "left";
    lines.forEach((line, i) =>
      ctx.fillText(line, x + 50, y + 45 + size + i * size * 1.5),
    );
  }
  on($("#settings"), "input", draw);
  on($("#export"), "click", async () => {
    if (!$("#bubble-text").value.trim()) {
      toast("先写下一句文字吧。");
      return;
    }
    try {
      download(await canvasBlob(canvas), "Frame_透明气泡.png");
      toast("透明气泡已导出。");
    } catch (error) {
      errorToast(error);
    }
  });
  draw();
  registerUndo({
    controls: settingsControls,
    restore(state) {
      draw();
    },
  });
}

function editorApi() {
  return {
    mountTool,
    canvasPreview,
    field,
    input,
    select,
    upload,
    escapeHTML,
    icon,
    createTimeline: createAnimationTimeline,
    on,
    signal: toolController.signal,
    registerUndo,
    recordEdit,
    beginUndoEdit,
    addCleanup: (cleanup) => cleanups.push(cleanup),
    toast,
    errorToast,
    runOperation,
  };
}

function setupChatAnimation() {
  setupChatEditor(editorApi());
}

function setupMix() {
  setupMixEditor(editorApi());
}

function setupSmart() {
  setupSmartEditor(editorApi());
}

function setupAnimation(id) {
  let settings = "";
  if (id === "timer")
    settings =
      field(
        "倒计时秒数",
        input("timer-seconds", 10, "number", 'min="1" max="60"'),
        "1 – 60 秒",
      ) +
      field(
        "标题",
        input("timer-title", "好事，即将发生。", "text", 'maxlength="24"'),
      ) +
      field(
        "结束文字",
        input("timer-end", "现在，开始吧。", "text", 'maxlength="24"'),
      ) +
      field(
        "画幅",
        select(
          "timer-ratio",
          [
            ["landscape", "横屏 · 1280 × 720"],
            ["portrait", "竖屏 · 720 × 1280"],
          ],
          "landscape",
        ),
      ) +
      `<div class="field-row">${field("背景色", input("timer-bg", "#214b97", "color"))}${field("文字色", input("timer-color", "#eef5ff", "color"))}</div>`;
  if (id === "choices")
    settings =
      field(
        "问题",
        input("question", "今天，想去哪里？", "text", 'maxlength="60"'),
      ) +
      field(
        "选项",
        '<textarea id="choice-options" rows="4" aria-describedby="choice-feedback">去山野，听风\n去海边，放空\n留在家，看一场电影</textarea>',
        "每行一项，最多 4 项、共 160 字",
      ) +
      '<p id="choice-feedback" class="setting-hint" role="status" aria-live="polite"></p>' +
      field(
        "揭晓选项",
        select(
          "choice-answer",
          [
            [0, "A · 第 1 项"],
            [1, "B · 第 2 项"],
            [2, "C · 第 3 项"],
            [3, "D · 第 4 项"],
          ],
          1,
        ),
      ) +
      field(
        "揭晓时间",
        select(
          "choice-delay",
          [
            [1, "1 秒后"],
            [2, "2 秒后"],
            [3, "3 秒后"],
          ],
          2,
        ),
      );
  mountTool(
    id,
    settings +
      field("输出格式", select("animation-format", VIDEO_FORMATS, "mp4")) +
      `<label id="animation-alpha-control" class="alpha-option" hidden><input id="animation-alpha" type="checkbox" checked>透明背景（MOV · Alpha）<small>导出 ProRes 4444，方便叠加在剪辑画面上。</small></label>` +
      `<hr class="setting-divider"><p class="setting-hint">在画面下方播放、暂停或拖动时间线。确认效果后，导出无声 MP4、MOV 或 WebM 动画。</p>` +
      exportButton("导出动画"),
    canvasPreview(
      id === "timer" ? 1280 : 720,
      id === "timer" ? 720 : 1280,
      "",
      id !== "timer",
    ),
  );
  const { canvas, ctx } = previewContext();
  const choiceLines = () =>
    $("#choice-options")
      .value.replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((line) => line.trim().length > 0);
  const choiceState = () => {
    const options = choiceLines();
    const count = Array.from(
      $("#choice-options").value.replace(/[\r\n]/g, ""),
    ).length;
    const errors = [];
    if (!options.length) errors.push("请至少填写 1 个选项");
    if (options.length > 4)
      errors.push(`当前有 ${options.length} 项，最多支持 4 项`);
    if (count > 160) errors.push(`当前共 ${count} 字，最多支持 160 字`);
    return {
      options,
      count,
      error: errors.length ? `${errors.join("；")}。` : "",
    };
  };
  const validateChoices = () => {
    if (id !== "choices") return;
    const state = choiceState();
    const feedback = $("#choice-feedback");
    feedback.textContent =
      state.error ||
      `共 ${state.options.length} 项 · ${state.count} / 160 字（不含换行）`;
    feedback.style.color = state.error ? "#ad493e" : "";
    $("#choice-options").setCustomValidity(state.error);
    $("#choice-options").setAttribute(
      "aria-invalid",
      String(Boolean(state.error)),
    );
    $("#export").disabled = Boolean(state.error);
    return state;
  };
  validateChoices();
  const duration = () =>
    id === "timer"
      ? Math.floor(number("#timer-seconds", 1, 60, 10)) + 1
      : Number($("#choice-delay").value) + 2;
  function draw(time = 0) {
    const mov = $("#animation-format").value === "mov";
    const transparent = mov && $("#animation-alpha").checked;
    $("#animation-alpha-control").hidden = !mov;
    $(".preview-surface").classList.toggle("is-transparent", transparent);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (id === "timer") {
      const portrait = $("#timer-ratio").value === "portrait";
      const w = portrait ? 720 : 1280,
        h = portrait ? 1280 : 720;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const seconds = Math.floor(number("#timer-seconds", 1, 60, 10));
      const remaining = Math.max(
        0,
        seconds - Math.floor(Number.isFinite(time) ? time : 0),
      );
      if (!transparent) {
        ctx.fillStyle = $("#timer-bg").value;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.textAlign = "center";
      ctx.fillStyle = $("#timer-color").value;
      ctx.globalAlpha = 0.5;
      ctx.font = font(15);
      ctx.fillText("MAKE EVERY SECOND COUNT", w / 2, h * 0.26);
      ctx.globalAlpha = 1;
      ctx.font = font(portrait ? 107 : 150, 300);
      ctx.fillText(
        `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`,
        w / 2,
        h * 0.54,
      );
      ctx.globalAlpha = 0.8;
      ctx.font = font(27);
      ctx.fillText(
        remaining === 0 ? $("#timer-end").value : $("#timer-title").value,
        w / 2,
        h * 0.66,
      );
      ctx.globalAlpha = 0.18;
      rounded(ctx, w * 0.3, h * 0.75, w * 0.4, 3, 2, $("#timer-color").value);
      ctx.globalAlpha = 0.85;
      rounded(
        ctx,
        w * 0.3,
        h * 0.75,
        w * 0.4 * (remaining / seconds),
        3,
        2,
        $("#timer-color").value,
      );
      ctx.globalAlpha = 1;
    } else {
      if (!transparent) {
        ctx.fillStyle = "#e5ecf5";
        ctx.fillRect(0, 0, 720, 1280);
      }
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#6e86a8";
      ctx.font = font(17);
      ctx.textAlign = "center";
      ctx.fillText("A MOMENT TO CHOOSE", 360, 150);
      const state = choiceState();
      if (state.error) {
        ctx.fillStyle = "#253955";
        ctx.font = font(32, 500);
        ctx.fillText("请调整选项内容", 360, 490);
        ctx.fillStyle = "#8d574f";
        ctx.font = font(25);
        wrapText(ctx, state.error, 540).forEach((line, index) =>
          ctx.fillText(line, 360, 560 + index * 39),
        );
        ctx.fillStyle = "#748bac";
        ctx.font = font(21);
        ctx.fillText("已保留完整输入，未删除内容。", 360, 770);
        $("#preview-info").textContent = "请修改选项后预览或导出";
        return;
      }
      ctx.fillStyle = "#253955";
      let questionSize = 40;
      ctx.font = font(questionSize, 500);
      while (
        wrapText(ctx, $("#question").value, 560).length > 3 &&
        questionSize > 20
      ) {
        questionSize -= 1;
        ctx.font = font(questionSize, 500);
      }
      const questionLines = wrapText(ctx, $("#question").value, 560);
      const questionLineHeight = Math.round(questionSize * 1.45);
      questionLines.forEach((line, index) =>
        ctx.fillText(line, 360, 260 + index * questionLineHeight),
      );
      const questionBottom =
        260 +
        (questionLines.length - 1) * questionLineHeight +
        questionSize * 0.3;
      const cardsTop = Math.max(410, questionBottom + 64);
      const availableHeight = 1044 - cardsTop;
      const gap = 22;
      let optionSize = 28;
      let optionLineHeight;
      let cards;
      let cardsHeight;
      do {
        ctx.font = font(optionSize);
        optionLineHeight = Math.round(optionSize * 1.4);
        cards = state.options.map((text) => {
          const lines = wrapText(ctx, text, 450);
          return {
            lines,
            height: Math.max(98, lines.length * optionLineHeight + 40),
          };
        });
        cardsHeight =
          cards.reduce((sum, card) => sum + card.height, 0) +
          gap * (cards.length - 1);
        if (cardsHeight <= availableHeight || optionSize <= 18) break;
        optionSize--;
      } while (true);
      const chosen = Math.min(
        Number($("#choice-answer").value),
        state.options.length - 1,
      );
      const reveal = time >= Number($("#choice-delay").value);
      let cardY =
        cardsTop +
        Math.min(60, Math.max(0, (availableHeight - cardsHeight) / 4));
      cards.forEach((card, i) => {
        const active = reveal && i === chosen;
        rounded(
          ctx,
          65,
          cardY,
          590,
          card.height,
          16,
          active ? "#285cda" : "#fff",
        );
        ctx.fillStyle = active ? "#bdc7d5" : "#8fa0b7";
        ctx.font = font(24, 500);
        ctx.textAlign = "left";
        ctx.fillText(
          String.fromCharCode(65 + i),
          94,
          cardY + card.height / 2 + 8,
        );
        ctx.fillStyle = active ? "#ffffff" : "#52698a";
        ctx.font = font(optionSize);
        const firstLineY =
          cardY +
          (card.height - (card.lines.length - 1) * optionLineHeight) / 2 +
          optionSize * 0.35;
        card.lines.forEach((line, lineIndex) =>
          ctx.fillText(line, 146, firstLineY + lineIndex * optionLineHeight),
        );
        cardY += card.height + gap;
      });
      ctx.textAlign = "center";
      ctx.font = font(18);
      ctx.fillStyle = "#748bac";
      ctx.fillText(
        reveal ? "跟随你的心意。" : "给自己一点思考的时间。",
        360,
        1100,
      );
    }
    $("#preview-info").textContent =
      `${canvas.width} × ${canvas.height} · ${duration().toFixed(1)} 秒`;
  }
  const timeline = createAnimationTimeline({
    duration,
    draw,
    segments: () => {
      if (id === "timer")
        return [
          { label: "倒计时", length: duration() - 1 },
          { label: "结束", length: 1 },
        ];
      if (id === "choices")
        return [
          { label: "等待选择", length: Number($("#choice-delay").value) },
          { label: "揭晓答案", length: 2 },
        ];
      return [];
    },
  });
  on($("#settings"), "input", () => {
    validateChoices();
    timeline.refresh();
  });
  on($("#export"), "click", () => {
    if (id === "choices" && validateChoices().error) {
      toast(choiceState().error);
      return;
    }
    timeline.pause();
    const format = $("#animation-format").value;
    const exportDuration = duration();
    runOperation("正在生成动画", async (signal, update) => {
      try {
        const blob = await exportCanvasVideo(canvas, draw, {
          format,
          duration: exportDuration,
          fps: 30,
          videoBitsPerSecond: 6000000,
          signal,
          onProgress: (progress, stage) =>
            update(
              progress,
              stage ||
                `正在生成 ${format.toUpperCase()} 动画 · ${Math.round(progress * 100)}%`,
            ),
        });
        if (signal.aborted) throw new DOMException("已取消", "AbortError");
        download(
          blob,
          videoFilename(`Frame_${tools.find((t) => t.id === id).name}`, format),
        );
      } finally {
        timeline.render();
      }
    });
  });
  registerUndo({
    controls: settingsControls,
    restore(state) {
      validateChoices();
      timeline.refresh();
    },
  });
}

function setupPalette() {
  const signal = toolController.signal;
  mountTool(
    "palette",
    upload(
      "palette-image",
      "添加一张图片",
      "从画面中寻找你的配色灵感",
      "image/*",
    ) +
      `<p class="setting-hint">点击右侧图片，拾取任意位置的颜色。点击色卡复制 HEX 色值。</p><label class="field"><span>当前选中色</span><div class="color-row"><input id="picked-color" type="color" value="#285cda" aria-label="当前颜色"><code id="picked-hex">#285CDA</code></div></label><button id="copy-color" class="button secondary" style="width:100%">${icon("copy")}复制当前颜色</button><hr class="setting-divider"><p class="setting-hint">代表色通过图片像素分组提取。默认展示内置风景示例。</p>` +
      exportButton("导出 PNG 色卡"),
    canvasPreview(1000, 650) +
      `<div id="palette-output" class="palette-output"></div><p class="swatch-help">点击色卡即可复制 · 从左至右按明度排列</p>`,
  );
  const { canvas, ctx } = previewContext();
  let colors = ["#346495", "#6495bd", "#99b9d4", "#c9def2", "#f3f8ff"],
    revision = 0,
    image = null;
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value.toUpperCase());
      toast(`已复制 ${value.toUpperCase()}`);
    } catch {
      const area = document.createElement("textarea");
      area.value = value.toUpperCase();
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      toast(
        ok ? `已复制 ${value.toUpperCase()}` : `色值：${value.toUpperCase()}`,
      );
    }
  }
  function setColor(color) {
    $("#picked-color").value = color;
    $("#picked-hex").textContent = color.toUpperCase();
  }
  function showColors() {
    $("#palette-output").innerHTML = colors
      .map(
        (color) =>
          `<button class="color-chip" data-color="${color}" aria-label="复制色值 ${color}"><i style="background:${color}"></i><span>${color.toUpperCase()}</span></button>`,
      )
      .join("");
  }
  function extract() {
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const groups = new Map();
    for (let i = 0; i < data.length; i += 40) {
      if (data[i + 3] < 128) continue;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        key = `${r >> 5},${g >> 5},${b >> 5}`;
      const bucket = groups.get(key) || { r: 0, g: 0, b: 0, count: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count++;
      groups.set(key, bucket);
    }
    const buckets = [...groups.values()].sort((a, b) => b.count - a.count);
    const selected = [];
    for (const bucket of buckets) {
      const color = [bucket.r, bucket.g, bucket.b].map((v) =>
        Math.round(v / bucket.count),
      );
      if (
        selected.every(
          (other) => Math.hypot(...color.map((v, i) => v - other[i])) > 45,
        )
      )
        selected.push(color);
      if (selected.length === 5) break;
    }
    colors = selected
      .sort(
        (a, b) =>
          a[0] * 0.2126 +
          a[1] * 0.7152 +
          a[2] * 0.0722 -
          (b[0] * 0.2126 + b[1] * 0.7152 + b[2] * 0.0722),
      )
      .map(
        (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join(""),
      );
    showColors();
    if (colors[0]) setColor(colors[0]);
  }
  function drawImage() {
    if (!image) {
      canvas.width = 1000;
      canvas.height = 650;
      scene(ctx, 0, 0, 1000, 650);
      $("#preview-info").textContent = "1000 × 650 · 实时预览";
      return;
    }
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    $("#preview-info").textContent =
      `${image.naturalWidth} × ${image.naturalHeight} · 点击图片取色`;
  }
  drawImage();
  showColors();
  $("#canvas").style.cursor = "crosshair";
  on($("#palette-image"), "change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    const current = ++revision;
    try {
      const photo = await imageFile(file);
      if (current !== revision || signal.aborted) return;
      recordEdit(() => {
        image = photo;
        drawImage();
        extract();
      });
    } catch (error) {
      if (!signal.aborted && current === revision) errorToast(error);
    }
  });
  on(canvas, "click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(
        canvas.width - 1,
        Math.max(
          0,
          Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width),
        ),
      ),
      y = Math.min(
        canvas.height - 1,
        Math.max(
          0,
          Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height),
        ),
      );
    const data = ctx.getImageData(x, y, 1, 1).data;
    setColor(
      "#" +
        [data[0], data[1], data[2]]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join(""),
    );
  });
  on($("#palette-output"), "click", (e) => {
    const chip = e.target.closest("[data-color]");
    if (chip) {
      setColor(chip.dataset.color);
      copy(chip.dataset.color);
    }
  });
  on($("#picked-color"), "input", (e) => setColor(e.target.value));
  on($("#copy-color"), "click", () => copy($("#picked-color").value));
  on($("#export"), "click", async () => {
    const output = document.createElement("canvas");
    output.width = 1200;
    output.height = 450;
    const context = output.getContext("2d");
    context.fillStyle = "#f7f9fb";
    context.fillRect(0, 0, 1200, 450);
    context.font = font(18, 500);
    context.fillStyle = "#5b7598";
    context.fillText("FRAME / COLOR NOTES", 45, 50);
    const width = 1110 / colors.length;
    colors.forEach((color, i) => {
      context.fillStyle = color;
      context.fillRect(45 + i * width, 85, width, 255);
      context.fillStyle = "#4a5e7a";
      context.font = font(20);
      context.fillText(color.toUpperCase(), 60 + i * width, 388);
    });
    try {
      download(await canvasBlob(output), "Frame_配色色卡.png");
      toast("配色色卡已导出。");
    } catch (error) {
      errorToast(error);
    }
  });
  registerUndo({
    controls: settingsControls,
    capture: () => ({ image, colors }),
    restore(state) {
      revision++;
      ({ image, colors } = state);
      drawImage();
      showColors();
      setColor($("#picked-color").value);
    },
  });
}

function openTool(id, sourceCategory = activeCategory, undoState) {
  const tool = tools.find((item) => item.id === id);
  if (!tool) return;
  activeCategory =
    sourceCategory === "favorites" && favorites.has(id)
      ? "favorites"
      : tool.category;
  expandedCategory = activeCategory;
  closeWorkspace();
  currentTool = id;
  toolController = new AbortController();
  $("#home").hidden = true;
  $("#workspace").hidden = false;
  ({
    compose: setupCompose,
    mix: setupMix,
    rename: setupRename,
    smart: setupSmart,
    subtitles: setupSubtitles,
    polaroid: setupPolaroid,
    bubbles: setupBubbles,
    palette: setupPalette,
    chat: setupChatAnimation,
    timer: () => setupAnimation("timer"),
    choices: () => setupAnimation("choices"),
  })[id]();
  const state = undoState || toolStates.get(id);
  toolStates.delete(id);
  if (state) undoEditor.restore(state);
  syncUndoButton();
  renderNavigation();
  window.scrollTo({ top: 0, behavior: "instant" });
  const heading = $(".workspace-heading h1");
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  document.title = `${tools.find((t) => t.id === id).name} — Frame`;
  history.replaceState(null, "", `#${id}`);
}
document.addEventListener("click", (e) => {
  const target = e.target.closest("button,a");
  if (!target) return;
  if (target.dataset.navTool) {
    openTool(target.dataset.navTool, target.dataset.navCategory);
    return;
  }
  if (target.dataset.open) {
    openTool(target.dataset.open, target.dataset.navCategory || activeCategory);
    return;
  }
  if (target.dataset.category) {
    const category = target.dataset.category;
    const fromSidebar = Boolean(target.closest("#navigation"));
    const wasMenuOpen = mobileNavigationOpen;
    const collapse =
      fromSidebar &&
      !currentTool &&
      activeCategory === category &&
      expandedCategory === category &&
      (!compactNavigation.matches || mobileNavigationOpen);
    closeWorkspace();
    activeCategory = category;
    if (category === "all") $("#search").value = "";
    else expandedCategory = collapse ? null : category;
    mobileNavigationOpen =
      compactNavigation.matches &&
      fromSidebar &&
      (category === "all" ? wasMenuOpen : Boolean(expandedCategory));
    renderTools();
    if (fromSidebar)
      $(`#nav-category-${category}`)?.focus({ preventScroll: true });
    document.title = "Frame — 素材工具台";
    history.replaceState(null, "", location.pathname);
    return;
  }
  if (target.dataset.favorite) {
    const id = target.dataset.favorite;
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    try {
      localStorage.setItem("frame-favorites", JSON.stringify([...favorites]));
    } catch {}
    renderTools();
    return;
  }
  const action = target.dataset.action;
  if (action === "browse-tools") {
    $("#toolbox").scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    const heading = $("#section-title");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    return;
  }
  if (action === "close-navigation") {
    closeNavigationMenu(true);
    return;
  }
  if (
    action === "back" ||
    action === "home" ||
    target.classList.contains("brand")
  ) {
    e.preventDefault();
    if (action === "home" || target.classList.contains("brand")) {
      activeCategory = "all";
      $("#search").value = "";
    }
    closeWorkspace();
    document.title = "Frame — 素材工具台";
    history.replaceState(null, "", location.pathname);
    if (target.classList.contains("brand"))
      requestAnimationFrame(() =>
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
        }),
      );
  }
  if (action === "undo") undoLastEdit();
  if (action === "help") $("#help-dialog").showModal();
  if (action === "close-help") $("#help-dialog").close();
  if (action === "reset-search") {
    activeCategory = "all";
    expandedCategory = null;
    mobileNavigationOpen = false;
    $("#search").value = "";
    renderTools();
  }
});
$("#search").addEventListener("input", renderTools);
document.addEventListener("pointerdown", (event) => {
  if (mobileNavigationOpen && !event.target.closest("#navigation"))
    closeNavigationMenu();
});
document.addEventListener("focusin", (event) => {
  if (mobileNavigationOpen && !event.target.closest("#navigation"))
    closeNavigationMenu();
});
compactNavigation.addEventListener("change", () => {
  mobileNavigationOpen = false;
  renderNavigation();
});
window.addEventListener("resize", positionNavigationMenu);
$("#navigation").addEventListener("scroll", positionNavigationMenu);
document.addEventListener("focusout", () => undoHistory.breakGroup(), true);
document.addEventListener("keydown", (e) => {
  if (!e.defaultPrevented && !e.isComposing && !e.shiftKey && !e.altKey &&
      (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" &&
      !e.target.closest('[contenteditable="true"], input[type="password"], #search, #chat-paste-content, #smart-option-form') &&
      !$("dialog[open]") && undoLastEdit()) {
    e.preventDefault();
    return;
  }
  if (e.key === "Escape" && mobileNavigationOpen) {
    e.preventDefault();
    closeNavigationMenu(true);
    return;
  }
  if (
    e.key === "/" &&
    !currentTool &&
    !e.target.matches("input,textarea,select") &&
    !$("#help-dialog").open
  ) {
    e.preventDefault();
    $("#search").focus();
  }
  if (e.key === "Escape" && operationController) operationController.abort();
});
hydrateIcons();
renderTools();
function followToolLink() {
  if (operationController) {
    history.replaceState(
      null,
      "",
      currentTool ? `#${currentTool}` : location.pathname,
    );
    return;
  }
  const id = location.hash.slice(1);
  if (id === currentTool) return;
  if (tools.some((tool) => tool.id === id)) openTool(id);
  else if (currentTool) {
    closeWorkspace();
    document.title = "Frame — 素材工具台";
  }
}
window.addEventListener("hashchange", followToolLink);
followToolLink();
