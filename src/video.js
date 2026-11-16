import { convertVideoBlob, exportCanvasVideo } from "./video-export.js";

const videoResources = new WeakMap();

function abortError() {
  return new DOMException("已取消视频导出", "AbortError");
}

function waitForAudio(promise, signal) {
  return new Promise((resolve, reject) => {
    const clear = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancelled);
    };
    const cancelled = () => {
      clear();
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      clear();
      reject(new Error("浏览器未允许声音处理，请重新点击导出并允许音频播放。"));
    }, 6000);
    signal?.addEventListener("abort", cancelled, { once: true });
    if (signal?.aborted) {
      cancelled();
      return;
    }
    promise.then(
      (value) => {
        clear();
        resolve(value);
      },
      (error) => {
        clear();
        reject(error);
      },
    );
  });
}

/** Load a local video with a decoded first frame; the caller owns disposal. */
export function loadVideo(file, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  videoResources.set(video, url);
  video.preload = "auto";
  video.playsInline = true;
  video.muted = true;
  video.src = url;

  return new Promise((resolve, reject) => {
    let probingDuration = false;
    const cleanListeners = () => {
      clearTimeout(timeout);
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("durationchange", ready);
      video.removeEventListener("seeked", ready);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", cancelled);
    };
    const fail = (error) => {
      cleanListeners();
      disposeVideo(video);
      reject(error);
    };
    const ready = () => {
      if (video.readyState < 2) return;
      // MediaRecorder WebM files may omit duration metadata. Seeking to the end lets
      // the browser discover the actual duration, then restore the first frame.
      if (video.duration === Infinity) {
        if (!probingDuration) {
          probingDuration = true;
          video.currentTime = 1e10;
        }
        return;
      }
      if (
        !video.videoWidth ||
        !video.videoHeight ||
        !Number.isFinite(video.duration) ||
        video.duration <= 0
      ) {
        fail(
          new Error("无法读取视频画面或时长，请使用完整的 MP4 或 WebM 文件。"),
        );
        return;
      }
      if (probingDuration && video.currentTime > 0) {
        video.currentTime = 0;
        return;
      }
      cleanListeners();
      resolve(video);
    };
    const failed = () =>
      fail(
        new Error("浏览器无法解码这个视频，请尝试 H.264 MP4 或 WebM 文件。"),
      );
    const cancelled = () => fail(abortError());
    const timeout = setTimeout(
      () => fail(new Error("视频读取超时，请检查文件是否完整。")),
      30000,
    );
    video.addEventListener("loadeddata", ready);
    video.addEventListener("durationchange", ready);
    video.addEventListener("seeked", ready);
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", cancelled, { once: true });
    video.load();
  });
}

export function disposeVideo(video) {
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
  const url = videoResources.get(video);
  if (url) URL.revokeObjectURL(url);
  videoResources.delete(video);
}

/** Fit the original video at the center without stretching or cropping it. */
export function drawComposition(
  ctx,
  video,
  {
    width = 1280,
    height = 720,
    bgImage = null,
    bgColor = "#e8e6df",
    fit = 0.92,
    transparentBackground = false,
  } = {},
) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  if (!transparentBackground) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
  }
  if (bgImage && !transparentBackground) {
    const imageWidth = bgImage.naturalWidth || bgImage.width;
    const imageHeight = bgImage.naturalHeight || bgImage.height;
    if (imageWidth > 0 && imageHeight > 0) {
      const scale = Math.max(width / imageWidth, height / imageHeight);
      const w = imageWidth * scale;
      const h = imageHeight * scale;
      ctx.drawImage(bgImage, (width - w) / 2, (height - h) / 2, w, h);
    }
  }
  if (
    video &&
    video.readyState >= 2 &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  ) {
    const fraction = Math.min(1, Math.max(0.05, Number(fit) || 0.92));
    const scale = Math.min(
      width / video.videoWidth,
      (height * fraction) / video.videoHeight,
    );
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
  }
  ctx.restore();
}

