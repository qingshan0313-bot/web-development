import { recordCanvas } from "./media.js";
import { exportCanvasProRes, exportVideoProRes } from "./prores-export.js";

/** Shared format contract for all animation and video tools. */
export const VIDEO_FORMATS = Object.freeze([
  Object.freeze(["mp4", "MP4 · H.264"]),
  Object.freeze(["mov", "MOV · ProRes 4444 / Alpha"]),
  Object.freeze(["webm", "WebM · VP8/VP9"]),
]);

function requireFormat(format) {
  if (!VIDEO_FORMATS.some(([value]) => value === format))
    throw new Error("请选择 MP4、MOV 或 WebM 导出格式。");
  return format;
}

export function videoFilename(name, format) {
  requireFormat(format);
  const base = String(name || "Frame_视频").replace(/\.(mp4|mov|webm)$/i, "");
  return `${base}.${format}`;
}

function abortError() {
  return new DOMException("导出已取消。", "AbortError");
}
function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}
function mediaLibrary() {
  if (!globalThis.Mediabunny)
    throw new Error("视频编码组件未加载，请保留完整工具目录并刷新页面。");
  if (typeof VideoEncoder === "undefined")
    throw new Error(
      "当前浏览器不支持 H.264 导出，请使用新版 Chrome / Edge 打开本地页面或 HTTPS 网站，或选择 WebM。",
    );
  return globalThis.Mediabunny;
}
function createOutput(library) {
  const container = new library.Mp4OutputFormat({ fastStart: "in-memory" });
  return new library.Output({
    format: container,
    target: new library.BufferTarget(),
  });
}
function outputBlob(output) {
  if (!output.target.buffer?.byteLength)
    throw new Error("未生成视频数据，请重试。");
  return new Blob([output.target.buffer], { type: output.format.mimeType });
}
async function requireH264(
  library,
  { width, height, fps, videoBitsPerSecond },
  signal,
) {
  checkAbort(signal);
  const supported = await library.canEncodeVideo("avc", {
    width,
    height,
    frameRate: fps,
    quality: new library.Quality({ bitrate: videoBitsPerSecond }),
  });
  checkAbort(signal);
  if (!supported)
    throw new Error(
      "当前设备无法编码所选尺寸的 H.264 视频，请降低分辨率／帧率，或选择 WebM。",
    );
}

