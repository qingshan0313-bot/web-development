import {
  CHAT_DEFAULTS,
  normalizeChatProject,
  buildChatSchedule,
  getChatFrame,
} from "./chat-model.js";
import { renderChat } from "./chat-renderer.js";
import { download, loadImage, canvasBlob } from "./media.js";
import {
  VIDEO_FORMATS,
  exportCanvasVideo,
  videoFilename,
} from "./video-export.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const DRAFT_KEY = "frame-chat-project-v1";
const KEYBOARD_DEFAULTS_VERSION = 1;
const durationText = (seconds) =>
  `${Math.floor(Math.round(seconds * 10) / 600)
    .toString()
    .padStart(
      2,
      "0",
    )}:${((Math.round(seconds * 10) % 600) / 10).toFixed(1).padStart(4, "0")}`;
const newId = () =>
  `message-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

/** The editor changes one project; preview, timeline and export all read the same schedule. */
export function setupChatEditor(api) {
  const {
    mountTool,
    canvasPreview,
    field,
    input,
    select,
    icon,
    createTimeline,
    on,
    signal,
    addCleanup,
    toast,
    errorToast,
    runOperation,
  } = api;
  let project = normalizeChatProject(CHAT_DEFAULTS);
  let schedule = buildChatSchedule(project);
  let assets = {
    backgroundImage: null,
    backgroundData: "",
    backgroundName: "",
  };
  let tab = "script",
    saveTimer,
    loadRevision = 0,
    loading = false,
    invalid = "",
    removed = null,
    timeline;
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (stored) {
      project = normalizeChatProject(stored.project);
      // Apply the English keyboard once to older drafts, preserving later choices.
      if (
        (stored.keyboardDefaultsVersion ?? 0) < KEYBOARD_DEFAULTS_VERSION &&
        project.keyboardLayout !== "none"
      ) {
        project.keyboardLanguage = "en";
        project.keyboardLayout = "qwerty";
      }
      schedule = buildChatSchedule(project);
      if (["script", "screen", "export"].includes(stored.tab)) tab = stored.tab;
    }
  } catch {
    stored = null;
  }

  const control = (key, html) =>
    html.replace(/<(input|select|textarea)\b/, `<$1 data-project-key="${key}"`);
  const setting = (label, id, html, hint = "") =>
    `<div class="chat-setting"><label for="${id}">${label}${hint ? `<small>${hint}</small>` : ""}</label><div class="chat-control">${html}</div></div>`;
  const range = (label, key, id, min, max, unit) =>
    `<div class="chat-range"><label for="${id}">${label}<output data-range-output="${key}">${project[key]} ${unit}</output></label>${control(key, input(id, project[key], "range", `min="${min}" max="${max}" step="1"`))}</div>`;
  const check = (label, key) =>
    `<label class="chat-check"><span>${label}</span><input type="checkbox" data-project-key="${key}" ${project[key] ? "checked" : ""}></label>`;
  const color = (label, key) =>
    field(label, control(key, input(`chat-${key}`, project[key], "color")));

  function messageMarkup() {
    return (
      project.messages
        .map(
          (
            message,
            index,
          ) => `<article class="message-card" data-message-id="${message.id}">
      <div class="message-header"><span class="message-number">${String(index + 1).padStart(2, "0")}</span><select data-message-key="side" aria-label="第 ${index + 1} 条消息方向"><option value="left" ${message.side === "left" ? "selected" : ""}>对方 · 左侧</option><option value="right" ${message.side === "right" ? "selected" : ""}>自己 · 右侧</option></select><div class="message-actions"><button data-chat-action="up" aria-label="上移第 ${index + 1} 条" ${index === 0 ? "disabled" : ""}>↑</button><button data-chat-action="down" aria-label="下移第 ${index + 1} 条" ${index === project.messages.length - 1 ? "disabled" : ""}>↓</button><button data-chat-action="delete" aria-label="删除第 ${index + 1} 条">${icon("trash")}</button></div></div>
      <textarea data-message-key="text" rows="2" aria-label="第 ${index + 1} 条台词" placeholder="写下这句台词…">${escape(message.text)}</textarea>
      <div class="message-footer"><label>停留 <input data-message-key="hold" type="number" min="0.2" max="10" step="0.1" value="${message.hold}" aria-label="第 ${index + 1} 条停留秒数"> 秒</label><span class="message-count">${Array.from(message.text).length}/300</span><button data-chat-action="locate">${icon("play")}定位</button></div></article>`,
        )
        .join("") ||
      '<div class="chat-empty">还没有台词，添加第一句对话吧。</div>'
    );
  }

  function settingsMarkup() {
    return `<div class="chat-tabs" role="tablist" aria-label="对话动画设置"><button role="tab" id="chat-tab-script" data-chat-tab="script" aria-controls="chat-panel-script">台词顺序</button><button role="tab" id="chat-tab-screen" data-chat-tab="screen" aria-controls="chat-panel-screen">画面键盘</button><button role="tab" id="chat-tab-export" data-chat-tab="export" aria-controls="chat-panel-export">导出文件</button></div>
    <section id="chat-panel-script" class="chat-tab-panel" role="tabpanel" aria-labelledby="chat-tab-script">
      ${field("对话标题", control("title", input("chat-title", project.title, "text", 'maxlength="80"')), "长标题自动缩小，超出部分省略显示")}
      <div class="chat-list-heading"><span id="chat-message-count">${project.messages.length} / 20 条台词</span><button data-chat-action="paste">批量粘贴</button></div>
      <div id="chat-messages" class="chat-messages">${messageMarkup()}</div>
      <button class="button secondary chat-add" data-chat-action="add">${icon("plus")}添加一句</button><button class="chat-undo" data-chat-action="undo-delete" hidden>撤销刚才的删除</button>
      <p class="setting-hint chat-script-hint">对方消息直接出现，自己的消息逐字输入。每句可单独设置停留时间，空白台词不会导出。长对话自动滚动。</p>
    </section>
    <section id="chat-panel-screen" class="chat-tab-panel" role="tabpanel" aria-labelledby="chat-tab-screen">
      <h3 class="chat-section-title">画面显示</h3>
      ${check("显示上方栏", "showHeader")}
      <p class="setting-hint">包含时间、电量、返回按钮和对话标题。取消勾选后，聊天区域延伸至顶部。</p>
      <hr class="setting-divider"><h3 class="chat-section-title">输入节奏</h3>
      ${range("打字速度", "typingSpeed", "chat-speed", 1, 30, "字符 / 秒")}
      ${setting(
        "键盘布局",
        "chat-layout",
        control(
          "keyboardLayout",
          select(
            "chat-layout",
            [
              ["nine", "9 键 · 九宫格"],
              ["qwerty", "26 键 · QWERTY"],
              ["none", "不显示键盘"],
            ],
            project.keyboardLayout,
          ),
        ),
      )}
      ${setting(
        "语言模式",
        "chat-language",
        control(
          "keyboardLanguage",
          select(
            "chat-language",
            [
              ["auto", "自动匹配台词"],
              ["zh", "中文模式"],
              ["en", "English · 英语模式"],
            ],
            project.keyboardLanguage,
          ),
        ),
      )}
      ${setting("开始前停留", "chat-start", control("startHold", input("chat-start", project.startHold, "number", 'min="0" max="10" step="0.1" aria-label="开始前停留秒数"')), "秒")}
      ${setting("结束后停留", "chat-end", control("endHold", input("chat-end", project.endHold, "number", 'min="0" max="10" step="0.1" aria-label="结束后停留秒数"')), "秒")}
      ${setting(
        "最后一句输入完成",
        "chat-after",
        control(
          "afterTyping",
          select(
            "chat-after",
            [
              ["send", "发送为气泡"],
              ["hold", "保留在输入框"],
            ],
            project.afterTyping,
          ),
        ),
        "最后一句为自己时生效",
      )}
      <p class="setting-hint chat-keyboard-note">键盘用于画面演示。中文按文字逐字呈现，不含拼音联想输入。</p>
      <hr class="setting-divider"><h3 class="chat-section-title">画面与文字</h3>
      ${setting(
        "画面背景",
        "chat-background",
        control(
          "backgroundMode",
          select(
            "chat-background",
            [
              ["light", "浅色"],
              ["dark", "深色"],
              ["custom", "自定义颜色"],
            ],
            project.backgroundMode,
          ),
        ),
      )}
      <div id="chat-custom-color">${setting("背景颜色", "chat-bg-color", control("backgroundColor", input("chat-bg-color", project.backgroundColor, "color")))}</div>
      <div class="chat-image-upload"><span>自定义背景图</span><button class="button secondary" data-chat-action="choose-image">${icon("image")}选择图片</button><input id="chat-image" type="file" accept="image/png,image/jpeg,image/webp" hidden></div>
      <div class="chat-image-state"><span id="chat-image-name">未设置背景图</span><button data-chat-action="remove-image" hidden>移除</button></div>
      <p id="chat-background-note" class="chat-alpha-note" hidden>MOV 透明背景已开启：背景颜色和背景图暂不显示，原设置仍会保留。可在「导出文件」中关闭透明背景。</p>
      ${range("气泡字号", "fontSize", "chat-font", 24, 54, "px")}
      <div class="chat-color-grid">${color("对方气泡", "leftBubble")}${color("对方文字", "leftText")}${color("自己气泡", "rightBubble")}${color("自己文字", "rightText")}</div>
      ${check("显示键帽放大提示", "showKeyHint")}
    </section>
    <section id="chat-panel-export" class="chat-tab-panel" role="tabpanel" aria-labelledby="chat-tab-export">
      <h3 class="chat-section-title">视频设置</h3>
      ${setting("输出格式", "chat-format", control("outputFormat", select("chat-format", VIDEO_FORMATS, project.outputFormat)))}
      <div id="chat-alpha-settings" class="chat-alpha-settings" hidden>${check("透明背景 · Alpha 通道", "transparentBackground")}<p class="setting-hint">MOV 使用 ProRes 4444。开启后保留画布透明区域，键盘、气泡和顶部栏自身的底色保持不变。棋盘格仅用于预览，不会写入文件。</p></div>
      ${field("文件名", control("fileName", input("chat-file-name", project.fileName, "text", 'maxlength="100"')), "不含扩展名")}
      ${setting(
        "输出分辨率",
        "chat-resolution",
        select(
          "chat-resolution",
          [
            ["720", "720 × 1280"],
            ["1080", "1080 × 1920"],
          ],
          project.outputWidth,
        ),
      )}
      ${setting(
        "帧率",
        "chat-fps",
        control(
          "fps",
          select(
            "chat-fps",
            [
              [24, "24 fps"],
              [30, "30 fps"],
              [60, "60 fps"],
            ],
            project.fps,
          ),
        ),
      )}
      ${setting(
        "视频码率",
        "chat-bitrate",
        control(
          "videoBitrate",
          select(
            "chat-bitrate",
            [
              [4000000, "4 Mbps · 轻巧"],
              [6000000, "6 Mbps · 标准"],
              [12000000, "12 Mbps · 高质量"],
            ],
            project.videoBitrate,
          ),
        ),
      )}
      <div class="chat-export-summary"><span>预计时长<strong id="chat-export-duration"></strong></span><span>输出编码<strong id="chat-export-codec"></strong></span><p id="chat-export-note"></p></div>
      <button class="button secondary chat-full-button" data-chat-action="snapshot">${icon("image")}保存当前预览帧 PNG</button>
      <hr class="setting-divider"><h3 class="chat-section-title">项目与草稿</h3>
      <p class="setting-hint">参数、台词和背景图会自动保存在当前浏览器。导出项目可在其他设备继续编辑。</p>
      <div class="chat-project-buttons"><button class="button secondary" data-chat-action="save-project">保存项目 JSON</button><button class="button secondary" data-chat-action="choose-project">导入项目 JSON</button></div><input id="chat-project-file" type="file" accept=".json,application/json" hidden>
      <button class="chat-reset" data-chat-action="reset">恢复默认示例</button>
    </section>
    <p id="chat-validation" class="chat-validation" role="alert" hidden></p>`;
  }

  mountTool(
    "chat",
    settingsMarkup(),
    canvasPreview(project.outputWidth, project.outputHeight, "", true),
  );
  const settings = $("#settings");
  const canvas = $("#canvas"),
    ctx = canvas.getContext("2d");
  $(".workspace-heading p").textContent =
    "编排台词，设置输入节奏和键盘画面，预览后导出。";
  const actions = document.createElement("div");
  actions.className = "chat-header-actions";
  actions.innerHTML = `<span id="chat-save-status">草稿已就绪</span><button id="export" class="button primary">${icon("download")}导出动画</button>`;
  $(".workspace-badge").replaceWith(actions);
  $(".panel-heading small", $(".settings-panel")).textContent = "CHAT EDITOR";
  const summary = document.createElement("div");
  summary.id = "chat-project-summary";
  summary.className = "chat-project-summary";
  $(".preview-panel .panel-heading").append(summary);
  $(".preview-panel .panel-heading small").remove();

  function render(time) {
    const config = schedule.config;
    if (
      canvas.width !== config.outputWidth ||
      canvas.height !== config.outputHeight
    ) {
      canvas.width = config.outputWidth;
      canvas.height = config.outputHeight;
    }
    renderChat(ctx, config, getChatFrame(schedule, time), assets);
    const transparent =
      config.outputFormat === "mov" && config.transparentBackground;
    canvas.classList.toggle("chat-transparent-preview", transparent);
    $("#preview-info").textContent =
      `${config.outputWidth} × ${config.outputHeight} · ${config.fps} fps · ${durationText(schedule.duration)}${transparent ? " · 透明背景" : ""}`;
  }

  timeline = createTimeline({
    duration: () => schedule.duration,
    draw: render,
    segments: () => schedule.segments.filter((segment) => segment.length > 0),
  });

  function showTab(next, save = true) {
    tab = next;
    $$("[data-chat-tab]", settings).forEach((button) => {
      const active = button.dataset.chatTab === tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      $(`#chat-panel-${button.dataset.chatTab}`, settings).hidden = !active;
    });
    if (save) queueSave();
  }

  function syncControls() {
    const config = schedule.config;
    const mov = config.outputFormat === "mov";
    const transparent = mov && config.transparentBackground;
    $("#chat-alpha-settings").hidden = !mov;
    $("#chat-background-note").hidden = !transparent;
    $("#chat-bitrate").disabled = mov;
    $$("[data-range-output]", settings).forEach(
      (output) =>
        (output.textContent = `${config[output.dataset.rangeOutput]} ${output.dataset.rangeOutput === "fontSize" ? "px" : "字符 / 秒"}`),
    );
    $("#chat-custom-color").hidden = config.backgroundMode !== "custom";
    $("#chat-layout").value = config.keyboardLayout;
    $('#chat-layout option[value="nine"]').disabled =
      config.keyboardLanguage === "en";
    $(".chat-keyboard-note", settings).textContent =
      config.keyboardLanguage === "en"
        ? "英语模式使用 QWERTY 键盘，按字母、空格和标点逐字输入。"
        : "英文自动使用 QWERTY 键盘。中文按文字逐字呈现，不含拼音联想输入。";
    $("#chat-after").disabled = schedule.messages.at(-1)?.side !== "right";
    $('[data-project-key="showKeyHint"]', settings).disabled =
      config.keyboardLayout === "none";
    $("#chat-image-name").textContent =
      assets.backgroundName || "未设置背景图，可拖入图片";
    $('[data-chat-action="remove-image"]', settings).hidden =
      !assets.backgroundImage;
    $("#chat-message-count").textContent =
      `${project.messages.length} / 20 条台词`;
    $('[data-chat-action="add"]', settings).disabled =
      project.messages.length >= 20;
    $('[data-chat-action="undo-delete"]', settings).hidden = !removed;
    $("#chat-project-summary").textContent =
      `${schedule.messages.length} 条台词 · ${durationText(schedule.duration)}`;
    $("#chat-export-duration").textContent = durationText(schedule.duration);
    $("#chat-export-codec").textContent = mov
      ? "ProRes 4444 · Alpha · 无声"
      : config.outputFormat === "webm"
        ? "VP8 / VP9 · 无声"
        : "H.264 · 无声";
    $("#chat-export-note").textContent = mov
      ? `MOV 采用 ProRes 4444 固定质量，码率随画面内容变化。${transparent ? "画布透明区域保留 Alpha，适合叠加到其他视频。" : "当前保留背景颜色或背景图，关闭透明区域。"} 文件体积较大，请预留存储空间。`
      : config.outputFormat === "webm"
        ? "WebM 按设定时长实时录制，请保持页面在前台。导出始终生成完整片段。"
        : "按设定帧率逐帧生成完整片段。MP4 使用 H.264，适合导入剪辑软件。";
    $("#chat-validation").hidden = !invalid;
    $("#chat-validation").textContent = invalid;
    $("#export").disabled = loading || !!invalid || !schedule.messages.length;
    $('[data-chat-action="save-project"]', settings).disabled =
      loading || !!invalid;
    $('[data-chat-action="snapshot"]', settings).disabled = loading;
  }

  function saveDraft() {
    clearTimeout(saveTimer);
    if (invalid || loading) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          keyboardDefaultsVersion: KEYBOARD_DEFAULTS_VERSION,
          project: normalizeChatProject(project),
          backgroundData: assets.backgroundData,
          backgroundName: assets.backgroundName,
          tab,
        }),
      );
      if (!signal.aborted)
        $("#chat-save-status").textContent = "草稿已自动保存";
    } catch {
      if (!signal.aborted)
        $("#chat-save-status").textContent = "未能自动保存，请导出项目";
    }
  }
  function queueSave() {
    clearTimeout(saveTimer);
    $("#chat-save-status").textContent = loading
      ? "正在读取素材…"
      : invalid
        ? "请先修正参数"
        : "正在保存…";
    saveTimer = setTimeout(saveDraft, 300);
  }
  function refresh() {
    try {
      schedule = buildChatSchedule(project);
      invalid = "";
      timeline.refresh();
    } catch (error) {
      invalid = `${error.message} 预览保留上一个有效版本。`;
    }
    syncControls();
    queueSave();
  }
  function renderSettings() {
    settings.innerHTML = settingsMarkup();
    showTab(tab, false);
    refresh();
  }
  function renderMessages() {
    $("#chat-messages").innerHTML = messageMarkup();
    refresh();
  }

  function beginLoad() {
    const revision = ++loadRevision;
    loading = true;
    syncControls();
    queueSave();
    return revision;
  }
  function finishLoad(revision) {
    if (signal.aborted || revision !== loadRevision) return;
    loading = false;
    syncControls();
    queueSave();
  }

  async function setBackground(file) {
    if (!file) return;
    if (!file?.type.match(/^image\/(png|jpeg|webp)$/))
      throw new Error("请选择 PNG、JPG 或 WebP 图片。");
    if (file.size > 60 * 1024 * 1024) throw new Error("背景图请小于 60 MB。");
    const revision = beginLoad();
    try {
      const image = await loadImage(file);
      if (signal.aborted || revision !== loadRevision) return;
      const scale = Math.min(
        1,
        1600 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const resized = document.createElement("canvas");
      resized.width = Math.max(1, Math.round(image.naturalWidth * scale));
      resized.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = resized.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, resized.width, resized.height);
      context.drawImage(image, 0, 0, resized.width, resized.height);
      const data = resized.toDataURL("image/jpeg", 0.85);
      if (data.length > 3500000)
        throw new Error("背景图压缩后仍过大，请选择更小的图片。");
      const savedImage = await loadImage(data);
      if (signal.aborted || revision !== loadRevision) return;
      assets = {
        backgroundImage: savedImage,
        backgroundData: data,
        backgroundName: file.name,
      };
      refresh();
    } finally {
      finishLoad(revision);
    }
  }

  async function importProject(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024)
      throw new Error("项目文件过大，请选择小于 5 MB 的 JSON 文件。");
    const revision = beginLoad();
    try {
      const raw = JSON.parse(await file.text());
      if (signal.aborted || revision !== loadRevision) return;
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("项目内容无效，请选择 Frame 导出的项目 JSON。");
      if (raw.type && raw.type !== "frame-chat-project")
        throw new Error("这不是 Frame 对话动画项目文件。");
      if (raw.type && raw.version !== 1)
        throw new Error("暂不支持此项目版本，请使用版本 1 的项目文件。");
      if (!Array.isArray((raw.project || raw).messages))
        throw new Error("项目中缺少台词列表，请选择 Frame 导出的项目 JSON。");
      const next = normalizeChatProject(raw.project || raw);
      const nextAssets = {
        backgroundImage: null,
        backgroundData: "",
        backgroundName: "",
      };
      if (raw.backgroundData) {
        if (
          typeof raw.backgroundData !== "string" ||
          raw.backgroundData.length > 3500000 ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
            raw.backgroundData,
          )
        )
          throw new Error("项目中的背景图片格式无效。");
        nextAssets.backgroundImage = await loadImage(raw.backgroundData);
        nextAssets.backgroundData = raw.backgroundData;
        nextAssets.backgroundName =
          typeof raw.backgroundName === "string"
            ? raw.backgroundName.slice(0, 150)
            : "项目背景图";
      }
      if (signal.aborted || revision !== loadRevision) return;
      project = next;
      assets = nextAssets;
      removed = null;
      renderSettings();
      timeline.seek(0);
      toast("项目已导入，可继续编辑。");
    } finally {
      finishLoad(revision);
    }
  }

  const pasteDialog = document.createElement("dialog");
  pasteDialog.className = "help-dialog chat-paste-dialog";
  pasteDialog.innerHTML = `<h2>批量粘贴台词</h2><p>每行一条，用「左:」或「右:」标记方向。最多 20 条，每条最多 300 字。应用后将替换当前台词。</p><textarea id="chat-paste-content" rows="9" placeholder="左: 你现在有空吗？&#10;右: 有呀，怎么了？" aria-label="批量台词"></textarea><p id="chat-paste-error" class="chat-validation" hidden></p><div class="chat-dialog-actions"><button class="button secondary" data-paste="cancel">取消</button><button class="button primary" data-paste="apply">应用台词</button></div>`;
  document.body.append(pasteDialog);
  on(pasteDialog, "click", (event) => {
    const action = event.target.closest("[data-paste]")?.dataset.paste;
    if (action === "cancel") pasteDialog.close();
    if (action !== "apply") return;
    try {
      const lines = $("#chat-paste-content")
        .value.split(/\r?\n/)
        .filter((line) => line.trim());
      if (!lines.length) throw new Error("请先粘贴至少一条台词。");
      const messages = lines.map((line, index) => {
        const match = line.match(/^\s*(左|右|A|B)\s*[:：]\s*(.*)/i);
        return {
          id: newId(),
          side: match
            ? /^(右|B)$/i.test(match[1])
              ? "right"
              : "left"
            : index % 2
              ? "right"
              : "left",
          text: match ? match[2] : line,
          hold: 1.2,
        };
      });
      project = normalizeChatProject({ ...project, messages });
      removed = null;
      renderMessages();
      timeline.seek(0);
      pasteDialog.close();
      toast(`已导入 ${messages.length} 条台词。`);
    } catch (error) {
      $("#chat-paste-error").hidden = false;
      $("#chat-paste-error").textContent = error.message;
    }
  });

  on(settings, "input", (event) => {
    const element = event.target;
    if (element.type === "file") return;
    if (element.dataset.projectKey) {
      const key = element.dataset.projectKey;
      project[key] =
        element.type === "checkbox"
          ? element.checked
          : ["range", "number"].includes(element.type) ||
              ["fps", "videoBitrate"].includes(key)
            ? Number(element.value)
            : element.value;
      if (
        key === "keyboardLanguage" &&
        project[key] === "en" &&
        project.keyboardLayout === "nine"
      )
        project.keyboardLayout = "qwerty";
      refresh();
    } else if (element.dataset.messageKey) {
      const message = project.messages.find(
        (item) =>
          item.id === element.closest("[data-message-id]").dataset.messageId,
      );
      if (!message) return;
      message[element.dataset.messageKey] =
        element.dataset.messageKey === "hold"
          ? Number(element.value)
          : element.value;
      const count = $(".message-count", element.closest(".message-card"));
      count.textContent = `${Array.from(message.text).length}/300`;
      count.classList.toggle("invalid", Array.from(message.text).length > 300);
      refresh();
    } else if (element.id === "chat-resolution") {
      project.outputWidth = Number(element.value);
      project.outputHeight = project.outputWidth === 1080 ? 1920 : 1280;
      refresh();
    }
  });
  on(settings, "change", async (event) => {
    const element = event.target;
    // Normalize numeric fields after editing, so their displayed values match the renderer.
    if (element.type === "number" && !invalid) {
      if (element.dataset.projectKey) {
        const key = element.dataset.projectKey;
        project[key] = schedule.config[key];
        element.value = project[key];
      } else if (element.dataset.messageKey === "hold") {
        const id = element.closest("[data-message-id]").dataset.messageId;
        const message = project.messages.find((item) => item.id === id);
        message.hold = schedule.config.messages.find(
          (item) => item.id === id,
        ).hold;
        element.value = message.hold;
      }
      refresh();
    }
    try {
      if (event.target.id === "chat-image")
        await setBackground(event.target.files[0]);
      if (event.target.id === "chat-project-file")
        await importProject(event.target.files[0]);
    } catch (error) {
      if (!signal.aborted) errorToast(error);
    }
    if (event.target.type === "file") event.target.value = "";
  });
  on(settings, "keydown", (event) => {
    const button = event.target.closest("[data-chat-tab]");
    if (
      !button ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    const names = ["script", "screen", "export"];
    const index = names.indexOf(tab);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 2
          : (index + (event.key === "ArrowRight" ? 1 : -1) + 3) % 3;
    showTab(names[next]);
    $(`[data-chat-tab="${tab}"]`, settings).focus();
  });
  on(settings, "dragover", (event) => {
    if (event.target.closest(".chat-image-upload")) {
      event.preventDefault();
      event.target.closest(".chat-image-upload").classList.add("dragover");
    }
  });
  on(settings, "dragleave", (event) =>
    event.target.closest(".chat-image-upload")?.classList.remove("dragover"),
  );
  on(settings, "drop", async (event) => {
    const box = event.target.closest(".chat-image-upload");
    if (!box) return;
    event.preventDefault();
    box.classList.remove("dragover");
    try {
      await setBackground(event.dataTransfer.files[0]);
    } catch (error) {
      if (!signal.aborted) errorToast(error);
    }
  });
  on(settings, "click", async (event) => {
    const tabButton = event.target.closest("[data-chat-tab]");
    if (tabButton) {
      showTab(tabButton.dataset.chatTab);
      return;
    }
    const button = event.target.closest("[data-chat-action]");
    if (!button) return;
    const action = button.dataset.chatAction;
    const card = button.closest("[data-message-id]");
    const index = card
      ? project.messages.findIndex(
          (message) => message.id === card.dataset.messageId,
        )
      : -1;
    try {
      if (action === "add") {
        if (project.messages.length >= 20) return;
        project.messages.push({
          id: newId(),
          side: project.messages.at(-1)?.side === "left" ? "right" : "left",
          text: "",
          hold: 1.2,
        });
        renderMessages();
        $("#chat-messages")
          .lastElementChild?.querySelector("textarea")
          ?.focus();
      }
      if (action === "delete" && index >= 0) {
        removed = { message: project.messages[index], index };
        project.messages.splice(index, 1);
        renderMessages();
      }
      if (action === "undo-delete" && removed && project.messages.length < 20) {
        project.messages.splice(
          Math.min(removed.index, project.messages.length),
          0,
          removed.message,
        );
        removed = null;
        renderMessages();
      }
      if (["up", "down"].includes(action) && index >= 0) {
        const destination = index + (action === "up" ? -1 : 1);
        if (destination < 0 || destination >= project.messages.length) return;
        [project.messages[index], project.messages[destination]] = [
          project.messages[destination],
          project.messages[index],
        ];
        renderMessages();
      }
      if (action === "locate" && index >= 0) {
        const message = schedule.messages.find(
          (item) => item.id === project.messages[index].id,
        );
        if (message)
          timeline.seek(
            message.start + (message.typingEnd - message.start) * 0.65,
          );
        else toast("先给这条消息写一点内容吧。");
      }
      if (action === "paste") {
        $("#chat-paste-content").value = project.messages
          .map(
            (message) =>
              `${message.side === "left" ? "左" : "右"}: ${message.text}`,
          )
          .join("\n");
        $("#chat-paste-error").hidden = true;
        pasteDialog.showModal();
      }
      if (action === "choose-image") $("#chat-image").click();
      if (action === "remove-image") {
        loadRevision++;
        loading = false;
        assets = {
          backgroundImage: null,
          backgroundData: "",
          backgroundName: "",
        };
        refresh();
      }
      if (action === "choose-project") $("#chat-project-file").click();
      if (action === "save-project") {
        if (invalid) throw new Error("请先修正台词或参数，再保存项目。");
        const data = {
          type: "frame-chat-project",
          version: 1,
          project: normalizeChatProject(project),
          backgroundData: assets.backgroundData,
          backgroundName: assets.backgroundName,
        };
        download(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
          `${schedule.config.fileName}.json`,
        );
        toast("项目已保存，包含台词、参数和背景图。");
      }
      if (action === "snapshot") {
        timeline.pause();
        download(
          await canvasBlob(canvas),
          `${schedule.config.fileName}_${durationText(timeline.getCurrentTime()).replace(/[:.]/g, "-")}.png`,
        );
        toast("当前预览帧已保存。");
      }
      if (
        action === "reset" &&
        confirm(
          "恢复默认示例会替换当前草稿。需要保留时，请先保存项目 JSON。继续恢复吗？",
        )
      ) {
        loadRevision++;
        loading = false;
        project = normalizeChatProject(CHAT_DEFAULTS);
        assets = {
          backgroundImage: null,
          backgroundData: "",
          backgroundName: "",
        };
        removed = null;
        renderSettings();
        timeline.seek(0);
      }
    } catch (error) {
      if (!signal.aborted) errorToast(error);
    }
  });

  on($("#export"), "click", () => {
    if (loading || invalid || !schedule.messages.length) {
      toast("先填写有效台词，再导出动画。");
      return;
    }
    if (schedule.config.outputFormat === "webm" && schedule.duration < 0.5) {
      toast("片段过短，请增加停留时间，使总时长至少为 0.5 秒。");
      return;
    }
    timeline.pause();
    const exported = schedule;
    const exportAssets = { ...assets };
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = exported.config.outputWidth;
    exportCanvas.height = exported.config.outputHeight;
    const exportContext = exportCanvas.getContext("2d");
    runOperation("正在生成对话动画", async (exportSignal, update) => {
      try {
        const blob = await exportCanvasVideo(
          exportCanvas,
          (time) =>
            renderChat(
              exportContext,
              exported.config,
              getChatFrame(exported, time),
              exportAssets,
            ),
          {
            format: exported.config.outputFormat,
            duration: exported.duration,
            fps: exported.config.fps,
            videoBitsPerSecond: exported.config.videoBitrate,
            signal: exportSignal,
            onProgress: (progress, stage) =>
              update(
                progress,
                `${stage || "正在生成"} · ${Math.round(progress * 100)}%`,
              ),
          },
        );
        download(
          blob,
          videoFilename(exported.config.fileName, exported.config.outputFormat),
        );
      } finally {
        timeline.render();
      }
    });
  });

  showTab(tab, false);
  syncControls();
  if (
    stored?.backgroundData &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
      stored.backgroundData,
    ) &&
    stored.backgroundData.length <= 3500000
  ) {
    const revision = beginLoad();
    loadImage(stored.backgroundData)
      .then((image) => {
        if (signal.aborted || revision !== loadRevision) return;
        assets = {
          backgroundImage: image,
          backgroundData: stored.backgroundData,
          backgroundName: String(stored.backgroundName || "草稿背景图"),
        };
        refresh();
      })
      .catch(() => {
        if (!signal.aborted) toast("草稿背景图无法读取，请重新选择。");
      })
      .finally(() => finishLoad(revision));
  }
  addCleanup(() => {
    saveDraft();
    clearTimeout(saveTimer);
    loadRevision++;
    pasteDialog.remove();
  });
}