/** Record a new WebM in real time, keeping audio through an isolated audio graph. */
async function recordCompositionWebM(file, options = {}) {
  const { width = 1280, height = 720, onProgress, signal } = options;
  if (signal?.aborted) throw abortError();
  if (
    typeof MediaRecorder === "undefined" ||
    !HTMLCanvasElement.prototype.captureStream
  ) {
    throw new Error("当前浏览器不支持视频导出，请使用最新版 Chrome 或 Edge。");
  }
  const mimeType = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType)
    throw new Error("当前浏览器不支持 WebM 录制，请使用 Chrome 或 Edge。");
  const AudioContextClass =
    globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass)
    throw new Error("当前浏览器不支持保留原声，请使用 Chrome 或 Edge。");

  let video;
  let stream;
  let destination;
  let source;
  let recorder;
  let frame = 0;
  let finishTimer;
  let stallTimer;
  // Create and resume immediately, while the export button still has user activation.
  const audioContext = new AudioContextClass();
  const resumeAudio = audioContext.resume();
  // Attach a handler immediately so a denied context cannot produce an unhandled rejection.
  resumeAudio.catch(() => {});

  try {
    video = await loadVideo(file, { signal });
    await waitForAudio(resumeAudio, signal);
    if (signal?.aborted) throw abortError();
    if (audioContext.state !== "running") {
      throw new Error("浏览器暂停了声音处理，请重新点击导出并允许音频播放。");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("无法创建视频画布，请刷新后重试。");
    source = audioContext.createMediaElementSource(video);
    destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    // Only the recording destination is connected, so export never plays through speakers.
    video.muted = false;
    video.volume = 1;
    drawComposition(ctx, video, { ...options, width, height });
    stream = canvas.captureStream(30);
    for (const track of destination.stream.getAudioTracks())
      stream.addTrack(track);
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: Math.max(
        2500000,
        Math.min(12000000, width * height * 5),
      ),
      audioBitsPerSecond: 128000,
    });

    const result = await new Promise((resolve, reject) => {
      const chunks = [];
      let settled = false;
      let finishing = false;
      let lastTime = 0;
      let lastAdvance = performance.now();
      const clear = () => {
        cancelAnimationFrame(frame);
        clearTimeout(finishTimer);
        clearInterval(stallTimer);
        signal?.removeEventListener("abort", cancelled);
        video.removeEventListener("ended", ended);
        video.removeEventListener("error", failed);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clear();
        video.pause();
        if (recorder.state !== "inactive") recorder.stop();
        reject(error);
      };
      const report = (progress) => {
        if (onProgress) onProgress(Math.min(1, Math.max(0, progress)));
      };
      const tick = () => {
        if (settled || finishing) return;
        try {
          drawComposition(ctx, video, { ...options, width, height });
          report(Math.min(0.999, video.currentTime / video.duration));
          frame = requestAnimationFrame(tick);
        } catch (error) {
          fail(error);
        }
      };
      const ended = () => {
        if (settled || finishing) return;
        finishing = true;
        cancelAnimationFrame(frame);
        try {
          drawComposition(ctx, video, { ...options, width, height });
          stream.getVideoTracks()[0]?.requestFrame?.();
          // Keep the final composition for two frame intervals before flushing the encoder.
          finishTimer = setTimeout(() => {
            if (recorder.state !== "inactive") recorder.stop();
          }, 80);
        } catch (error) {
          fail(error);
        }
      };
      const cancelled = () => fail(abortError());
      const failed = () => fail(new Error("视频播放中断，无法完成导出。"));
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener(
        "error",
        () => fail(new Error("视频录制失败，请降低分辨率后重试。")),
        { once: true },
      );
      recorder.addEventListener(
        "stop",
        () => {
          if (settled) return;
          settled = true;
          clear();
          const blob = new Blob(chunks, { type: mimeType });
          if (!blob.size) reject(new Error("未能生成视频数据，请重新导出。"));
          else {
            report(1);
            resolve(blob);
          }
        },
        { once: true },
      );
      video.addEventListener("ended", ended, { once: true });
      video.addEventListener("error", failed, { once: true });
      signal?.addEventListener("abort", cancelled, { once: true });
      if (signal?.aborted) {
        cancelled();
        return;
      }
      stallTimer = setInterval(() => {
        if (video.currentTime > lastTime) {
          lastTime = video.currentTime;
          lastAdvance = performance.now();
        } else if (!finishing && performance.now() - lastAdvance > 30000) {
          fail(new Error("视频播放长时间停滞，请保持页面打开并重试。"));
        }
      }, 1000);
      try {
        report(0);
        recorder.start(250);
        video
          .play()
          .then(tick)
          .catch(() =>
            fail(new Error("浏览器未允许播放视频，请重新点击导出。")),
          );
      } catch (error) {
        fail(error);
      }
    });
    return result;
  } finally {
    cancelAnimationFrame(frame);
    clearTimeout(finishTimer);
    clearInterval(stallTimer);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    destination?.stream.getTracks().forEach((track) => track.stop());
    source?.disconnect();
    if (video) disposeVideo(video);
    if (audioContext.state !== "closed")
      await audioContext.close().catch(() => {});
  }
}

