import {
  SMART_FIELDS,
  SMART_DEFAULTS,
  normalizeSmartSettings,
  normalizeSmartOptions,
  upgradeSmartOptions,
  defaultSmartFields,
  formatSmartNamingDuration,
  applySmartFields,
  applySmartAnalysis,
  previewSmartUniformFields,
  buildSmartNames,
  smartCsv,
} from "./smart-model.js";
import { inspectSmartMedia, extractSmartFrames } from "./smart-media.js";
import { optimizeSmartMedia, smartMediaChecks, smartVideoTarget } from "./smart-optimize.js";
import { DEFAULT_BASE_URL, normalizeSmartApiConfig, analyzeSmartFrames } from "./smart-ai.js";
import { download, zipFiles } from "./media.js";

const SETTINGS_KEY = "frame-smart-settings-v1";
const OPTIONS_KEY = "frame-smart-options-v1";
const OPTIONS_REVISION_KEY = "frame-smart-options-revision";
const OPTIONS_REVISION = 3;
const CONFIG_KEY = "frame-smart-api-v1";
const DEFAULT_MODEL = "doubao-seed-2.1-turbo";
const PREVIOUS_PLAN_MODEL = "doubao-seed-2.1-lite";
const LEGACY_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const SECRET_KEY = "frame-smart-key-v1";
const SEQUENCE_KEY = "frame-smart-sequence-v1";
const UNIFORM_KEY = "frame-smart-uniform-v1";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const readStored = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const localDate = () => {
  const now = new Date();
  return `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
};
const sequenceMap = () => {
  const saved = readStored(SEQUENCE_KEY, {});
  return saved && typeof saved === "object" && !Array.isArray(saved)
    ? saved
    : {};
};
const nextSequence = (date) =>
  Math.min(999999, Math.max(1, Number(sequenceMap()[date]) || 1));
const initialSettings = () => {
  const stored = readStored(SETTINGS_KEY, {});
  if (readStored(OPTIONS_REVISION_KEY, 0) < OPTIONS_REVISION && stored.shorthand === "QS") {
    stored.shorthand = SMART_DEFAULTS.shorthand;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
    } catch {}
  }
  let saved;
  try {
    saved = normalizeSmartSettings({
      ...SMART_DEFAULTS,
      ...stored,
      date: localDate(),
    });
  } catch {
    saved = normalizeSmartSettings({ ...SMART_DEFAULTS, date: localDate() });
  }
  return normalizeSmartSettings({ ...saved, start: nextSequence(saved.date) });
};
const initialOptions = () => {
  const saved = readStored(OPTIONS_KEY, {});
  const revision = readStored(OPTIONS_REVISION_KEY, 0);
  if (revision >= OPTIONS_REVISION) return normalizeSmartOptions(saved);
  const upgraded = upgradeSmartOptions(saved, revision);
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(upgraded));
    localStorage.setItem(OPTIONS_REVISION_KEY, String(OPTIONS_REVISION));
  } catch {}
  return upgraded;
};
const savedConfig = readStored(CONFIG_KEY, {});
const savedModel = String(savedConfig.model ?? "").trim();
const savedBaseURL = String(savedConfig.baseURL ?? "").trim();
const baseURL = savedBaseURL.replace(/\/+$/, "");
const usePlanDefaults = !baseURL || baseURL === LEGACY_BASE_URL;

// Media and non-remembered credentials live only in this browser tab.
const session = {
  assets: [],
  settings: initialSettings(),
  options: initialOptions(),
  config: normalizeSmartApiConfig({
    ...savedConfig,
    baseURL: usePlanDefaults ? DEFAULT_BASE_URL : savedBaseURL,
    model:
      !savedModel ||
      ((usePlanDefaults || baseURL === DEFAULT_BASE_URL) && savedModel === PREVIOUS_PLAN_MODEL)
        ? DEFAULT_MODEL
        : savedModel,
  }),
  apiKey: String(readStored(SECRET_KEY, "") || ""),
  rememberKey: Boolean(readStored(SECRET_KEY, "")),
  summary: "",
};
const statusLabels = {
  idle: "待分析",
  analyzing: "分析中",
  ready: "已分析",
  failed: "分析失败",
  canceled: "已取消",
};
const byteLabel = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
const durationLabel = (duration) =>
  Number.isFinite(duration) && duration > 0
    ? `${Number(duration.toFixed(2))} 秒`
    : "图片";

export function setupSmartEditor(api) {
  const {
    mountTool,
    upload,
    field,
    input,
    select,
    icon,
    on,
    signal,
    addCleanup,
    toast,
    errorToast,
    runOperation,
    registerUndo,
    recordEdit,
    escapeHTML: escape,
  } = api;
  let loading = false;
  const analysisPrevious = new Map();
  let exporting = false;
  let analysisController = null;
  let analysisId = null;
  let sequenceEdited = false;
  let names = [];
  let nameError = "";
  let settingsError = "";
  let previewURL = null;
  let optionTarget = null;
  const savedUniform = readStored(UNIFORM_KEY, {});
  const uniformValues = Object.fromEntries(
    SMART_FIELDS.map(({ id }) => [
      id,
      typeof savedUniform?.values?.[id] === "string"
        ? savedUniform.values[id].slice(0, 120)
        : "",
    ]),
  );
  const uniformEnabled = new Set(
    Array.isArray(savedUniform?.enabled)
      ? savedUniform.enabled.filter((id) =>
          SMART_FIELDS.some((field) => field.id === id),
        )
      : [],
  );
  const selectedAssets = () => session.assets.filter((asset) => asset.selected);
  const getAsset = (id) => session.assets.find((asset) => asset.id === id);
  const setAsset = (id, value) => {
    const index = session.assets.findIndex((asset) => asset.id === id);
    if (index >= 0) session.assets[index] = value;
  };
  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      toast("浏览器存储不可用，本次修改仍会保留到关闭页面。");
      return false;
    }
  };
  const clearSecret = () => {
    analysisController?.abort();
    session.apiKey = "";
    session.rememberKey = false;
    try {
      localStorage.removeItem(SECRET_KEY);
    } catch {}
    $("#smart-api-key").value = "";
    $("#smart-remember-key").checked = false;
    syncControls();
    toast("API Key 已清除。");
  };
  const newTagButton = (descriptor) =>
    `<button type="button" class="smart-new-tag" data-smart-action="new-tag" data-smart-field-key="${descriptor.id}" aria-label="新建${escape(descriptor.label)}标签" aria-haspopup="dialog" aria-controls="smart-options-dialog">+ 新建</button>`;
  const fieldCaption = (descriptor) =>
    `<span class="smart-field-caption" title="${escape(descriptor.hint || "")}">${escape(descriptor.label)}${descriptor.optional ? "<small>选填</small>" : ""}</span>`;
  const sectionHeading = (number, title) =>
    `<div class="smart-section-heading"><h3><span>${number}</span>${title}</h3></div>`;
  const settingInput = (key, label, attrs = "", type = "text") =>
    field(
      label,
      input(
        `smart-setting-${key}`,
        session.settings[key],
        type,
        `data-smart-setting="${key}" ${attrs}`,
      ),
    );
  const uniformMarkup = () =>
    SMART_FIELDS.map(
      (descriptor) =>
        `<div class="smart-uniform-field"><div class="smart-field-heading"><label><input type="checkbox" data-smart-uniform-enable="${descriptor.id}" ${uniformEnabled.has(descriptor.id) ? "checked" : ""} aria-label="统一${escape(descriptor.label)}">${fieldCaption(descriptor)}</label>${newTagButton(descriptor)}</div>${fieldControl(descriptor, uniformValues[descriptor.id], "uniform", `统一${descriptor.label}的值`, "不统一")}</div>`,
    ).join("");

  mountTool(
    "smart",
    `<div class="smart-settings">
      <section>${sectionHeading("01", "添加素材")}${upload("smart-files", "选择视频或图片", "拖入文件，支持多选 · 每批最多 100 个素材", "video/*,image/*,.mp4,.mov,.webm,.jpg,.jpeg,.png,.webp,.gif", true, true)}<p id="smart-import-status" class="smart-note" role="status"></p><p class="smart-note">原文件保留在本地。视频按时间均匀提取 8 张画面，图片使用 1 张画面。</p></section>
      <section>${sectionHeading("02", "AI 连接")}
        ${field("API Key", input("smart-api-key", session.apiKey, "password", 'autocomplete="off" spellcheck="false" placeholder="填写你的 API Key"'))}
        <div class="smart-key-actions"><label class="smart-check"><input id="smart-remember-key" type="checkbox" ${session.rememberKey ? "checked" : ""}><span>在此浏览器记住 Key</span></label><button type="button" data-smart-action="clear-key">清除 Key</button></div>
        ${field("识别模型 / 接入点 ID", input("smart-model", session.config.model, "text", 'autocomplete="off" placeholder="填写控制台已启用的模型或 ep-接入点 ID"'))}
        ${field("Base URL", input("smart-base-url", session.config.baseURL, "url", `spellcheck="false" placeholder="${DEFAULT_BASE_URL}"`))}
        <p class="smart-note">支持火山方舟及兼容 Chat Completions 的视觉模型。请填写当前账号已启用的模型。未配置 API 也可手动命名。</p>
        <label class="smart-consent"><input id="smart-consent" type="checkbox"><span>允许将所选素材的抽帧图片发送到上方 API 进行分析<small>火山接口可经本应用服务转发，Key 仅用于调用；原文件和音频不上传。AI 调用使用你的账号额度，结果可手动修正。</small></span></label>
        <button type="button" id="smart-analyze" class="button primary smart-full" data-smart-action="analyze">${icon("search")}分析所选素材</button>
        <button type="button" id="smart-cancel" class="button secondary smart-full" data-smart-action="cancel" hidden>停止分析</button>
        <div id="smart-analysis-progress" class="smart-progress" role="status" hidden><div class="smart-progress-track"><span></span></div><p></p></div>
      </section>
      <section>${sectionHeading("03", "命名规则")}
        <div class="smart-field-pair">${settingInput("date", "日期 / YYMMDD", 'maxlength="10" inputmode="numeric"')}${settingInput("shorthand", "剪辑人 / 缩写", 'maxlength="32" placeholder="如 ZYY，代理填写公司名" title="制作人名字首字母；代理制作填写公司名称，与创意人字段分开。"')}</div>
        <div class="smart-field-pair">${settingInput("start", "起始序号", 'min="0" max="999999" step="1"', "number")}${settingInput("padding", "序号位数", 'min="1" max="8" step="1"', "number")}</div>
        <p id="smart-sequence-note" class="smart-note"></p>
        ${field(
          "字段分隔符",
          select(
            "smart-separator",
            [
              ["_", "下划线 _"],
              ["-", "短横线 -"],
              [" ", "空格"],
            ],
            session.settings.separator,
          ),
        )}
        <label class="field"><span>命名模板</span><textarea id="smart-template" rows="4" spellcheck="false" maxlength="1200">${escape(session.settings.template)}</textarea></label>
        <details class="smart-template-help"><summary>可用命名字段</summary><div class="smart-token-list">${[...SMART_FIELDS.map((descriptor) => [descriptor.id, descriptor.label]), ["date", "日期"], ["shorthand", "缩写"], ["sequence", "序号"], ["ratio", "比例"], ["duration", "时长"], ["resolution", "分辨率"], ["original", "原名"]].map(([id, label]) => `<button type="button" data-smart-action="insert-token" data-smart-token="${id}" title="插入 {${id}}">${escape(label)} <code>{${id}}</code></button>`).join("")}</div><p>空字段会自动省略，原扩展名保留。非法字符会清理，重复文件名会自动加序号。</p></details>
        <button type="button" class="smart-text-button" data-smart-action="reset-template">恢复默认模板</button>
      </section>
      <p class="smart-note smart-session-note">文件和分析结果仅保留在当前标签页，切换工具不会丢失；刷新后需重新导入。建议及时导出命名清单。</p>
    </div>`,
    `<div class="smart-output">
      <section class="smart-uniform-section"><div class="smart-section-heading"><h3>统一修改</h3><button type="button" class="smart-text-button" data-smart-action="options">管理字段选项</button></div><p class="smart-note">勾选并填写字段后，待分析素材会自动预填。分析结果优先，逐条手动修改的字段会保留。要批量更改已分析的素材，可点「应用统一修改」。</p><div class="smart-uniform-grid">${uniformMarkup()}</div><div class="smart-uniform-actions"><select id="smart-uniform-scope" aria-label="统一修改范围"><option value="selected">应用到所选素材</option><option value="all">应用到全部素材</option></select><button type="button" class="button secondary" data-smart-action="apply-uniform">应用统一修改</button><button type="button" class="smart-text-button" data-smart-action="clear-uniform">清空统一设置</button></div></section>
      <div class="smart-list-toolbar"><label class="smart-check"><input id="smart-select-all" type="checkbox"><span id="smart-selection-count">已选 0 / 0</span></label><div><button type="button" data-smart-action="unlock-selected">解除所选字段保护</button><button type="button" data-smart-action="remove-selected">移除所选</button></div></div>
      <p id="smart-summary" class="smart-summary" role="status" hidden></p><p id="smart-name-error" class="smart-error" role="alert" hidden></p>
      <div id="smart-assets" class="smart-assets"></div>
      <div class="smart-export-bar"><div><strong id="smart-export-count">等待添加素材</strong><p>下载重命名副本，保留原画质与文件格式。</p></div><div><button type="button" id="smart-export-csv" class="button secondary" data-smart-action="csv">${icon("file")}命名清单 CSV</button><button type="button" id="smart-export-zip" class="button primary" data-smart-action="zip">${icon("download")}下载所选 ZIP</button></div></div>
    </div>
    <dialog id="smart-options-dialog" class="smart-dialog" aria-labelledby="smart-options-title"><form method="dialog" class="smart-dialog-heading"><h3 id="smart-options-title">管理字段选项</h3><button type="submit" class="smart-icon-button" aria-label="关闭字段选项">${icon("close")}</button></form><p class="smart-note">标签代码用于文件名，含义用于说明与 AI 判断。保存到当前浏览器，刷新后仍可使用；相同代码更新含义，不重复添加。</p><label class="field"><span>选择字段</span><select id="smart-options-field">${SMART_FIELDS.map((descriptor) => `<option value="${descriptor.id}">${escape(descriptor.label)}</option>`).join("")}</select></label><form id="smart-option-form" class="smart-option-add"><label><span>标签代码</span><input id="smart-option-value" type="text" placeholder="输入自定义代码" aria-label="新增选项代码" maxlength="64" autocomplete="off"></label><label><span>含义（可选）</span><input id="smart-option-label" type="text" placeholder="标签的说明" aria-label="新增选项含义" maxlength="80" autocomplete="off"></label><button type="submit" id="smart-option-save" class="button secondary" data-smart-action="add-option">保存标签</button></form><div id="smart-options-list"></div><button type="button" class="smart-text-button" data-smart-action="reset-options">恢复此字段默认选项</button></dialog>
    <dialog id="smart-preview-dialog" class="smart-dialog smart-media-dialog"><form method="dialog" class="smart-dialog-heading"><h3 id="smart-preview-title">素材预览</h3><button type="submit" class="smart-icon-button" aria-label="关闭素材预览">${icon("close")}</button></form><div id="smart-media-preview"></div></dialog>
    <dialog id="smart-optimize-dialog" class="smart-dialog" aria-labelledby="smart-optimize-title">
      <h3 id="smart-optimize-title">本地处理素材</h3>
      <p class="smart-note">使用本地 FFmpeg 处理副本，原文件会保留。竖屏处理为 1080 × 1920，横屏处理为 1920 × 1080。等比缩放铺满画面，比例不同时居中裁切。处理后的视频为 MP4。</p>
      <ul id="smart-optimize-list"></ul>
      <form id="smart-optimize-choice" method="dialog" class="smart-optimize-actions">
        <button class="button secondary" value="keep" autofocus>保留原件</button>
        <button class="button primary" value="process">本地处理</button>
      </form>
      <form id="smart-optimize-running" method="dialog" hidden>
        <p id="smart-optimize-status" class="smart-note" role="status"></p>
        <progress id="smart-optimize-progress" max="1" value="0" aria-label="素材处理进度"></progress>
        <button class="button secondary" value="cancel">取消处理</button>
      </form>
    </dialog>
    <dialog id="smart-help-dialog" class="smart-dialog smart-help-dialog" aria-labelledby="smart-help-title"><form method="dialog" class="smart-dialog-heading"><h3 id="smart-help-title">命名说明</h3><button type="submit" class="smart-icon-button" aria-label="关闭命名说明">${icon("close")}</button></form><div id="smart-help-content" class="smart-help-content"></div></dialog>`,
  );

  const root = $("#workspace");
  $("#smart-options-field").parentElement.insertAdjacentHTML(
    "afterend",
    '<p id="smart-options-hint" class="smart-note"></p>',
  );
  const title = $(".workspace-heading h1", root);
  title.parentElement.classList.add("smart-title-group");
  title.insertAdjacentHTML(
    "afterend",
    `<button type="button" id="smart-help-button" class="smart-help-button" data-smart-action="help" aria-haspopup="dialog" aria-controls="smart-help-dialog">${icon("help")}命名说明</button>`,
  );

  function openNamingHelp() {
    const labels = {
      ...Object.fromEntries(SMART_FIELDS.map(({ id, label }) => [id, label])),
      date: "日期",
      shorthand: "剪辑人",
      sequence: "序号",
      ratio: "比例",
      duration: "时长",
      resolution: "分辨率",
      width: "宽度",
      height: "高度",
      original: "原名",
      extension: "扩展名",
      separator: session.settings.separator,
    };
    const structure = session.settings.template
      .replaceAll("_", session.settings.separator)
      .replace(/\{([^{}]+)\}/g, (_, key) => labels[key] || `{${key}}`);
    $("#smart-help-content").innerHTML = `
      <section><h4>序号与命名规则</h4><p>序号按日期自动续排：下载素材后记录进度，新日期默认从 01 开始，也可手动修改起始序号。导出 CSV 不推进序号。</p><div class="smart-help-structure"><strong>当前命名结构</strong><p>${escape(structure)}</p></div><p>空字段会自动省略，保留原扩展名；重复名称自动加编号。女性向分类、竞品名和自定义文字均可留空。</p></section>
      <section><h4>填写时留意</h4><ul><li>日期使用 YYMMDD，例如 250218 表示 2025 年 2 月 18 日。剪辑人填写制作人名字首字母；代理制作填写公司名，与创意人字段分开。</li><li>语言 / 国家按团队命名规范选择：US 表示英语，MN 表示闽南语。这些是业务标签，不全部等同国家代码；画面语言是单独的识别结果。</li><li>代码与大小写按选项保留。代码后无需再加下划线，模板会添加分隔符；电话使用 call，角色类别的「其他」使用 OTH。</li><li>「精致度」记录原创、迭代、换语言或参考竞品等制作方式，不表示分辨率。风险分类和合作关系请结合实际来源人工确认。</li><li>比例与分辨率分开：4-5（800×1000）、9-16（1080×1920）、1-1（1000×1000）、16-9（1920×1080）、1-2（960×1920）是规范示例，并非强制尺寸；实际信息在本地读取，默认命名时长取整秒并加 s。</li></ul></section>
      <section><h4>字段缩写</h4><p>以下与当前字段选项同步，可通过「管理字段选项」调整代码和含义。自定义标签与说明会保留。</p><dl class="smart-help-fields">${SMART_FIELDS.map(({ id, label, hint, optional }) => `<div><dt>${escape(label)}${optional ? "（选填）" : ""}</dt><dd>${session.options[id].length ? session.options[id].map(({ value, label: meaning }) => `<span><code>${escape(value)}</code>${meaning !== value ? `（${escape(meaning)}）` : ""}</span>`).join(" / ") : "手动输入"}${hint ? `<small>${escape(hint)}</small>` : ""}</dd></div>`).join("")}</dl></section>
      <section><h4>修改与素材规格</h4><ul><li>单独修改的字段自动保护，不被统一修改或 AI 覆盖；解除保护后可再次更新。</li><li>语言提示：多种画面语言或不确定情况会在素材的分析说明中提示，请逐条核对。</li><li>视频分辨率不是 1080 × 1920（竖屏）或 1920 × 1080（横屏），或文件超过 32 MB 时，可选择用本地 FFmpeg 处理副本。</li></ul></section>`;
    const dialog = $("#smart-help-dialog");
    $("#smart-help-content").scrollTop = 0;
    dialog.showModal();
  }

  const progress = (value, text) => {
    if (signal.aborted) return;
    $("#smart-analysis-progress").hidden = false;
    $("#smart-analysis-progress span").style.width =
      `${Math.max(0, Math.min(1, value)) * 100}%`;
    $("#smart-analysis-progress p").textContent = text;
  };
  const persistSettings = () => save(SETTINGS_KEY, session.settings);
  const persistUniform = () =>
    save(UNIFORM_KEY, { values: uniformValues, enabled: [...uniformEnabled] });
  const persistConfig = () => {
    session.config = {
      baseURL: $("#smart-base-url").value.trim(),
      model: $("#smart-model").value.trim(),
    };
    save(CONFIG_KEY, {
      baseURL: session.config.baseURL,
      model: session.config.model,
    });
  };

  function syncControls() {
    if (signal.aborted) return;
    const selected = selectedAssets();
    const analyzing = Boolean(analysisController);
    for (const id of ["smart-api-key", "smart-model", "smart-base-url"])
      document.getElementById(id).disabled = analyzing;
    $("#smart-analyze").disabled =
      analyzing ||
      loading ||
      !selected.length ||
      !$("#smart-consent").checked ||
      !session.apiKey.trim() ||
      !$("#smart-model").value.trim() ||
      !$("#smart-base-url").value.trim();
    $("#smart-analyze").textContent = analyzing
      ? "正在分析素材…"
      : `分析所选素材${selected.length ? `（${selected.length}）` : ""}`;
    $("#smart-cancel").hidden = !analyzing;
    $("#smart-files").disabled = loading || exporting;
    $("#smart-export-zip").disabled =
      !selected.length ||
      loading ||
      analyzing ||
      exporting ||
      Boolean(nameError);
    $("#smart-export-csv").disabled =
      !session.assets.length ||
      loading ||
      analyzing ||
      exporting ||
      Boolean(nameError);
    $("#smart-selection-count").textContent =
      `已选 ${selected.length} / ${session.assets.length}`;
    $("#smart-select-all").checked =
      session.assets.length > 0 && selected.length === session.assets.length;
    $("#smart-select-all").indeterminate =
      selected.length > 0 && selected.length < session.assets.length;
    $("#smart-export-count").textContent = selected.length
      ? `将下载 ${selected.length} 个素材副本`
      : "选择需要下载的素材";
    $("#smart-sequence-note").textContent =
      `此日期已记录的下次起始序号：${nextSequence(session.settings.date)}。可手动修改；仅下载素材后续排。`;
    $$("[data-smart-action='analyze-one']", root).forEach((button) => {
      button.disabled =
        analyzing ||
        loading ||
        !$("#smart-consent").checked ||
        !session.apiKey.trim() ||
        !$("#smart-model").value.trim();
    });
    $$("[data-smart-action='download-one']", root).forEach((button) => {
      button.disabled = analyzing || exporting || Boolean(nameError);
    });
    $$("[data-smart-action='remove-asset']", root).forEach((button) => {
      button.disabled = analyzing || exporting;
    });
    $("[data-smart-action='remove-selected']", root).disabled =
      analyzing || exporting || loading || !selected.length;
    $("[data-smart-action='unlock-selected']", root).disabled =
      !selected.length;
  }

  function fieldOptions(key, value, emptyLabel) {
    const options = session.options[key];
    const current = value && !options.some((option) => option.value === value)
      ? [{ value, label: value }]
      : [];
    return [
      { value: "", label: emptyLabel },
      ...current,
      ...options,
    ].map((option) => {
      const label = option.value && option.label !== option.value
        ? `${option.value} · ${option.label}`
        : option.label;
      return `<option value="${escape(option.value)}" ${option.value === value ? "selected" : ""}>${escape(label)}</option>`;
    }).join("");
  }

  function fieldControl(descriptor, value, kind, label, emptyLabel) {
    const key = descriptor.id;
    const attributes = `data-smart-${kind}="${key}" aria-label="${escape(label)}" aria-description="${escape(descriptor.hint || "")}"`;
    return session.options[key].length
      ? `<select ${attributes}>${fieldOptions(key, value, emptyLabel)}</select>`
      : `<input type="text" ${attributes} value="${escape(value)}" maxlength="120" placeholder="${escape(emptyLabel)}" autocomplete="off">`;
  }

  function refreshFieldChoices() {
    $(".smart-uniform-grid", root).innerHTML = uniformMarkup();
    renderAssets();
  }

  function renderOptions() {
    const key = $("#smart-options-field").value;
    $("#smart-options-hint").textContent =
      SMART_FIELDS.find(({ id }) => id === key)?.hint || "";
    $("#smart-options-list").innerHTML = session.options[key].length
      ? session.options[key]
          .map(
            (option, index) =>
              `<div class="smart-option-row"><code>${escape(option.value)}</code><span>${escape(option.label)}</span><button type="button" class="smart-icon-button" data-smart-action="delete-option" data-smart-option-index="${index}" aria-label="删除选项 ${escape(option.label)}">${icon("trash")}</button></div>`,
          )
          .join("")
      : '<p class="smart-note">暂无建议选项，仍可直接输入字段值。</p>';
  }

  function openOptions(target = null) {
    optionTarget = target;
    const selector = $("#smart-options-field");
    if (target) selector.value = target.field;
    selector.disabled = Boolean(target);
    const descriptor = SMART_FIELDS.find(({ id }) => id === selector.value);
    $("#smart-options-title").textContent = target
      ? `新建${descriptor.label}标签`
      : "管理字段选项";
    $("#smart-option-save").textContent = target ? "保存并使用" : "保存标签";
    const currentValue = target
      ? target.assetId
        ? getAsset(target.assetId)?.fields[target.field] || ""
        : uniformValues[target.field] || ""
      : "";
    $("#smart-option-value").value = session.options[selector.value].some(
      ({ value }) => value.toLowerCase() === currentValue.trim().toLowerCase(),
    )
      ? ""
      : currentValue;
    $("#smart-option-label").value = "";
    renderOptions();
    const dialog = $("#smart-options-dialog");
    dialog.showModal();
    dialog.scrollTop = 0;
    if (target) $("#smart-option-value").focus({ preventScroll: true });
  }

  function saveOption() {
    const key = $("#smart-options-field").value;
    const candidate = normalizeSmartOptions({
      [key]: [
        {
          value: $("#smart-option-value").value,
          label: $("#smart-option-label").value,
        },
      ],
    })[key][0];
    if (!candidate) {
      toast("请输入标签代码。");
      $("#smart-option-value").focus();
      return;
    }
    const options = [...session.options[key]];
    const index = options.findIndex(
      ({ value }) => value.toLowerCase() === candidate.value.toLowerCase(),
    );
    if (index < 0 && options.length >= 100) {
      toast("每个字段最多保存 100 个标签，请先删除不需要的标签。");
      return;
    }
    // Keep the existing code spelling so already selected values stay consistent.
    const option =
      index < 0 ? candidate : { ...candidate, value: options[index].value };
    if (index < 0) options.push(option);
    else options[index] = option;
    session.options = { ...session.options, [key]: options };
    const persisted = save(OPTIONS_KEY, session.options);
    refreshFieldChoices();
    renderOptions();
    if (optionTarget) {
      const control = optionTarget.assetId
        ? $(
            `[data-smart-id="${optionTarget.assetId}"] [data-smart-asset-field="${key}"]`,
            root,
          )
        : $(`[data-smart-uniform="${key}"]`, root);
      if (control) {
        control.value = option.value;
        // Use the same edit path as typing: uniform settings persist, row edits lock.
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }
      $("#smart-options-dialog").close();
    } else {
      $("#smart-option-value").value = "";
      $("#smart-option-label").value = "";
      $("#smart-option-value").focus();
    }
    if (persisted) toast("标签已保存，可在该字段的下拉列表中使用。");
  }

  const uniformPatch = () =>
    Object.fromEntries([...uniformEnabled].map((key) => [key, uniformValues[key] || ""]));
  const uniformPreview = () => ({
    patch: Object.fromEntries(
      Object.entries(uniformPatch()).filter(([, value]) => value.trim()),
    ),
    all: $("#smart-uniform-scope").value === "all",
  });

  function previewAssets() {
    const { patch, all } = uniformPreview();
    return Object.keys(patch).length
      ? session.assets.map((asset) => previewSmartUniformFields(asset, patch, all))
      : session.assets;
  }

  function updateNames(assets = previewAssets()) {
    try {
      if (settingsError) throw new Error(settingsError);
      names = buildSmartNames(assets, session.settings);
      nameError = "";
    } catch (error) {
      names = [];
      nameError = error.message || "请检查命名模板。";
    }
    for (const entry of names) {
      const control = document.getElementById(`smart-name-${entry.id}`);
      if (control && document.activeElement !== control)
        control.value = entry.name;
    }
    $("#smart-name-error").hidden = !nameError;
    $("#smart-name-error").textContent = nameError;
    syncControls();
  }

  function fieldMarkup(asset, descriptor) {
    const locked = asset.manualFields.includes(descriptor.id);
    const value = asset.fields[descriptor.id] || "";
    const control = fieldControl(
      descriptor, value, "asset-field", `${asset.originalName}的${descriptor.label}`, "待补充",
    );
    return `<div class="smart-asset-field ${locked ? "is-protected" : ""}" data-smart-field-wrap="${descriptor.id}"><div class="smart-field-heading">${fieldCaption(descriptor)}<div class="smart-field-actions"><button type="button" data-smart-action="unlock-field" data-smart-field-key="${descriptor.id}" ${locked ? "" : "hidden"} title="解除保护，允许后续统一修改和 AI 分析更新">手动 · 解锁</button>${newTagButton(descriptor)}</div></div>${control}</div>`;
  }

  function renderAssets() {
    if (signal.aborted) return;
    const editing = document.activeElement;
    const editingAsset = editing?.closest("[data-smart-id]");
    const editingAttribute = [
      "data-smart-custom-name",
      "data-smart-asset-field",
      "data-smart-metadata",
    ].find((attribute) => editing?.hasAttribute(attribute));
    const draft =
      editingAsset && editingAttribute && editing instanceof HTMLInputElement
        ? {
            id: editingAsset.dataset.smartId,
            attribute: editingAttribute,
            key: editing.getAttribute(editingAttribute),
            value: editing.value,
            start: editing.selectionStart,
            end: editing.selectionEnd,
            direction: editing.selectionDirection,
          }
        : null;
    const assets = previewAssets();
    $("#smart-assets").innerHTML = assets.length
      ? assets
          .map((asset, index) => {
            const { compress, resize } = smartMediaChecks(asset.file, asset.metadata);
            const checks = [
              `${asset.metadata.width} × ${asset.metadata.height}`,
              durationLabel(asset.metadata.duration),
              byteLabel(asset.file.size),
            ];
            if (asset.metadata.type === "video")
              checks.push(resize ? "可调整到 1080p" : "1080p");
            if (compress) checks.push("文件 > 32 MB");
            if (asset.sourceFile) checks.push("已本地处理");
            return `<article class="smart-asset" data-smart-id="${asset.id}"><div class="smart-asset-heading"><input type="checkbox" data-smart-selected ${asset.selected ? "checked" : ""} aria-label="选择 ${escape(asset.originalName)}"><button type="button" class="smart-thumbnail" data-smart-action="preview" aria-label="预览 ${escape(asset.originalName)}"><img src="${escape(asset.thumbnail)}" alt="">${asset.metadata.type === "video" ? icon("play") : ""}</button><div class="smart-asset-title"><strong title="${escape(asset.originalName)}">${escape(asset.originalName)}</strong><small>${checks.join(" · ")}</small></div><span class="smart-status smart-status-${asset.status}">${statusLabels[asset.status] || "待分析"}</span><button type="button" class="smart-icon-button" data-smart-action="remove-asset" aria-label="移除 ${escape(asset.originalName)}">${icon("trash")}</button></div>
        <div class="smart-name-row"><label><span>${String(index + 1).padStart(2, "0")} / 新文件名</span><input id="smart-name-${asset.id}" data-smart-custom-name type="text" value="" maxlength="240" spellcheck="false" aria-label="${escape(asset.originalName)}的新文件名"></label><button type="button" class="smart-text-button" data-smart-action="auto-name" ${asset.customStem ? "" : "hidden"}>恢复模板</button></div>
        <div class="smart-asset-fields">${SMART_FIELDS.map((descriptor) => fieldMarkup(asset, descriptor)).join("")}</div>
        <div class="smart-metadata-fields"><label>命名比例<input data-smart-metadata="ratio" type="text" value="${escape(asset.namingMetadata?.ratio ?? asset.metadata.ratio ?? "")}" maxlength="30" placeholder="例如 9-16"></label><label>命名时长<input data-smart-metadata="duration" type="text" value="${escape(asset.namingMetadata?.duration ?? formatSmartNamingDuration(asset.metadata.duration))}" maxlength="30" placeholder="例如 29s"></label><label>命名分辨率<input data-smart-metadata="resolution" type="text" value="${escape(asset.namingMetadata?.resolution ?? `${asset.metadata.width}x${asset.metadata.height}`)}" maxlength="40" placeholder="例如 1080x1920"></label></div>
        <p class="smart-asset-note ${asset.status === "failed" ? "smart-error" : ""}" ${asset.summary ? "" : "hidden"}>${escape(asset.summary || "")}</p><div class="smart-asset-footer"><span>手动修改的字段会自动保护，不被 AI 或统一修改覆盖。</span><div><button type="button" data-smart-action="unlock-asset">解除本条保护</button><button type="button" data-smart-action="analyze-one">${asset.status === "failed" ? "重试分析" : "分析此素材"}</button><button type="button" data-smart-action="download-one">${icon("download")}单独下载</button></div></div></article>`;
          })
          .join("")
      : `<div class="smart-empty">${icon("file")}<strong>素材列表会显示在这里</strong><p>添加视频或图片后，可手动命名，也可使用 AI 补齐字段。</p></div>`;
    $("#smart-summary").hidden = !session.summary;
    $("#smart-summary").textContent = session.summary;
    if (draft) {
      const replacement = $(
        `[data-smart-id="${draft.id}"] [${draft.attribute}${draft.key ? `="${draft.key}"` : ""}]`,
        root,
      );
      if (replacement) {
        replacement.value = draft.value;
        replacement.focus({ preventScroll: true });
        replacement.setSelectionRange(draft.start, draft.end, draft.direction);
      }
    }
    updateNames(assets);
  }

  function updateCustomName(asset, control) {
    const extension = asset.file.name.match(/\.[^.]+$/)?.[0] || "";
    const value = control.value;
    const stem =
      extension && value.toLowerCase().endsWith(extension.toLowerCase())
        ? value.slice(0, -extension.length)
        : value;
    asset.customStem = stem;
    const assetElement = control.closest("[data-smart-id]");
    $("[data-smart-action='auto-name']", assetElement).hidden = !stem;
    updateNames();
  }

  function updateAssetProtection(asset) {
    const element = $(`[data-smart-id="${asset.id}"]`, root);
    if (!element) return;
    for (const descriptor of SMART_FIELDS) {
      const wrap = $(`[data-smart-field-wrap="${descriptor.id}"]`, element);
      const locked = asset.manualFields.includes(descriptor.id);
      wrap.classList.toggle("is-protected", locked);
      $("[data-smart-action='unlock-field']", wrap).hidden = !locked;
    }
  }

  async function offerLocalProcessing(assets) {
    const candidates = assets
      .map((asset, index) => ({ index, ...smartMediaChecks(asset.file, asset.metadata) }))
      .filter(({ compress, resize }) => compress || resize);
    if (!candidates.length || signal.aborted) return "";

    const dialog = $("#smart-optimize-dialog");
    const choice = $("#smart-optimize-choice");
    const running = $("#smart-optimize-running");
    const progress = $("#smart-optimize-progress");
    const status = $("#smart-optimize-status");
    $("#smart-optimize-list").innerHTML = candidates.map(({ index, compress, resize }) => {
      const asset = assets[index];
      const actions = [];
      if (compress) actions.push(`${byteLabel(asset.file.size)} → 32 MB 以内`);
      if (resize) {
        const target = smartVideoTarget(asset.metadata);
        actions.push(`${asset.metadata.width} × ${asset.metadata.height} → ${target.width} × ${target.height}`);
      }
      return `<li>${escape(asset.originalName)} · ${actions.join("；")}</li>`;
    }).join("");

    const controller = new AbortController();
    const cancel = () => controller.abort();
    const abort = () => {
      cancel();
      if (dialog.open) dialog.close();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      choice.hidden = false;
      running.hidden = true;
      dialog.returnValue = "keep";
      const decision = new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
      });
      dialog.showModal();
      if (await decision !== "process" || controller.signal.aborted) return "";

      choice.hidden = true;
      running.hidden = false;
      progress.value = 0;
      status.textContent = "正在准备…";
      dialog.addEventListener("close", cancel);
      dialog.showModal();
      $("button", running).focus();

      const failed = [];
      let completed = 0;
      for (const [position, { index, resize }] of candidates.entries()) {
        if (controller.signal.aborted) break;
        const asset = assets[index];
        const update = (value, label) => {
          progress.value = (position + value) / candidates.length;
          status.textContent = `${position + 1} / ${candidates.length} · ${asset.originalName} · ${label}`;
        };
        try {
          const file = await optimizeSmartMedia(asset.file, asset.metadata, {
            signal: controller.signal,
            onProgress: update,
          });
          const result = await inspectSmartMedia(file, { signal: controller.signal });
          if (resize) {
            const target = smartVideoTarget(asset.metadata);
            if (result.metadata.width !== target.width || result.metadata.height !== target.height)
              throw new Error("输出视频未达到目标分辨率。");
          }
          if (asset.metadata.type === "video" &&
              result.metadata.duration < asset.metadata.duration - 0.25)
            throw new Error("输出视频时长不完整。");
          assets[index] = { ...asset, ...result, file, sourceFile: asset.file };
          completed++;
        } catch (error) {
          if (controller.signal.aborted || error.name === "AbortError") break;
          failed.push(`${asset.originalName}：${error.message || "处理失败"}`);
        }
      }

      const details = [];
      if (completed) details.push(`已本地处理 ${completed} 个`);
      if (failed.length)
        details.push(`${failed.length} 个处理失败，已保留原件（${failed.slice(0, 3).join("；")}）`);
      if (controller.signal.aborted) details.push("已取消剩余处理，未完成素材保留原件");
      return details.join("；");
    } finally {
      dialog.removeEventListener("close", cancel);
      signal.removeEventListener("abort", abort);
      if (dialog.open) dialog.close();
    }
  }

  const isSameFile = (asset, file) => {
    const source = asset.sourceFile || asset.file;
    return source.name === file.name && source.size === file.size &&
      source.lastModified === file.lastModified;
  };

  async function importFiles(files) {
    if (loading || signal.aborted) return;
    const candidates = [...files];
    $("#smart-files").value = "";
    if (!candidates.length) return;
    if (session.assets.length + candidates.length > 100) {
      toast("每批最多 100 个素材，请移除部分素材后再添加。");
      return;
    }
    loading = true;
    syncControls();
    const added = [];
    const failures = [];
    let processingSummary = "";
    try {
      for (const [index, file] of candidates.entries()) {
        if (signal.aborted) break;
        $("#smart-import-status").textContent =
          `正在读取 ${index + 1} / ${candidates.length} · ${file.name}`;
        const duplicate = [...session.assets, ...added].some(
          (asset) => isSameFile(asset, file),
        );
        if (duplicate) {
          failures.push(`${file.name}：已在列表中`);
          continue;
        }
        try {
          const result = await inspectSmartMedia(file, { signal });
          if (signal.aborted) break;
          added.push({
            id: uid(),
            file,
            originalName: file.name,
            ...result,
            fields: defaultSmartFields({ ...result.metadata, name: file.name }),
            manualFields: [],
            namingMetadata: {},
            customStem: "",
            selected: true,
            status: "idle",
            summary: "",
          });
        } catch (error) {
          if (error.name === "AbortError" || signal.aborted) break;
          failures.push(`${file.name}：${error.message || "无法读取素材"}`);
        }
      }
      processingSummary = await offerLocalProcessing(added);
    } finally {
      loading = false;
      if (!signal.aborted) {
        const additions = added.filter((item) => !session.assets.some(
          (asset) => isSameFile(asset, item.sourceFile || item.file),
        ));
        if (additions.length) recordEdit(() => session.assets.push(...additions));
        $("#smart-files").value = "";
        $("#smart-import-status").textContent =
          `已添加 ${additions.length} 个素材${failures.length ? `，${failures.length} 个未添加。${failures.slice(0, 3).join("；")}` : ""}`;
        if (processingSummary) $("#smart-import-status").textContent += `。 ${processingSummary}`;
        renderAssets();
      }
    }
  }

  function readSettings() {
    const candidate = { ...session.settings };
    $$("[data-smart-setting]", root).forEach((control) => {
      candidate[control.dataset.smartSetting] = control.value;
    });
    candidate.separator = $("#smart-separator").value;
    candidate.template = $("#smart-template").value;
    try {
      session.settings = normalizeSmartSettings(candidate);
      settingsError = "";
      persistSettings();
    } catch (error) {
      settingsError = error.message || "请检查命名设置。";
    }
    updateNames();
  }

  function recordDownload(assets) {
    const index = Math.max(
      ...assets.map((asset) =>
        session.assets.findIndex((item) => item.id === asset.id),
      ),
    );
    const map = sequenceMap();
    map[session.settings.date] = Math.max(
      nextSequence(session.settings.date),
      session.settings.start + index + 1,
    );
    const dates = Object.keys(map).sort().slice(-180);
    save(
      SEQUENCE_KEY,
      Object.fromEntries(dates.map((date) => [date, map[date]])),
    );
    syncControls();
  }

  async function analyze(assets) {
    if (analysisController || loading || signal.aborted || !assets.length)
      return;
    if (!$("#smart-consent").checked) {
      toast("请先勾选允许发送抽帧图片。");
      return;
    }
    persistConfig();
    let config;
    try {
      config = normalizeSmartApiConfig({
        ...session.config,
        apiKey: session.apiKey,
      });
      if (!config.apiKey || !config.model)
        throw new Error("请填写 API Key 和可用模型 ID。");
    } catch (error) {
      errorToast(error);
      return;
    }
    const controller = new AbortController();
    const runId = uid();
    analysisId = runId;
    analysisController = controller;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const targetIds = assets.map((asset) => asset.id);
    const { patch, all } = uniformPreview();
    const prefilledIds = new Set(
      assets.filter((asset) => all || asset.selected).map((asset) => asset.id),
    );
    let completed = 0,
      failed = 0;
    syncControls();
    try {
      for (const [index, assetId] of targetIds.entries()) {
        if (controller.signal.aborted) break;
        const asset = getAsset(assetId);
        if (!asset) continue;
        analysisPrevious.set(assetId, { status: asset.status, summary: asset.summary, analysisId: asset.analysisId });
        setAsset(assetId, {
          ...asset,
          analysisId: runId,
          status: "analyzing",
          summary: "正在读取分析画面…",
        });
        renderAssets();
        progress(
          index / targetIds.length,
          `正在分析 ${index + 1} / ${targetIds.length} · ${asset.originalName}`,
        );
        try {
          const frames = await extractSmartFrames(asset.file, {
            signal: controller.signal,
            count: 8,
            maxDimension: 1280,
            onProgress: (value) =>
              progress(
                (index + Math.max(0, Math.min(1, value)) * 0.3) /
                  targetIds.length,
                `正在抽帧 ${index + 1} / ${targetIds.length} · ${asset.originalName}`,
              ),
          });
          const result = await analyzeSmartFrames(frames, {
            config,
            signal: controller.signal,
            fields: SMART_FIELDS,
            options: session.options,
          });
          if (controller.signal.aborted)
            throw new DOMException("已取消分析", "AbortError");
          const latest = getAsset(assetId);
          if (latest?.analysisId === runId) {
            const prefilled = prefilledIds.has(assetId) && Object.keys(patch).length
              ? previewSmartUniformFields(latest, patch, true)
              : latest;
            recordEdit(() => setAsset(assetId, {
              ...applySmartAnalysis(prefilled, result.fields),
              hasAnalysis: true,
              status: "ready",
              summary: result.summary || "分析完成，请检查命名字段后下载。",
            }));
          }
          completed++;
        } catch (error) {
          const latest = getAsset(assetId);
          if (controller.signal.aborted || error.name === "AbortError") {
            if (latest?.analysisId === runId)
              setAsset(assetId, {
                ...latest,
                status: "canceled",
                summary: "分析已停止，已填写字段保留，可重新分析。",
              });
            break;
          }
          failed++;
          if (latest?.analysisId === runId)
            recordEdit(() => setAsset(assetId, {
              ...latest,
              status: "failed",
              summary:
                error.message || "分析失败，请检查模型与 API 配置后重试。",
            }));
        }
        renderAssets();
      }
      if (!signal.aborted)
        session.summary = `${controller.signal.aborted ? "已停止分析" : "本轮分析完成"}：成功 ${completed} 个${failed ? `，失败 ${failed} 个` : ""}。已完成结果和手动修改均已保留。`;
    } finally {
      analysisPrevious.clear();
      signal.removeEventListener("abort", abort);
      analysisController = null;
      analysisId = null;
      for (const asset of session.assets)
        if (asset.status === "analyzing" && asset.analysisId === runId) {
          asset.status = "canceled";
          asset.summary = "分析已停止，可重新分析。";
        }
      if (!signal.aborted) {
        progress(1, session.summary);
        renderAssets();
      }
    }
  }

  async function exportZip() {
    if (exporting || analysisController || loading || nameError) return;
    const assets = selectedAssets();
    if (!assets.length) return;
    const nameMap = new Map(names.map((entry) => [entry.id, entry.name]));
    const output = assets.map((asset) => ({
      name: nameMap.get(asset.id),
      blob: asset.file,
    }));
    exporting = true;
    syncControls();
    try {
      await runOperation(
        "打包智能命名素材",
        async (operationSignal, update) => {
          const controller = new AbortController();
          const abort = () => controller.abort();
          signal.addEventListener("abort", abort, { once: true });
          operationSignal.addEventListener("abort", abort, { once: true });
          if (signal.aborted || operationSignal.aborted) abort();
          try {
            const archive = await zipFiles(output, {
              signal: controller.signal,
              onProgress: (value) =>
                update(
                  value,
                  `正在打包 ${assets.length} 个素材 · ${Math.round(value * 100)}%`,
                ),
            });
            if (controller.signal.aborted)
              throw new DOMException("已取消下载", "AbortError");
            download(archive, `QS_智能命名_${session.settings.date}.zip`);
            recordDownload(assets);
          } finally {
            signal.removeEventListener("abort", abort);
            operationSignal.removeEventListener("abort", abort);
          }
        },
      );
    } finally {
      exporting = false;
      syncControls();
    }
  }

  function closePreview() {
    const media = $("video", $("#smart-media-preview"));
    if (media) {
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
    $("#smart-media-preview").replaceChildren();
    if (previewURL) {
      URL.revokeObjectURL(previewURL);
      previewURL = null;
    }
  }

  on($("#smart-files"), "change", (event) => {
    void importFiles(event.target.files);
  });
  on($("#smart-option-form"), "submit", (event) => {
    event.preventDefault();
    saveOption();
  });
  on(root, "input", (event) => {
    const target = event.target;
    if (target.id === "smart-api-key") {
      session.apiKey = target.value;
      if (session.rememberKey) save(SECRET_KEY, session.apiKey);
      syncControls();
      return;
    }
    if (["smart-model", "smart-base-url"].includes(target.id)) {
      persistConfig();
      syncControls();
      return;
    }
    if (target.dataset.smartUniform) {
      uniformValues[target.dataset.smartUniform] = target.value;
      uniformEnabled.add(target.dataset.smartUniform);
      $(
        `[data-smart-uniform-enable="${target.dataset.smartUniform}"]`,
        root,
      ).checked = true;
      persistUniform();
      renderAssets();
      return;
    }
    if (target.dataset.smartSetting || target.id === "smart-template") {
      if (target.dataset.smartSetting === "start") sequenceEdited = true;
      readSettings();
      return;
    }
    const assetElement = target.closest("[data-smart-id]");
    const asset = assetElement && getAsset(assetElement.dataset.smartId);
    if (!asset) return;
    if (target.hasAttribute("data-smart-custom-name")) {
      updateCustomName(asset, target);
    } else if (target.dataset.smartAssetField) {
      const next = applySmartFields(
        asset,
        { [target.dataset.smartAssetField]: target.value },
        { source: "manual" },
      );
      setAsset(asset.id, next);
      updateAssetProtection(next);
      updateNames();
    } else if (target.dataset.smartMetadata) {
      setAsset(asset.id, {
        ...asset,
        namingMetadata: {
          ...asset.namingMetadata,
          [target.dataset.smartMetadata]: target.value,
        },
      });
      updateNames();
    }
  });
  on(root, "change", (event) => {
    const target = event.target;
    if (target.id === "smart-remember-key") {
      session.rememberKey = target.checked;
      if (target.checked) save(SECRET_KEY, session.apiKey);
      else {
        try {
          localStorage.removeItem(SECRET_KEY);
        } catch {}
      }
    } else if (target.id === "smart-consent") {
      if (!target.checked) analysisController?.abort();
      syncControls();
    } else if (target.id === "smart-select-all") {
      session.assets.forEach((asset) => {
        asset.selected = target.checked;
      });
      renderAssets();
    } else if (target.dataset.smartUniformEnable) {
      target.checked
        ? uniformEnabled.add(target.dataset.smartUniformEnable)
        : uniformEnabled.delete(target.dataset.smartUniformEnable);
      persistUniform();
      renderAssets();
    } else if (target.id === "smart-uniform-scope") {
      renderAssets();
    } else if (target.id === "smart-options-field") {
      $("#smart-option-value").value = "";
      $("#smart-option-label").value = "";
      renderOptions();
    } else if (target.id === "smart-separator") readSettings();
    else if (
      target.dataset.smartSetting === "date" &&
      !sequenceEdited &&
      !settingsError
    ) {
      session.settings = normalizeSmartSettings({
        ...session.settings,
        start: nextSequence(session.settings.date),
      });
      $("#smart-setting-start").value = session.settings.start;
      persistSettings();
      updateNames();
    }
    const assetElement = target.closest("[data-smart-id]");
    const asset = assetElement && getAsset(assetElement.dataset.smartId);
    if (!asset) return;
    if (target.hasAttribute("data-smart-selected")) {
      asset.selected = target.checked;
      renderAssets();
      $(`[data-smart-id="${asset.id}"] [data-smart-selected]`, root)?.focus({ preventScroll: true });
    }
  });
  on(root, "focusout", (event) => {
    const control = event.target;
    if (!control.hasAttribute("data-smart-custom-name")) return;
    const asset = getAsset(control.closest("[data-smart-id]")?.dataset.smartId);
    const entry = asset && names.find(({ id }) => id === asset.id);
    if (entry) control.value = entry.name;
  });
  on(root, "click", (event) => {
    const button = event.target.closest("[data-smart-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.smartAction;
    const assetElement = button.closest("[data-smart-id]");
    const asset = assetElement && getAsset(assetElement.dataset.smartId);
    if (action === "help") openNamingHelp();
    else if (action === "clear-key") clearSecret();
    else if (action === "analyze") void analyze(selectedAssets());
    else if (action === "analyze-one" && asset) void analyze([asset]);
    else if (action === "cancel") analysisController?.abort();
    else if (action === "zip") void exportZip();
    else if (action === "csv") {
      if (nameError) return;
      download(
        new Blob([smartCsv(previewAssets(), session.settings)], {
          type: "text/csv;charset=utf-8",
        }),
        `QS_命名清单_${session.settings.date}.csv`,
      );
      toast(`已导出全部 ${session.assets.length} 个素材的命名清单。`);
    } else if (action === "download-one" && asset) {
      const name = names.find((entry) => entry.id === asset.id)?.name;
      if (!name) return;
      download(asset.file, name);
      recordDownload([asset]);
    } else if (action === "remove-selected" || action === "remove-asset") {
      if (analysisController || loading || exporting) return;
      session.assets = session.assets.filter((item) =>
        action === "remove-selected" ? !item.selected : item.id !== asset?.id,
      );
      if (!session.assets.length) {
        session.summary = "";
        sequenceEdited = false;
        session.settings = normalizeSmartSettings({
          ...session.settings,
          start: nextSequence(session.settings.date),
        });
        $("#smart-setting-start").value = session.settings.start;
        persistSettings();
      }
      renderAssets();
    } else if (action === "apply-uniform") {
      if (!uniformEnabled.size) {
        toast("先勾选需要统一的字段。");
        return;
      }
      const all = $("#smart-uniform-scope").value === "all";
      const patch = uniformPatch();
      let count = 0;
      session.assets = session.assets.map((item) => {
        if (!all && !item.selected) return item;
        count++;
        return applySmartFields(item, patch, { source: "uniform" });
      });
      renderAssets();
      toast(`已应用到 ${count} 个素材，受保护字段已保留。`);
    } else if (action === "clear-uniform") {
      uniformEnabled.clear();
      for (const key of Object.keys(uniformValues)) delete uniformValues[key];
      $$("[data-smart-uniform]", root).forEach((element) => {
        element.value = "";
      });
      $$("[data-smart-uniform-enable]", root).forEach((element) => {
        element.checked = false;
      });
      persistUniform();
      renderAssets();
    } else if (action === "unlock-selected") {
      selectedAssets().forEach((item) => {
        item.manualFields = [];
      });
      renderAssets();
      toast("已解除所选素材的字段保护。");
    } else if (action === "unlock-asset" && asset) {
      asset.manualFields = [];
      renderAssets();
    } else if (action === "unlock-field" && asset) {
      asset.manualFields = asset.manualFields.filter(
        (key) => key !== button.dataset.smartFieldKey,
      );
      renderAssets();
    } else if (action === "auto-name" && asset) {
      asset.customStem = "";
      button.hidden = true;
      updateNames();
    } else if (action === "reset-template") {
      $("#smart-template").value = SMART_DEFAULTS.template;
      readSettings();
    } else if (action === "insert-token") {
      const control = $("#smart-template");
      control.setRangeText(
        `{${button.dataset.smartToken}}`,
        control.selectionStart,
        control.selectionEnd,
        "end",
      );
      readSettings();
      control.focus();
    } else if (action === "options") {
      openOptions();
    } else if (action === "new-tag") {
      openOptions({ field: button.dataset.smartFieldKey, assetId: asset?.id });
    } else if (action === "delete-option") {
      const key = $("#smart-options-field").value;
      session.options[key] = session.options[key].filter(
        (_, index) => index !== Number(button.dataset.smartOptionIndex),
      );
      save(OPTIONS_KEY, session.options);
      refreshFieldChoices();
      renderOptions();
    } else if (action === "reset-options") {
      const key = $("#smart-options-field").value;
      session.options[key] = SMART_FIELDS.find(
        (descriptor) => descriptor.id === key,
      ).options.map((option) => ({ ...option }));
      save(OPTIONS_KEY, session.options);
      refreshFieldChoices();
      renderOptions();
    } else if (action === "preview" && asset) {
      closePreview();
      previewURL = URL.createObjectURL(asset.file);
      const media = document.createElement(
        asset.metadata.type === "video" ? "video" : "img",
      );
      media.src = previewURL;
      if (media instanceof HTMLVideoElement) {
        media.controls = true;
        media.playsInline = true;
      } else media.alt = asset.originalName;
      $("#smart-media-preview").append(media);
      $("#smart-preview-title").textContent = asset.originalName;
      $("#smart-preview-dialog").showModal();
    }
  });
  on($("#smart-preview-dialog"), "close", closePreview);
  on($("#smart-options-dialog"), "close", () => {
    optionTarget = null;
  });
  on($("#smart-help-dialog"), "click", (event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      event.currentTarget.close();
  });
  addCleanup(() => {
    analysisController?.abort();
    for (const asset of session.assets)
      if (asset.status === "analyzing" && asset.analysisId === analysisId) {
        asset.status = "canceled";
        asset.summary = "分析已停止，可重新分析。";
      }
    closePreview();
  });
  renderOptions();
  renderAssets();
  registerUndo({
    controls: "[data-smart-setting], #smart-template, #smart-separator, #smart-model, #smart-base-url",
    capture: () => ({
      assets: session.assets.map((asset) => asset.status === "analyzing"
        ? { ...asset, ...analysisPrevious.get(asset.id) }
        : asset),
      settings: session.settings,
      options: session.options,
      config: session.config,
      summary: session.summary,
      uniformValues,
      uniformEnabled: [...uniformEnabled],
      sequenceEdited,
      settingsError,
    }),
    restore(state) {
      analysisController?.abort();
      const { assets, settings, options, config, summary } = state;
      Object.assign(session, { assets, settings, options, config, summary });
      save(CONFIG_KEY, config);
      ({ sequenceEdited, settingsError } = state);
      Object.assign(uniformValues, state.uniformValues);
      uniformEnabled.clear();
      state.uniformEnabled.forEach((key) => uniformEnabled.add(key));
      persistSettings();
      persistUniform();
      save(OPTIONS_KEY, session.options);
      refreshFieldChoices();
      renderOptions();
    },
  });
}
