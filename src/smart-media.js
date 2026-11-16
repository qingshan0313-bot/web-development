import { loadImage } from "./media.js";
import { loadVideo, disposeVideo } from "./video.js";
import { smartRatio } from "./smart-model.js";

function cancelled() {
  return new DOMException("素材读取已取消。", "AbortError");
}

function checkAbort(signal) {
  if (signal?.aborted) throw cancelled();
}

function mediaType(file) {
  if (!(file instanceof Blob) || !file.size)
    throw new Error("请选择有效的视频或图片文件。");
  const name = String(file.name || "").toLowerCase();
  if (
    /^video\//i.test(file.type) ||
    /\.(mp4|mov|webm|m4v|ogv|ogg)$/i.test(name)
  )
    return "video";
  if (
    /^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(file.type) ||
    /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name)
  )
    return "image";
  throw new Error("请选择 MP4、MOV、WebM 视频或 PNG、JPEG、WebP、GIF 等图片。");
}

function metadataFor(source, type) {
  const width = type === "video" ? source.videoWidth : source.naturalWidth;
  const height = type === "video" ? source.videoHeight : source.naturalHeight;
  if (!width || !height)
    throw new Error("无法读取素材尺寸，请更换文件后重试。");
  return {
    width,
    height,
    duration: type === "video" ? source.duration : 0,
    ratio: smartRatio(width, height),
    type,
  };
}

function capture(source, metadata, maxDimension) {
  const max = Math.min(1920, Math.max(160, Number(maxDimension) || 1280));
  const scale = Math.min(1, max / Math.max(metadata.width, metadata.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(metadata.width * scale));
  canvas.height = Math.max(1, Math.round(metadata.height * scale));
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("浏览器暂时无法读取画面，请关闭其他标签页后重试。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const frame = canvas.toDataURL("image/jpeg", 0.86);
  canvas.width = canvas.height = 1;
  if (!frame.startsWith("data:image/jpeg;base64,"))
    throw new Error("素材画面提取失败，请更换文件后重试。");
  return frame;
}

async function withImage(file, signal, action) {
  checkAbort(signal);
  const url = URL.createObjectURL(file);
  let image,
    settled = false;
  try {
    image = await new Promise((resolve, reject) => {
      const clear = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const finish = (value, error) => {
        if (settled) {
          if (value) value.src = "";
          return;
        }
        settled = true;
        clear();
        if (error) reject(error);
        else resolve(value);
      };
      const onAbort = () => finish(null, cancelled());
      const timer = setTimeout(
        () => finish(null, new Error("图片读取超时，请检查文件是否完整。")),
        30000,
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      loadImage(url).then(
        (value) => finish(value),
        (error) => finish(null, error),
      );
    });
    checkAbort(signal);
    return await action(image, metadataFor(image, "image"));
  } finally {
    if (image) image.src = "";
    URL.revokeObjectURL(url);
  }
}

function seekFrame(video, time, signal) {
  checkAbort(signal);
  const target = Math.max(
    0,
    Math.min(time, Math.max(0, video.duration - 0.001)),
  );
  if (
    !video.seeking &&
    video.readyState >= 2 &&
    Math.abs(video.currentTime - target) < 0.0001
  )
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clear = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", ready);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", onAbort);
    };
    const ready = () => {
      if (
        video.seeking ||
        video.readyState < 2 ||
        Math.abs(video.currentTime - target) > 0.05
      )
        return;
      clear();
      resolve();
    };
    const fail = (error) => {
      clear();
      reject(error);
    };
    const failed = () =>
      fail(
        new Error("视频画面解码失败，请使用完整的 H.264 MP4 或 WebM 文件。"),
      );
    const onAbort = () => fail(cancelled());
    const timer = setTimeout(
      () => fail(new Error("视频抽帧超时，请检查文件是否完整。")),
      15000,
    );
    video.addEventListener("seeked", ready);
    video.addEventListener("error", failed);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    video.currentTime = target;
  });
}

/** Read dimensions/duration and one small thumbnail without any network call. */
export async function inspectSmartMedia(file, { signal, onProgress } = {}) {
  checkAbort(signal);
  const type = mediaType(file);
  onProgress?.(0);
  checkAbort(signal);
  if (type === "image")
    return withImage(file, signal, (image, metadata) => {
      const thumbnail = capture(image, metadata, 480);
      onProgress?.(1);
      checkAbort(signal);
      return { metadata, thumbnail };
    });
  let video;
  try {
    video = await loadVideo(file, { signal });
    const metadata = metadataFor(video, "video");
    await seekFrame(video, Math.min(0.1, video.duration / 2), signal);
    checkAbort(signal);
    const thumbnail = capture(video, metadata, 480);
    onProgress?.(1);
    checkAbort(signal);
    return { metadata, thumbnail };
  } finally {
    disposeVideo(video);
  }
}

/** Sample evenly spaced video frames, or one image, entirely in the browser. */
export async function extractSmartFrames(
  file,
  { signal, count = 8, maxDimension = 1280, onProgress } = {},
) {
  checkAbort(signal);
  const type = mediaType(file);
  onProgress?.(0);
  checkAbort(signal);
  if (type === "image")
    return withImage(file, signal, (image, metadata) => {
      const frame = capture(image, metadata, maxDimension);
      onProgress?.(1);
      checkAbort(signal);
      return [frame];
    });
  const total = Math.min(8, Math.max(1, Math.round(Number(count) || 8)));
  let video;
  try {
    video = await loadVideo(file, { signal });
    const metadata = metadataFor(video, "video");
    const frames = [];
    for (let index = 0; index < total; index++) {
      // Sample the centre of each interval to avoid blank first/end frames.
      await seekFrame(
        video,
        ((index + 0.5) / total) * metadata.duration,
        signal,
      );
      checkAbort(signal);
      frames.push(capture(video, metadata, maxDimension));
      onProgress?.((index + 1) / total);
      checkAbort(signal);
    }
    return frames;
  } finally {
    disposeVideo(video);
  }
}