async function seekCompositionFrame(video, time, signal) {
  if (signal?.aborted) throw abortError();
  const target = Math.min(time, Math.max(0, video.duration - 0.0001));
  if (!video.seeking && Math.abs(video.currentTime - target) < 0.0001) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("seeked", ready);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", cancel);
    };
    const ready = () => {
      if (video.seeking || Math.abs(video.currentTime - target) > 0.05) return;
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("视频帧读取失败，请检查源文件。"));
    };
    const cancel = () => {
      cleanup();
      reject(abortError());
    };
    const timeout = setTimeout(failed, 15000);
    video.addEventListener("seeked", ready);
    video.addEventListener("error", failed);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      video.currentTime = target;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Transparent composition is sampled into PNG frames before ProRes 4444 encoding. */
async function exportCompositionMov(file, options) {
  const video = await loadVideo(file, { signal: options.signal });
  const canvas = document.createElement("canvas");
  canvas.width = options.width || 1280;
  canvas.height = options.height || 720;
  const ctx = canvas.getContext("2d");
  try {
    return await exportCanvasVideo(
      canvas,
      async (time) => {
        await seekCompositionFrame(video, time, options.signal);
        drawComposition(ctx, video, {
          ...options,
          width: canvas.width,
          height: canvas.height,
        });
      },
      {
        ...options,
        format: "mov",
        duration: video.duration,
        fps: 30,
        audioBlob: file,
      },
    );
  } finally {
    disposeVideo(video);
    canvas.width = canvas.height = 1;
  }
}

/** MP4/WebM use browser codecs; MOV retains alpha through ProRes 4444 and PCM audio. */
export async function exportVideo(file, options = {}) {
  const {
    format = "mp4",
    onProgress,
    signal,
    width = 1280,
    height = 720,
  } = options;
  if (!["mp4", "mov", "webm"].includes(format))
    throw new Error("请选择 MP4、MOV 或 WebM 导出格式。");
  if (format === "mov") return exportCompositionMov(file, options);
  const needsConversion = format !== "webm";
  const blob = await recordCompositionWebM(file, {
    ...options,
    onProgress: (progress) =>
      onProgress?.(
        progress * (needsConversion ? 0.65 : 1),
        "正在合成画面与原声",
      ),
  });
  if (signal?.aborted) throw abortError();
  if (!needsConversion) return blob;
  return convertVideoBlob(blob, {
    format,
    fps: 30,
    videoBitsPerSecond: Math.max(
      2500000,
      Math.min(12000000, width * height * 5),
    ),
    signal,
    onProgress: (progress, stage) =>
      onProgress?.(0.65 + progress * 0.35, stage),
  });
}
