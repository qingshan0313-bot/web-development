import {
  MIX_DEFAULTS,
  normalizeMixSettings,
  mixAssetKey,
  buildMixQueue,
  normalizeMixRecords,
} from "./mix-model.js";
import { loadVideo, disposeVideo } from "./video.js";
import { joinVideos } from "./video-join.js";
import { download, zipFiles } from "./media.js";
import { VIDEO_FORMATS, videoFilename } from "./video-export.js";
import { mixPreviewMarkup, createMixPreview } from "./mix-preview.js";

const RECORDS_KEY = "frame-mix-records-v1";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const id = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const seconds = (value) => `${Number(value.toFixed(2))} 秒`;
const safeName = (value) =>
  String(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();
const stem = (value) =>
  safeName(value.replace(/\.[^.]+$/, "")).slice(0, 40) || "素材";
const statusLabel = {
  pending: "待生成",
  generating: "生成中",
  generated: "已生成",
  failed: "失败",
  completed: "已完成",
};
const abortError = () => new DOMException("已取消混剪。", "AbortError");

// Files and generated blobs stay in this tab only. Records contain no media.
const session = {
  hooks: [],
  bodies: [],
  queue: [],
  results: new Map(),
  settings: normalizeMixSettings(MIX_DEFAULTS),
  previewId: null,
  summary: "",
};

export function setupMixEditor(api) {
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
    beginUndoEdit,
    escapeHTML: escape,
  } = api;
  let busy = false,
    loading = 0,
    importingRecords = false,
    recordRevision = 0;
  let records = [],
    storageWarning = "";
  const imports = { hooks: [], bodies: [] };
  const loadingKeys = { hooks: new Set(), bodies: new Set() };
  try {
    records = normalizeMixRecords(
      JSON.parse(localStorage.getItem(RECORDS_KEY) || "[]"),
    );
  } catch {
    storageWarning = "浏览器记录暂时无法读取，可导入之前导出的 JSON。";
  }

  const settings = () => session.settings;
  const numberControl = (key, label, value, attrs) =>
    `<label>${label}<input type="number" data-mix-asset-field="${key}" value="${value}" ${attrs}></label>`;
  const control = (key, html) =>
    html.replace(/<(input|select)\b/, `<$1 data-mix-setting="${key}"`);
  const groupMarkup = (group, number, title, hint) =>
    `<section class="mix-material-section"><div class="mix-section-heading"><h3><span>${number}</span>${title}</h3><small id="mix-${group}-count">0 个素材</small></div>${upload(`mix-${group}-files`, `添加${title}`, hint, "video/*,.mp4,.mov,.webm", true, true)}<div class="mix-list-toolbar"><button type="button" data-mix-action="select-assets" data-mix-group="${group}">全选</button><button type="button" data-mix-action="clear-selection" data-mix-group="${group}">清空选择</button></div><div id="mix-${group}-list" class="mix-assets"></div><div id="mix-${group}-feedback" class="mix-import-feedback" role="status" hidden></div></section>`;

  mountTool(
    "mix",
    `<div class="mix-settings">${groupMarkup("hooks", "01", "片头素材", "导入多个本地视频，可分别裁剪和调音量")}${groupMarkup("bodies", "02", "成片素材", "每条输出按「片头 → 成片」组合，可添加衔接转场")}
    <section class="mix-output-section"><div class="mix-section-heading"><h3><span>03</span>组合与输出</h3></div>
    ${field(
      "组合方式",
      control(
        "mode",
        select(
          "mix-mode",
          [
            ["single", "单片头 × 多成片"],
            ["all", "所有片头 × 所有成片"],
            ["ordered", "按列表顺序一一配对"],
          ],
          settings().mode,
        ),
      ),
    )}
    <p id="mix-mode-help" class="setting-hint"></p>
    <label class="mix-check"><input id="mix-skip" data-mix-setting="skipCompleted" type="checkbox" ${settings().skipCompleted ? "checked" : ""}><span>跳过已生成或已完成的重复组合</span></label>
    <div class="mix-field-row">${field("输出格式", control("format", select("mix-format", VIDEO_FORMATS, settings().format)))}${field(
      "帧率",
      control(
        "fps",
        select(
          "mix-fps",
          [
            [24, "24 fps"],
            [30, "30 fps"],
            [60, "60 fps"],
          ],
          settings().fps,
        ),
      ),
    )}</div>
    <div class="mix-field-row">${field("衔接转场", control("transition", select("mix-transition", [["none", "无 · 直接拼接"], ["black", "淡黑"], ["white", "淡白"], ["blur", "柔焦"]], settings().transition)))}${field("转场时长 / 秒", control("transitionDuration", input("mix-transition-duration", settings().transitionDuration, "number", 'min="0.1" max="2" step="0.1"')))}</div>
    <p class="setting-hint">转场围绕衔接点渐入渐出，保留视频总时长与原声；短素材会自动缩短效果。设置应用于新加入的组合。</p>
    <label id="mix-alpha-control" class="alpha-option" hidden><input id="mix-alpha" data-mix-setting="transparentBackground" type="checkbox" ${settings().transparentBackground ? "checked" : ""}>透明留边（MOV · Alpha）<small>原视频画面保持原样；仅保留原有透明区域并将留边设为透明。</small></label>
    ${field(
      "输出画幅",
      select(
        "mix-resolution",
        [
          ["720x1280", "竖屏 · 720 × 1280"],
          ["1080x1920", "竖屏 · 1080 × 1920"],
          ["1280x720", "横屏 · 1280 × 720"],
          ["1920x1080", "横屏 · 1920 × 1080"],
          ["1080x1080", "方形 · 1080 × 1080"],
        ],
        `${settings().width}x${settings().height}`,
      ),
    )}
    <div class="mix-field-row">${field(
      "画面适配",
      control(
        "fit",
        select(
          "mix-fit",
          [
            ["contain", "完整显示 · 留边"],
            ["cover", "铺满画面 · 裁切"],
          ],
          settings().fit,
        ),
      ),
    )}${field("留边颜色", control("backgroundColor", input("mix-background", settings().backgroundColor, "color")))}</div>
    ${field(
      "视频码率",
      control(
        "videoBitsPerSecond",
        select(
          "mix-bitrate",
          [
            [3000000, "轻量 · 3 Mbps"],
            [6000000, "标准 · 6 Mbps"],
            [12000000, "高清 · 12 Mbps"],
            [20000000, "高质量 · 20 Mbps"],
          ],
          settings().videoBitsPerSecond,
        ),
      ),
    )}
    ${field("文件名前缀", control("prefix", input("mix-prefix", settings().prefix, "text", 'maxlength="60" placeholder="QS_混剪"')))}
    <button type="button" class="button secondary mix-full" data-mix-action="build">${icon("plus")}添加组合到队列</button>
    <p class="setting-hint">每条组合保存加入时的裁剪、音量和输出设置。修改参数后，重新添加组合即可。一次最多保留 50 条待处理任务。</p>
    <button type="button" id="mix-export" class="button primary mix-full" data-mix-action="export">${icon("download")}生成并下载所选组合</button><p id="mix-export-hint" class="mix-export-hint" role="status"></p>
    </section><p class="mix-local-note">素材仅保留在当前标签页，刷新后需重新选择。生成文件请及时下载；制作记录只保存在此浏览器，不含视频文件。</p></div>`,
    `<div class="mix-output">${mixPreviewMarkup(icon)}<section class="mix-queue-section"><div class="mix-section-heading"><h3>组合队列</h3><small id="mix-queue-count"></small></div><div class="mix-list-toolbar mix-queue-toolbar"><button type="button" data-mix-action="select-queue">选择待处理</button><button type="button" data-mix-action="remove-queue">移除所选</button><button type="button" data-mix-action="download-all" id="mix-download-all" hidden>下载已生成文件</button></div><p id="mix-summary" class="mix-summary" role="status" hidden></p><div id="mix-queue" class="mix-queue"></div></section>
    <section class="mix-records-section"><div class="mix-section-heading"><h3>制作记录</h3><small id="mix-record-count"></small></div><div class="mix-list-toolbar"><button type="button" data-mix-action="export-records">导出记录 JSON</button><button type="button" data-mix-action="import-records">导入记录 JSON</button><input id="mix-record-file" type="file" accept=".json,application/json" hidden></div><p class="mix-record-note">显示最近 50 条，最多保留 500 条。标为完成用于跟踪制作进度，不代表已经下载文件。</p><p id="mix-storage-warning" class="mix-summary mix-warning" role="status" hidden></p><div id="mix-records" class="mix-records"></div></section></div>`,
  );

  const root = $("#workspace");
  const preview = createMixPreview({
    on,
    signal,
    addCleanup,
    toast,
    errorToast,
    icon,
  });
  const locked = () => busy || loading > 0 || importingRecords;
  const trimDialog = document.createElement("dialog");
  trimDialog.className = "mix-trim-dialog";
  trimDialog.innerHTML = `<div class="mix-trim-heading"><div><span class="eyebrow">QUICK TRIM</span><h3>快速裁切</h3><p id="mix-trim-name"></p></div><button type="button" data-trim="close" aria-label="关闭裁切">✕</button></div>
    <video id="mix-trim-video" controls playsinline preload="metadata"></video>
    <div class="mix-trim-markers"><button type="button" data-trim="start">当前位置设为入点</button><button type="button" data-trim="end">当前位置设为出点</button><button type="button" data-trim="preview">播放裁切片段</button></div>
    <label>入点 <output id="mix-trim-start-label"></output><input id="mix-trim-start" type="range" min="0" step="0.01" aria-label="裁切入点"></label>
    <label>出点 <output id="mix-trim-end-label"></output><input id="mix-trim-end" type="range" min="0" step="0.01" aria-label="裁切出点"></label>
    <div class="mix-trim-presets"><span>快速保留</span><button type="button" data-trim="3">前 3 秒</button><button type="button" data-trim="5">前 5 秒</button><button type="button" data-trim="10">前 10 秒</button><button type="button" data-trim="reset">完整素材</button></div>
    <p id="mix-trim-summary" class="setting-hint" role="status"></p><p class="setting-hint">应用后用于新组合，已有队列保留加入时的裁切。</p>
    <div class="mix-trim-footer"><button type="button" class="button secondary" data-trim="close">取消</button><button type="button" class="button primary" data-trim="apply">应用裁切</button></div>`;
  root.append(trimDialog);
  const trimVideo = trimDialog.querySelector("video");
  const trimStart = trimDialog.querySelector("#mix-trim-start");
  const trimEnd = trimDialog.querySelector("#mix-trim-end");
  let trimming, trimURL, trimPlaying = false;
  function releaseTrim() {
    trimVideo.pause(); trimVideo.removeAttribute("src"); trimVideo.load();
    if (trimURL) URL.revokeObjectURL(trimURL);
    trimURL = null; trimming = null; trimPlaying = false;
  }
  function refreshTrim() {
    trimDialog.querySelector("#mix-trim-start-label").value = seconds(Number(trimStart.value));
    trimDialog.querySelector("#mix-trim-end-label").value = seconds(Number(trimEnd.value));
    trimDialog.querySelector("#mix-trim-summary").textContent = "保留 " + seconds(Number(trimEnd.value) - Number(trimStart.value));
  }
  function openTrim(group, assetId) {
    releaseTrim();
    const asset = session[group].find(a => a.id === assetId);
    if (!asset) return;
    trimming = { group, asset };
    trimStart.max = trimEnd.max = String(asset.duration);
    trimStart.value = String(asset.start); trimEnd.value = String(asset.end);
    trimDialog.querySelector("#mix-trim-name").textContent = asset.name;
    trimURL = URL.createObjectURL(asset.file); trimVideo.src = trimURL;
    refreshTrim(); trimDialog.showModal();
  }
  on(trimVideo, "loadedmetadata", () => { if (trimming) trimVideo.currentTime = Number(trimStart.value); });
  on(trimVideo, "timeupdate", () => {
    if (trimPlaying && trimVideo.currentTime >= Number(trimEnd.value)) {
      trimVideo.pause(); trimPlaying = false;
    }
  });
  on(trimDialog, "close", releaseTrim);
  addCleanup(() => { releaseTrim(); trimDialog.remove(); });
  for (const slider of [trimStart, trimEnd]) on(slider, "input", () => {
    if (!trimming) return;
    trimVideo.pause(); trimPlaying = false;
    const min = 1 / settings().fps;
    if (Number(trimEnd.value) - Number(trimStart.value) < min) {
      if (slider === trimStart) trimStart.value = String(Math.max(0, Number(trimEnd.value) - min));
      else trimEnd.value = String(Math.min(trimming.asset.duration, Number(trimStart.value) + min));
    }
    trimVideo.currentTime = Number(slider.value); refreshTrim();
  });
  on(trimDialog, "click", async (event) => {
    const action = event.target.closest("[data-trim]")?.dataset.trim;
    if (!action) return;
    if (action === "close") { trimDialog.close(); return; }
    if (!trimming) return;
    const asset = trimming.asset;
    if (action === "start" || action === "end") {
      const currentTime = trimVideo.currentTime;
      const start = action === "start" ? currentTime : Number(trimStart.value);
      const end = action === "end" ? currentTime : Number(trimEnd.value);
      if (end - start < 1 / settings().fps - 1e-8) { toast("出点需晚于入点，至少保留一帧。"); return; }
      trimStart.value = String(start); trimEnd.value = String(end);
    } else if (["3", "5", "10", "reset"].includes(action)) {
      trimStart.value = "0"; trimEnd.value = String(action === "reset" ? asset.duration : Math.min(asset.duration, Number(action)));
      trimVideo.pause(); trimVideo.currentTime = 0; trimPlaying = false;
    } else if (action === "preview") {
      trimVideo.currentTime = Number(trimStart.value); trimPlaying = true;
      try { await trimVideo.play(); } catch (error) { trimPlaying = false; errorToast(error); }
    } else if (action === "apply") {
      const start = Number(trimStart.value), end = Number(trimEnd.value);
      if (end - start < 1 / settings().fps - 1e-8 || start < 0 || end > asset.duration) { toast("请至少保留一帧的有效片段。"); return; }
      asset.start = start; asset.end = end;
      renderAssets(trimming.group); trimDialog.close(); toast("已应用裁切，请将新组合加入队列。");
    }
    refreshTrim();
  });

  const checkActive = (operationSignal) => {
    if (signal.aborted || operationSignal?.aborted) throw abortError();
  };

  function syncControls() {
    if (signal.aborted) return;
    $$(
      ".mix-settings input,.mix-settings select,.mix-settings button,.mix-queue button,.mix-queue input,.mix-list-toolbar button",
      root,
    ).forEach((element) => {
      element.disabled = locked();
    });
    const pending = session.queue.filter(
      (job) => job.selected && ["pending", "failed"].includes(job.status),
    );
    $("#mix-export").disabled = locked() || !pending.length;
    $("#mix-export-hint").textContent = loading
      ? `正在读取素材… ${loading} 组`
      : importingRecords
        ? "正在导入记录…"
        : pending.length
          ? `将生成 ${pending.length} 个视频${pending.length > 1 ? "，完成后打包为 ZIP" : ""}。`
          : "先添加组合，再勾选需要生成的任务。";
    $("#mix-mode-help").textContent = {
      single: "选择 1 个片头，搭配所有选中的成片。",
      all: "所有选中的片头与成片分别配对。",
      ordered: "按素材列表从上到下配对，两组选择数量需相同。",
    }[settings().mode];
    $("#mix-transition-duration").disabled = locked() || settings().transition === "none";
    $("#mix-download-all").hidden = !session.results.size;
    $("#mix-download-all").textContent =
      `下载已生成的 ${session.results.size} 个文件`;
    const mov = settings().format === "mov";
    $("#mix-alpha-control").hidden = !mov;
    $("#mix-bitrate").disabled = locked() || mov;
    $("#mix-background").disabled =
      locked() || (mov && settings().transparentBackground);
  }

  function renderAssets(group) {
    const assets = session[group];
    $("#mix-" + group + "-count").textContent =
      `${assets.filter((asset) => asset.selected).length} / ${assets.length} 已选`;
    $("#mix-" + group + "-list").innerHTML = assets.length
      ? assets
          .map(
            (asset) =>
              `<article class="mix-asset" data-mix-asset="${escape(asset.id)}" data-mix-group="${group}"><div class="mix-asset-heading"><input type="checkbox" data-mix-asset-field="selected" aria-label="选择 ${escape(asset.name)}" ${asset.selected ? "checked" : ""}><div class="mix-asset-title"><strong title="${escape(asset.name)}">${escape(asset.name)}</strong><small>${asset.width} × ${asset.height} · ${seconds(asset.duration)}</small></div><button type="button" class="mix-icon-button" data-mix-action="remove-asset" aria-label="移除 ${escape(asset.name)}">${icon("trash")}</button></div><button type="button" class="mix-trim-open" data-mix-action="trim-asset">快速裁切 · 预览与标记</button><div class="mix-asset-controls">${numberControl("start", "开始 / 秒", asset.start, `min="0" max="${asset.duration}" step="0.01"`)}${numberControl("end", "结束 / 秒", asset.end, `min="0" max="${asset.duration}" step="0.01"`)}${numberControl("volume", "音量 / 倍", asset.volume, 'min="0" max="2" step="0.1"')}</div></article>`,
          )
          .join("")
      : `<div class="mix-empty">还没有${group === "hooks" ? "片头" : "成片"}素材</div>`;
    const feedback = $("#mix-" + group + "-feedback");
    feedback.hidden = !imports[group].length;
    feedback.innerHTML = imports[group]
      .map((message) => `<p>${escape(message)}</p>`)
      .join("");
    syncControls();
  }

  function renderQueue() {
    if (signal.aborted) return;
    const generated = session.queue.filter(
      (job) => job.status === "generated",
    ).length;
    $("#mix-queue-count").textContent =
      `${session.queue.length} 个组合 · ${generated} 个已生成`;
    $("#mix-queue").innerHTML = session.queue.length
      ? session.queue
          .map(
            (job, index) =>
              `<article class="mix-job ${session.previewId === job.id ? "mix-job-active" : ""}" data-mix-job="${escape(job.id)}"><div class="mix-job-top"><input type="checkbox" data-mix-job-select aria-label="选择第 ${index + 1} 个组合" ${job.selected ? "checked" : ""}><button type="button" class="mix-job-preview" data-mix-action="preview" aria-label="预览 ${escape(job.hookName)} 和 ${escape(job.bodyName)}" ${session.previewId === job.id ? 'aria-current="true"' : ""}><span class="mix-job-number">${String(index + 1).padStart(2, "0")}</span><span class="mix-job-names"><strong title="${escape(job.hookName)}">${escape(job.hookName)}</strong><span title="${escape(job.bodyName)}">→ ${escape(job.bodyName)}</span></span></button><span class="mix-status mix-status-${job.status}">${statusLabel[job.status]}</span><button type="button" class="mix-icon-button" data-mix-action="remove-job" aria-label="移除第 ${index + 1} 个组合">${icon("close")}</button></div><div class="mix-job-bottom"><span>${seconds(job.duration)} · ${job.settings.width} × ${job.settings.height} · ${job.settings.fps} fps · ${job.settings.format.toUpperCase()}${job.settings.transition && job.settings.transition !== "none" ? ` · ${{black:"淡黑",white:"淡白",blur:"柔焦"}[job.settings.transition]} ${job.settings.transitionDuration} 秒` : ""}</span>${session.results.has(job.id) ? `<button type="button" data-mix-action="download-job">${icon("download")}下载文件</button>` : ""}</div>${job.error ? `<p class="mix-job-error" role="status">${escape(job.error)}</p>` : ""}</article>`,
          )
          .join("")
      : '<div class="mix-empty mix-empty-large">导入片头和成片，添加第一组组合。<br>点击队列中的组合可预览衔接效果。</div>';
    $("#mix-summary").hidden = !session.summary;
    $("#mix-summary").textContent = session.summary;
    syncControls();
  }

  function saveRecords() {
    records = normalizeMixRecords(records).slice(0, 500);
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
      storageWarning = "";
    } catch {
      storageWarning = "浏览器无法保存制作记录，请导出记录 JSON 以免丢失。";
    }
  }

  function renderRecords() {
    if (signal.aborted) return;
    $("#mix-record-count").textContent = `${records.length} 条本地记录`;
    $("#mix-storage-warning").hidden = !storageWarning;
    $("#mix-storage-warning").textContent = storageWarning;
    $("#mix-records").innerHTML = records.length
      ? records
          .slice(0, 50)
          .map(
            (record, index) =>
              `<article class="mix-record" data-mix-record-index="${index}"><div class="mix-record-main"><strong title="${escape(record.outputName || `${record.hookName} → ${record.bodyName}`)}">${escape(record.outputName || `${record.hookName} → ${record.bodyName}`)}</strong><span>${escape(record.hookName)} → ${escape(record.bodyName)}</span><small>${new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false })}</small></div><div class="mix-record-actions"><span class="mix-status mix-status-${record.status}">${statusLabel[record.status]}</span>${record.status === "generated" ? '<button type="button" data-mix-action="complete-record">标为完成</button>' : ""}<button type="button" class="mix-icon-button" data-mix-action="remove-record" aria-label="删除记录">${icon("trash")}</button></div></article>`,
          )
          .join("")
      : '<div class="mix-empty">生成视频后，制作记录会出现在这里。</div>';
  }

  function recordJob(job, status, outputName = "") {
    const previous = records.find((record) => record.key === job.key);
    if (
      status === "failed" &&
      previous &&
      ["generated", "completed"].includes(previous.status)
    )
      return;
    records = [
      {
        key: job.key,
        hookName: job.hookName,
        bodyName: job.bodyName,
        outputName,
        status,
        createdAt: new Date().toISOString(),
      },
      ...records.filter((record) => record.key !== job.key),
    ];
    saveRecords();
    renderRecords();
  }

  async function previewJob(job) {
    session.previewId = job?.id || null;
    renderQueue();
    if (!job) {
      preview.clear();
      return;
    }
    try {
      await preview.setPair(job.hook, job.body, job.settings);
    } catch (error) {
      if (!signal.aborted && error.name !== "AbortError") errorToast(error);
    }
  }

  async function addFiles(group, files) {
    if (busy || importingRecords || signal.aborted) return;
    loading++;
    imports[group] = [];
    syncControls();
    const added = [];
    const pendingKeys = [];
    let duplicates = 0;
    try {
      for (const file of files) {
        checkActive();
        const key = mixAssetKey(file);
        if (
          session[group].some((asset) => asset.key === key) ||
          loadingKeys[group].has(key)
        ) {
          duplicates++;
          continue;
        }
        if (
          !file.type.startsWith("video/") &&
          !/\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(file.name)
        ) {
          imports[group].push(`${file.name}：请选择视频文件。`);
          continue;
        }
        loadingKeys[group].add(key);
        pendingKeys.push(key);
        let video;
        try {
          video = await loadVideo(file, { signal });
          checkActive();
          added.push({
            id: id(),
            key,
            name: file.name,
            file,
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            start: 0,
            end: video.duration,
            volume: 1,
            selected: true,
          });
        } catch (error) {
          if (signal.aborted || error.name === "AbortError") throw error;
          imports[group].push(
            `${file.name}：${error.message || "视频读取失败。"}`,
          );
        } finally {
          if (video) disposeVideo(video);
        }
      }
      const additions = added.filter(({ key }) => !session[group].some((asset) => asset.key === key));
      duplicates += added.length - additions.length;
      if (additions.length) recordEdit(() => session[group].push(...additions));
      if (additions.length || duplicates)
        imports[group].unshift(
          `已添加 ${additions.length} 个素材${duplicates ? `，跳过 ${duplicates} 个重复文件` : ""}。`,
        );
    } catch (error) {
      if (!signal.aborted && error.name !== "AbortError") errorToast(error);
    } finally {
      for (const key of pendingKeys) loadingKeys[group].delete(key);
      loading--;
      if (!signal.aborted) renderAssets(group);
    }
  }

  function buildQueue() {
    if (locked()) return;
    try {
      const built = buildMixQueue(
        session.hooks,
        session.bodies,
        settings(),
        records,
      );
      const existingKeys = new Set(session.queue.map((job) => job.key));
      let skipped = built.skipped;
      const additions = built.jobs.filter((job) => {
        if (settings().skipCompleted && existingKeys.has(job.key)) {
          skipped++;
          return false;
        }
        return true;
      });
      const pending = session.queue.filter(
        (job) => job.status !== "generated",
      ).length;
      if (pending + additions.length > 50)
        throw new Error(
          `当前有 ${pending} 条待处理任务，本次将新增 ${additions.length} 条。请减少选择或先移除部分队列，一次最多 50 条。`,
        );
      for (const job of additions) {
        const hook = session.hooks.find((asset) => asset.id === job.hookId);
        const body = session.bodies.find((asset) => asset.id === job.bodyId);
        session.queue.push({
          ...job,
          id: id(),
          hook: { ...hook },
          body: { ...body },
          settings: { ...settings() },
          selected: true,
          error: "",
        });
      }
      session.summary = `已添加 ${additions.length} 个组合${skipped ? `，跳过 ${skipped} 个已记录或已在队列中的组合` : ""}。`;
      renderQueue();
      if (!session.previewId && session.queue.length)
        previewJob(session.queue[0]);
    } catch (error) {
      session.summary = error.message || "无法生成组合，请检查素材选择。";
      renderQueue();
      errorToast(error);
    }
  }

  function removeJobs(ids) {
    const removed = new Set(ids);
    for (const jobId of removed) session.results.delete(jobId);
    session.queue = session.queue.filter((job) => !removed.has(job.id));
    if (removed.has(session.previewId)) previewJob(session.queue[0]);
    renderQueue();
  }

  async function downloadResults(results, operationSignal, update) {
    checkActive(operationSignal);
    if (!results.length) throw new Error("当前没有可下载的文件。");
    if (results.length === 1) {
      download(results[0].blob, results[0].name);
      return;
    }
    const archive = await zipFiles(results, {
      signal: operationSignal,
      onProgress: (progress) =>
        update(
          progress,
          `正在打包 ${results.length} 个视频 · ${Math.round(progress * 100)}%`,
        ),
    });
    checkActive(operationSignal);
    download(
      archive,
      `${safeName(settings().prefix) || "QS_混剪"}_视频合集.zip`,
    );
  }

  async function withOperation(title, action) {
    if (locked() || signal.aborted) return;
    busy = true;
    preview.pause();
    syncControls();
    try {
      await runOperation(title, async (operationSignal, update) => {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal.addEventListener("abort", cancel, { once: true });
        operationSignal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted || operationSignal.aborted) cancel();
        try {
          await action(controller.signal, update);
        } finally {
          signal.removeEventListener("abort", cancel);
          operationSignal.removeEventListener("abort", cancel);
        }
      });
    } finally {
      busy = false;
      if (!signal.aborted) {
        renderQueue();
        renderRecords();
      }
    }
  }

  function exportQueue() {
    const jobs = session.queue.filter(
      (job) => job.selected && ["pending", "failed"].includes(job.status),
    );
    if (!jobs.length || locked()) return;
    const finishEdit = beginUndoEdit();
    withOperation("正在生成混剪视频", async (operationSignal, update) => {
      const completed = [],
        failures = [];
      const names = new Set(
        [...session.results.values()].map((result) =>
          result.name.toLowerCase(),
        ),
      );
      let current;
      session.summary = `正在生成 ${jobs.length} 个组合…`;
      try {
        for (let index = 0; index < jobs.length; index++) {
          checkActive(operationSignal);
          const job = jobs[index];
          current = job;
          job.status = "generating";
          job.error = "";
          renderQueue();
          try {
            const blob = await joinVideos(
              [job.hook, job.body].map(({ file, start, end, volume }) => ({
                file,
                start,
                end,
                volume,
              })),
              {
                ...job.settings,
                signal: operationSignal,
                onProgress: (progress, stage) =>
                  update(
                    (index + progress) / jobs.length,
                    `${index + 1} / ${jobs.length} · ${stage || "正在拼接"} · ${Math.round(progress * 100)}%`,
                  ),
              },
            );
            checkActive(operationSignal);
            const base = `${safeName(job.settings.prefix).slice(0, 60) || "QS_混剪"}_${stem(job.hookName)}_${stem(job.bodyName)}`;
            let name = videoFilename(base, job.settings.format),
              suffix = 2;
            while (names.has(name.toLowerCase()))
              name = videoFilename(`${base}_${suffix++}`, job.settings.format);
            names.add(name.toLowerCase());
            const result = { name, blob };
            session.results.set(job.id, result);
            completed.push(result);
            job.status = "generated";
            job.selected = false;
            recordJob(job, "generated", name);
          } catch (error) {
            if (
              operationSignal.aborted ||
              signal.aborted ||
              error.name === "AbortError"
            )
              throw error;
            job.status = "failed";
            job.error = error.message || "视频生成失败，请检查素材编码。";
            failures.push(job);
            recordJob(job, "failed");
          }
          renderQueue();
        }
        session.summary = `本批次完成：${completed.length} 个成功，${failures.length} 个失败。${failures.length ? "失败原因见对应组合，可重新勾选后重试。" : ""}`;
        if (!completed.length)
          throw new Error(
            "本批次没有生成视频，请查看队列中每条任务的失败原因。",
          );
        await downloadResults(completed, operationSignal, update);
      } catch (error) {
        if (
          operationSignal.aborted ||
          signal.aborted ||
          error.name === "AbortError"
        ) {
          if (current?.status === "generating") {
            current.status = "pending";
            current.error = "本次已取消，可重新生成。";
          }
          session.summary = `已取消本批次，保留 ${completed.length} 个已生成文件。未自动下载，可使用队列下载按钮保存。`;
        } else if (completed.length)
          session.summary = `已生成 ${completed.length} 个视频，下载未完成：${error.message || "请重试下载。"} 可以从队列重新下载。`;
        throw error;
      } finally {
        finishEdit();
        renderQueue();
      }
    });
  }

  on(root, "change", (event) => {
    if (locked()) return;
    const element = event.target;
    const assetRow = element.closest("[data-mix-asset]");
    if (assetRow && element.dataset.mixAssetField) {
      const group = assetRow.dataset.mixGroup;
      const asset = session[group].find(
        (item) => item.id === assetRow.dataset.mixAsset,
      );
      const key = element.dataset.mixAssetField;
      if (key === "selected") asset.selected = element.checked;
      else {
        const value = Number(element.value);
        const next = { ...asset, [key]: value };
        if (
          !element.value.trim() ||
          !Number.isFinite(value) ||
          next.start < 0 ||
          next.end > asset.duration ||
          next.end - next.start < 1 / settings().fps - 1e-8 ||
          next.volume < 0 ||
          next.volume > 2
        ) {
          toast(
            `请设置有效起止时间（至少保留 ${(1 / settings().fps).toFixed(4)} 秒），音量范围为 0–2 倍。`,
          );
        } else asset[key] = Number(value.toFixed(3));
      }
      renderAssets(group);
      return;
    }
    if (element.matches("[data-mix-job-select]")) {
      const job = session.queue.find(
        (item) => item.id === element.closest("[data-mix-job]").dataset.mixJob,
      );
      if (job) job.selected = element.checked;
      syncControls();
      return;
    }
    if (element.dataset.mixSetting || element.id === "mix-resolution") {
      const next = { ...settings() };
      if (element.id === "mix-resolution")
        [next.width, next.height] = element.value.split("x").map(Number);
      else
        next[element.dataset.mixSetting] =
          element.type === "checkbox" ? element.checked : element.value;
      try { session.settings = normalizeMixSettings(next); }
      catch (error) {
        errorToast(error);
        if (element.dataset.mixSetting) element.value = settings()[element.dataset.mixSetting];
        syncControls(); return;
      }
      if (element.dataset.mixSetting) {
        if (element.type === "checkbox")
          element.checked = settings()[element.dataset.mixSetting];
        else element.value = settings()[element.dataset.mixSetting];
      }
      syncControls();
    }
  });

  for (const group of ["hooks", "bodies"])
    on($(`#mix-${group}-files`), "change", (event) => {
      const files = [...event.target.files];
      event.target.value = "";
      if (files.length) addFiles(group, files);
    });

  on($("#mix-record-file"), "change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || locked()) return;
    const revision = ++recordRevision;
    importingRecords = true;
    syncControls();
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("记录文件过大，请选择小于 5 MB 的 JSON。");
      const value = JSON.parse(await file.text());
      checkActive();
      if (revision !== recordRevision) return;
      const list = Array.isArray(value)
        ? value
        : value?.type === "frame-mix-records"
          ? value.records
          : null;
      if (!Array.isArray(list)) throw new Error("这不是有效的混剪记录文件。");
      const imported = normalizeMixRecords(list);
      if (list.length && !imported.length)
        throw new Error("没有有效的制作记录，请检查文件格式。");
      const merged = [...imported, ...records].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
      const seen = new Set();
      recordEdit(() => {
        records = merged
          .filter((record) => {
            if (seen.has(record.key)) return false;
            seen.add(record.key);
            return true;
          })
          .slice(0, 500);
        saveRecords();
        renderRecords();
      });
      toast(
        `已导入 ${imported.length} 条有效记录${list.length > imported.length ? `，忽略 ${list.length - imported.length} 条无效或超出上限的记录` : ""}。`,
      );
    } catch (error) {
      if (!signal.aborted && error.name !== "AbortError") errorToast(error);
    } finally {
      if (revision === recordRevision) importingRecords = false;
      syncControls();
    }
  });

  on(root, "click", (event) => {
    const button = event.target.closest("[data-mix-action]");
    if (!button || locked()) return;
    const action = button.dataset.mixAction;
    const assetRow = button.closest("[data-mix-asset]");
    const jobId = button.closest("[data-mix-job]")?.dataset.mixJob;
    const recordIndex = Number(
      button.closest("[data-mix-record-index]")?.dataset.mixRecordIndex,
    );
    if (action === "select-assets" || action === "clear-selection") {
      const group = button.dataset.mixGroup;
      session[group].forEach((asset) => {
        asset.selected = action === "select-assets";
      });
      renderAssets(group);
    }
    if (action === "trim-asset") openTrim(assetRow.dataset.mixGroup, assetRow.dataset.mixAsset);
    if (action === "remove-asset") {
      const group = assetRow.dataset.mixGroup;
      session[group] = session[group].filter(
        (asset) => asset.id !== assetRow.dataset.mixAsset,
      );
      renderAssets(group);
    }
    if (action === "build") buildQueue();
    if (action === "preview")
      previewJob(session.queue.find((job) => job.id === jobId));
    if (action === "select-queue") {
      session.queue.forEach((job) => {
        job.selected = ["pending", "failed"].includes(job.status);
      });
      renderQueue();
    }
    if (action === "remove-job") removeJobs([jobId]);
    if (action === "remove-queue")
      removeJobs(
        session.queue.filter((job) => job.selected).map((job) => job.id),
      );
    if (action === "export") queueMicrotask(exportQueue);
    if (action === "download-job") {
      const result = session.results.get(jobId);
      if (result) download(result.blob, result.name);
    }
    if (action === "download-all")
      withOperation("正在下载混剪视频", (operationSignal, update) =>
        downloadResults([...session.results.values()], operationSignal, update),
      );
    if (action === "complete-record" && records[recordIndex]) {
      records[recordIndex].status = "completed";
      saveRecords();
      renderRecords();
    }
    if (action === "remove-record" && records[recordIndex]) {
      records.splice(recordIndex, 1);
      saveRecords();
      renderRecords();
    }
    if (action === "export-records")
      download(
        new Blob(
          [
            JSON.stringify(
              { type: "frame-mix-records", version: 1, records },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
        "QS_混剪制作记录.json",
      );
    if (action === "import-records") $("#mix-record-file").click();
  });

  addCleanup(() => {
    recordRevision++;
    preview.pause();
    preview.clear();
  });
  renderAssets("hooks");
  renderAssets("bodies");
  renderQueue();
  renderRecords();
  const initialJob =
    session.queue.find((job) => job.id === session.previewId) ||
    session.queue[0];
  if (initialJob) previewJob(initialJob);
  registerUndo({
    capture: () => ({ session, records }),
    restore(state) {
      trimDialog.close();
      Object.assign(session, state.session);
      records = state.records;
      saveRecords();
      for (const control of $$("[data-mix-setting]", root)) {
        const value = settings()[control.dataset.mixSetting];
        if (control.type === "checkbox") control.checked = value;
        else control.value = value;
      }
      $("#mix-resolution").value = `${settings().width}x${settings().height}`;
      renderAssets("hooks");
      renderAssets("bodies");
      renderRecords();
      previewJob(session.queue.find((job) => job.id === session.previewId));
    },
  });
}
