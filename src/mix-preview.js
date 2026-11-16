import { loadVideo, disposeVideo } from "./video.js";

const roundedTime = (seconds) => Math.round(seconds * 1000000) / 1000000;
const timeText = (seconds) => {
  const value = Math.max(0, Math.round(seconds * 10));
  return `${String(Math.floor(value / 600)).padStart(2, "0")}:${((value % 600) / 10).toFixed(1).padStart(4, "0")}`;
};

export function mixPreviewMarkup(icon) {
  return `<div id="mix-preview" class="mix-preview">
    <div class="preview-surface mix-preview-surface"><canvas id="mix-canvas" width="720" height="1280" aria-label="拼接视频预览" hidden></canvas><div id="mix-preview-empty" class="preview-empty">${icon("video")}<h3>片头 + 成片，接住下一秒</h3><p>添加两组素材并选择组合，即可预览衔接。</p></div></div>
    <div class="preview-caption"><span id="mix-preview-info">选择一个组合开始预览</span><span id="mix-preview-stage"></span></div>
    <section class="preview-timeline" aria-label="拼接预览时间线"><div class="timeline-heading"><strong>衔接预览</strong><span>支持原声与拖动定位</span></div>
    <div class="timeline-transport"><button type="button" id="mix-play" class="timeline-play" aria-label="播放拼接预览" disabled>${icon("play")}<span>播放</span></button><button type="button" id="mix-restart" class="timeline-restart" aria-label="回到片头" disabled>${icon("rewind")}</button><div class="timeline-clock"><output id="mix-clock">00:00.0 / 00:00.0</output></div></div>
    <input id="mix-seek" class="timeline-seek" type="range" min="0" max="1" step="any" value="0" aria-label="拼接预览进度" disabled>
    <div id="mix-segments" class="timeline-segments"><button type="button" class="timeline-segment" data-mix-segment="0" disabled>片头</button><button type="button" class="timeline-segment" data-mix-segment="1" disabled>成片</button></div><p id="mix-preview-status" class="setting-hint" role="status"></p></section></div>`;
}