/** Deterministic fixed-frame H.264 rendering; WebM retains native real-time recording. */
export async function exportCanvasVideo(
  canvas,
  draw,
  {
    format = "mp4",
    duration = 3,
    fps = 30,
    videoBitsPerSecond = 6000000,
    audioBlob,
    onProgress,
    signal,
  } = {},
) {
  requireFormat(format);
  checkAbort(signal);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(fps) ||
    fps < 1 ||
    fps > 60 ||
    !Number.isFinite(videoBitsPerSecond) ||
    videoBitsPerSecond < 1000000 ||
    videoBitsPerSecond > 20000000
  )
    throw new Error("导出时长、帧率或码率无效。");
  // Decimal message holds can sum to 1.2000000000000002; don't add a whole extra frame.
  const frameCount = Math.max(1, Math.ceil(duration * fps - 1e-7));
  if (!Number.isSafeInteger(frameCount) || frameCount > 1000000)
    throw new Error("导出帧数超出单次处理范围，请缩短片段或降低帧率。");
  if (format === "mov")
    return exportCanvasProRes(canvas, draw, {
      duration,
      fps,
      audioBlob,
      signal,
      onProgress,
    });
  if (format === "webm")
    return recordCanvas(canvas, draw, {
      duration,
      fps,
      videoBitsPerSecond,
      signal,
      onProgress: (progress) => onProgress?.(progress, "正在录制 WebM"),
    });
  if (
    !canvas?.width ||
    !canvas?.height ||
    canvas.width % 2 ||
    canvas.height % 2
  )
    throw new Error("H.264 视频的画布宽高必须是正偶数。");
  const library = mediaLibrary();
  onProgress?.(0, "正在准备 H.264 编码器");
  await requireH264(
    library,
    { width: canvas.width, height: canvas.height, fps, videoBitsPerSecond },
    signal,
  );
  const output = createOutput(library);
  const source = new library.CanvasSource(canvas, {
    codec: "avc",
    quality: new library.Quality({ bitrate: videoBitsPerSecond }),
    alpha: "discard",
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: fps });
  const cancel = () => {
    void output.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    checkAbort(signal);
    await output.start();
    for (let index = 0; index < frameCount; index++) {
      checkAbort(signal);
      draw(index / fps);
      await source.add(index / fps, 1 / fps);
      checkAbort(signal);
      onProgress?.(
        ((index + 1) / frameCount) * 0.96,
        `正在编码 ${format.toUpperCase()} · ${index + 1} / ${frameCount} 帧`,
      );
      if (index % 8 === 0)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    source.close();
    checkAbort(signal);
    onProgress?.(0.97, "正在封装视频文件");
    await output.finalize();
    checkAbort(signal);
    const blob = outputBlob(output);
    onProgress?.(1, "视频已完成");
    checkAbort(signal);
    return blob;
  } catch (error) {
    await output.cancel().catch(() => {});
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

/** Convert captured video to H.264 MP4 or ProRes 4444 MOV, retaining source audio. */
export async function convertVideoBlob(
  blob,
  {
    format = "mp4",
    fps = 30,
    videoBitsPerSecond = 6000000,
    onProgress,
    signal,
  } = {},
) {
  requireFormat(format);
  checkAbort(signal);
  if (format === "webm") return blob;
  if (format === "mov") return exportVideoProRes(blob, { signal, onProgress });
  const library = mediaLibrary();
  const input = new library.Input({
    source: new library.BlobSource(blob),
    formats: library.ALL_FORMATS,
  });
  const output = createOutput(library);
  let conversion;
  const cancel = () => {
    void (conversion ? conversion.cancel() : output.cancel()).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    onProgress?.(0, "正在准备视频编码");
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("未找到视频画面，无法导出。");
    await requireH264(
      library,
      {
        width: video.displayWidth,
        height: video.displayHeight,
        fps,
        videoBitsPerSecond,
      },
      signal,
    );
    const audio = await input.getPrimaryAudioTrack();
    if (
      audio &&
      !(await library.canEncodeAudio("aac", {
        numberOfChannels: 2,
        sampleRate: 48000,
      }))
    )
      throw new Error(
        "当前浏览器不支持 AAC 音频编码，无法保留原声。请使用新版 Chrome / Edge，或选择 WebM。",
      );
    checkAbort(signal);
    conversion = await library.Conversion.init({
      input,
      output,
      showWarnings: false,
      video: {
        codec: "avc",
        quality: new library.Quality({ bitrate: videoBitsPerSecond }),
        frameRate: fps,
        forceTranscode: true,
      },
      audio: {
        codec: "aac",
        quality: new library.Quality({ bitrate: 128000 }),
        sampleRate: 48000,
        numberOfChannels: 2,
        forceTranscode: true,
      },
    });
    checkAbort(signal);
    if (!conversion.isValid || conversion.discardedTracks.length)
      throw new Error("当前浏览器无法完整转换画面或声音，请尝试 WebM 格式。");
    conversion.onProgress = (progress) => {
      if (signal?.aborted) return;
      onProgress?.(
        progress * 0.97,
        `正在编码 ${format.toUpperCase()} · H.264 / AAC`,
      );
    };
    await conversion.execute();
    checkAbort(signal);
    const result = outputBlob(output);
    onProgress?.(1, "视频已完成");
    checkAbort(signal);
    return result;
  } catch (error) {
    await (conversion ? conversion.cancel() : output.cancel()).catch(() => {});
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    input.dispose();
  }
}