function seekVideo(video, time, signal) {
  if (signal.aborted)
    return Promise.reject(new DOMException("已取消预览", "AbortError"));
  const target = Math.min(
    Math.max(0, time),
    Math.max(0, video.duration - 0.0001),
  );
  if (
    !video.seeking &&
    Math.abs(video.currentTime - target) < 0.0001 &&
    video.readyState >= 2
  )
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", ready);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", cancelled);
    };
    const ready = () => {
      if (video.seeking || Math.abs(video.currentTime - target) > 0.05) return;
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("无法定位视频画面，请检查源文件是否完整。"));
    };
    const cancelled = () => {
      cleanup();
      reject(new DOMException("已取消预览", "AbortError"));
    };
    const timer = setTimeout(failed, 15000);
    video.addEventListener("seeked", ready);
    video.addEventListener("error", failed);
    signal.addEventListener("abort", cancelled, { once: true });
    try {
      video.currentTime = target;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function resumeAudio(context, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancelled);
    };
    const cancelled = () => {
      cleanup();
      reject(new DOMException("已取消预览", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("浏览器暂停了原声播放，请重新点击播放。"));
    }, 6000);
    signal.addEventListener("abort", cancelled, { once: true });
    if (signal.aborted) {
      cancelled();
      return;
    }
    context.resume().then(
      () => {
        cleanup();
        if (signal.aborted)
          reject(new DOMException("已取消预览", "AbortError"));
        else resolve();
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** Native video clocks drive preview; export uses the same clips and canvas fit settings. */
export function createMixPreview({ on, signal, addCleanup, errorToast, icon }) {
  const root = document.querySelector("#mix-preview");
  const $ = (selector) => root.querySelector(selector);
  const canvas = $("#mix-canvas");
  const ctx = canvas.getContext("2d");
  const playButton = $("#mix-play");
  const slider = $("#mix-seek");
  const segmentButtons = [...root.querySelectorAll("[data-mix-segment]")];
  let clips = [],
    videos = [],
    config = {},
    current = 0,
    playing = false,
    starting = false;
  let frame = 0,
    revision = 0,
    playRevision = 0,
    loading = false;
  let loadController, seekController, audioContext;
  let disposed = false,
    audioClosing = Promise.resolve();
  const audioNodes = new Map();
  const total = () =>
    roundedTime(clips.reduce((sum, clip) => sum + clip.end - clip.start, 0));
  const firstDuration = () =>
    clips[0] ? roundedTime(clips[0].end - clips[0].start) : 0;
  const ready = () =>
    !disposed &&
    !signal.aborted &&
    !loading &&
    videos.length === 2 &&
    clips.length === 2;
  const position = (time) => {
    const index = time >= firstDuration() ? 1 : 0;
    const offset = index ? firstDuration() : 0;
    const clip = clips[index];
    return {
      index,
      offset,
      sourceTime: Math.min(
        clip.end - 0.0001,
        clip.start + Math.max(0, time - offset),
      ),
    };
  };

  function refresh() {
    const duration = total();
    slider.max = String(duration || 1);
    slider.value = String(roundedTime(current));
    slider.style.setProperty(
      "--played",
      `${duration ? (current / duration) * 100 : 0}%`,
    );
    slider.setAttribute(
      "aria-valuetext",
      `${timeText(current)}，共${timeText(duration)}`,
    );
    $("#mix-clock").value = `${timeText(current)} / ${timeText(duration)}`;
    const active = playing || starting;
    playButton.innerHTML = `${icon(active ? "pause" : "play")}<span>${active ? "暂停" : "播放"}</span>`;
    playButton.setAttribute("aria-pressed", String(active));
    playButton.setAttribute(
      "aria-label",
      active ? "暂停拼接预览" : "播放拼接预览",
    );
    [playButton, slider, $("#mix-restart"), ...segmentButtons].forEach((el) => {
      el.disabled = !ready();
    });
    segmentButtons.forEach((button, index) => {
      const length = clips[index] ? clips[index].end - clips[index].start : 0;
      button.style.flex = String(length || 1);
      button.textContent = `${index ? "成片" : "片头"}${length ? ` · ${timeText(length)}` : ""}`;
      button.classList.toggle(
        "active",
        ready() && position(current).index === index,
      );
    });
    $("#mix-preview-stage").textContent = ready()
      ? position(current).index
        ? "成片"
        : "片头"
      : "";
  }

  function paint(index) {
    if (!videos[index] || signal.aborted) return;
    const video = videos[index];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!(config.format === "mov" && config.transparentBackground)) {
      ctx.fillStyle = config.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const ratio = (config.fit === "cover" ? Math.max : Math.min)(
      canvas.width / video.videoWidth,
      canvas.height / video.videoHeight,
    );
    const width = video.videoWidth * ratio,
      height = video.videoHeight * ratio;
    ctx.drawImage(
      video,
      (canvas.width - width) / 2,
      (canvas.height - height) / 2,
      width,
      height,
    );
    canvas.hidden = false;
    $("#mix-preview-empty").hidden = true;
  }

  function pause(cancelPendingSeek = false) {
    const cancel = cancelPendingSeek === true || playing || starting;
    playRevision++;
    cancelAnimationFrame(frame);
    playing = false;
    starting = false;
    videos.forEach((video) => video.pause());
    // A passive pause (for example while exporting) must let an initial still-frame
    // seek finish. A replacement seek, new pair, or active playback cancels it.
    if (cancel) seekController?.abort();
    refresh();
  }

  function fail(error) {
    if (disposed || signal.aborted || error.name === "AbortError") return;
    pause(true);
    $("#mix-preview-status").textContent =
      error.message || "预览失败，请重新选择组合。";
    errorToast(error);
  }

  async function seek(time) {
    pause(true);
    if (!ready()) return;
    const epoch = revision;
    const controller = new AbortController();
    seekController = controller;
    current = Math.max(0, Math.min(total(), Number(time) || 0));
    const target = position(current);
    refresh();
    try {
      await seekVideo(
        videos[target.index],
        target.sourceTime,
        controller.signal,
      );
      if (controller.signal.aborted || signal.aborted || epoch !== revision)
        return;
      paint(target.index);
      $("#mix-preview-status").textContent = "";
    } catch (error) {
      if (
        epoch === revision &&
        seekController === controller &&
        !controller.signal.aborted
      )
        fail(error);
    }
  }

  async function prepareAudio(playSignal) {
    const AudioContextClass =
      globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass)
      throw new Error("当前浏览器无法预览原声，请使用新版 Chrome 或 Edge。");
    if (!audioContext) audioContext = new AudioContextClass();
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      let nodes = audioNodes.get(video);
      if (!nodes) {
        const source = audioContext.createMediaElementSource(video);
        const gain = audioContext.createGain();
        source.connect(gain).connect(audioContext.destination);
        nodes = { source, gain };
        audioNodes.set(video, nodes);
      }
      nodes.gain.gain.value = clips[i].volume;
      video.muted = false;
      video.volume = 1;
    }
    await resumeAudio(audioContext, playSignal);
  }

  async function play() {
    if (!ready()) return;
    pause(true);
    if (current >= total() - 0.001) current = 0;
    const epoch = ++playRevision;
    const controller = new AbortController();
    seekController = controller;
    const playFailed = (error) => {
      if (
        epoch === playRevision &&
        seekController === controller &&
        !controller.signal.aborted
      )
        fail(error);
    };
    starting = true;
    refresh();
    try {
      await prepareAudio(controller.signal);
      if (epoch !== playRevision || signal.aborted) return;
      const initial = position(current);
      // Prepare the second clip before starting, so the seam does not wait for a seek.
      if (initial.index === 0)
        await seekVideo(videos[1], clips[1].start, controller.signal);
      await seekVideo(
        videos[initial.index],
        initial.sourceTime,
        controller.signal,
      );
      if (epoch !== playRevision || signal.aborted) return;
      starting = false;
      playing = true;
      $("#mix-preview-status").textContent = "";
      const startClip = async (index) => {
        const video = videos[index];
        await video.play();
        if (epoch !== playRevision || signal.aborted) {
          video.pause();
          return;
        }
        paint(index);
        refresh();
        const tick = () => {
          if (!playing || epoch !== playRevision || signal.aborted) return;
          const clip = clips[index];
          const offset = index ? firstDuration() : 0;
          current = Math.min(
            offset + clip.end - clip.start,
            offset + Math.max(0, video.currentTime - clip.start),
          );
          paint(index);
          refresh();
          if (video.ended || video.currentTime >= clip.end - 0.015) {
            video.pause();
            if (index === 0) {
              current = firstDuration();
              void startClip(1).catch(playFailed);
            } else {
              current = total();
              pause();
            }
            return;
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      };
      await startClip(initial.index);
    } catch (error) {
      playFailed(error);
    }
  }

  function releaseVideos() {
    videos.forEach((video) => {
      const nodes = audioNodes.get(video);
      nodes?.source.disconnect();
      nodes?.gain.disconnect();
      audioNodes.delete(video);
      disposeVideo(video);
    });
    videos = [];
  }

  function clear() {
    revision++;
    pause(true);
    loadController?.abort();
    releaseVideos();
    clips = [];
    current = 0;
    loading = false;
    canvas.hidden = true;
    $("#mix-preview-empty").hidden = false;
    $("#mix-preview-info").textContent = "选择一个组合开始预览";
    $("#mix-preview-status").textContent = "";
    refresh();
  }

  async function setPair(hook, body, settings) {
    if (disposed || signal.aborted) return;
    if (!hook?.file || !body?.file) {
      clear();
      return;
    }
    const next = [hook, body].map((clip) => ({ ...clip }));
    if (
      next.some(
        (clip) =>
          !Number.isFinite(clip.start) ||
          !Number.isFinite(clip.end) ||
          clip.start < 0 ||
          clip.end <= clip.start ||
          clip.end > clip.duration + 0.0001,
      )
    ) {
      clear();
      $("#mix-preview-status").textContent = "请先设置有效的截取范围。";
      return;
    }
    const sameFiles =
      ready() && clips.every((clip, index) => clip.file === next[index].file);
    pause(true);
    const epoch = ++revision;
    config = { ...settings };
    canvas.width = settings.width;
    canvas.height = settings.height;
    clips = next;
    $("#mix-preview-info").textContent =
      `${settings.width} × ${settings.height} · ${timeText(total())}`;
    if (sameFiles) {
      await seek(Math.min(current, total()));
      return;
    }
    loadController?.abort();
    releaseVideos();
    const controller = new AbortController();
    loadController = controller;
    const cancelLoad = () => controller.abort();
    signal.addEventListener("abort", cancelLoad, { once: true });
    loading = true;
    current = 0;
    canvas.hidden = true;
    $("#mix-preview-empty").hidden = false;
    $("#mix-preview-status").textContent = "正在读取预览…";
    refresh();
    const loaded = [];
    try {
      for (const clip of next)
        loaded.push(await loadVideo(clip.file, { signal: controller.signal }));
      if (signal.aborted || controller.signal.aborted || epoch !== revision) {
        loaded.forEach(disposeVideo);
        return;
      }
      videos = loaded;
      loading = false;
      await seek(0);
    } catch (error) {
      loaded.forEach(disposeVideo);
      if (epoch === revision) {
        loading = false;
        fail(error);
      }
    } finally {
      signal.removeEventListener("abort", cancelLoad);
    }
  }

  on(playButton, "click", () => (playing || starting ? pause() : void play()));
  on($("#mix-restart"), "click", () => void seek(0));
  on(slider, "pointerdown", pause);
  on(slider, "input", () => void seek(Number(slider.value)));
  segmentButtons.forEach((button, index) =>
    on(button, "click", () => void seek(index ? firstDuration() : 0)),
  );
  on(document, "keydown", (event) => {
    if (
      event.code !== "Space" ||
      event.repeat ||
      event.target.closest(
        "input,textarea,select,button,a,[contenteditable]",
      ) ||
      document.querySelector(".processing-overlay,dialog[open]")
    )
      return;
    event.preventDefault();
    playing || starting ? pause() : void play();
  });
  const dispose = () => {
    if (disposed) return audioClosing;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    clear();
    const context = audioContext;
    audioContext = null;
    audioClosing = context
      ? context.close().catch(() => {})
      : Promise.resolve();
    return audioClosing;
  };
  signal.addEventListener("abort", dispose, { once: true });
  addCleanup(dispose);
  refresh();
  return { setPair, pause, seek, clear, dispose };
}
