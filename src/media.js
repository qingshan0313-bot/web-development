/** Browser-local file helpers. No runtime dependencies or network requests. */
export function download(blob, filename = "download") {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the URL alive while the browser hands the download to the OS.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});

async function crc32(bytes, { checkAbort, onChunk }) {
  let crc = 0xffffffff;
  const chunkSize = 4 * 1024 * 1024;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    checkAbort();
    const end = Math.min(start + chunkSize, bytes.length);
    for (let index = start; index < end; index++)
      crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 255];
    onChunk(end - start);
    checkAbort();
    if (end - start === chunkSize) {
      // Yield to a browser task, not only a microtask, so Cancel remains usable.
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkAbort();
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

/** Create a standard UTF-8 ZIP using STORE (no recompression of media). */
export async function zipFiles(files, { signal, onProgress } = {}) {
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException("打包已取消。", "AbortError");
  };
  checkAbort();
  if (!Array.isArray(files)) throw new TypeError("压缩文件列表无效。");
  if (files.length > 65535) throw new Error("一次最多打包 65535 个文件。");
  let totalBytes = 0;
  for (const file of files) {
    checkAbort();
    if (
      !file?.blob ||
      typeof file.blob.arrayBuffer !== "function" ||
      !Number.isSafeInteger(file.blob.size) ||
      file.blob.size < 0
    )
      throw new TypeError("待打包的文件内容无效。");
    totalBytes += file.blob.size;
  }
  let processedBytes = 0,
    lastProgress = -1;
  const report = (progress) => {
    if (progress !== lastProgress) {
      lastProgress = progress;
      onProgress?.(progress);
    }
    checkAbort();
  };
  report(0);
  const encoder = new TextEncoder();
  const local = [],
    central = [];
  const now = new Date();
  const dosTime =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate =
    ((Math.min(2107, Math.max(1980, now.getFullYear())) - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();
  let offset = 0,
    centralSize = 0;
  for (const [index, file] of files.entries()) {
    checkAbort();
    const name = String(file.name || `file-${index + 1}`).replace(/\\/g, "/");
    if (
      name.startsWith("/") ||
      name.split("/").some((part) => part === "..") ||
      name.includes("\0")
    )
      throw new Error("文件名不能包含绝对路径或上级目录。");
    const encodedName = encoder.encode(name);
    if (encodedName.length > 65535) throw new Error("文件名过长，无法打包。");
    const size = file.blob.size;
    if (
      size > 0xffffffff ||
      offset + 30 + encodedName.length + size > 0xffffffff
    )
      throw new Error("压缩包超过 4 GB，请分批下载。");
    checkAbort();
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    checkAbort();
    if (bytes.length !== size)
      throw new Error("文件大小发生变化，无法完成打包。");
    const crc = await crc32(bytes, {
      checkAbort,
      onChunk: (count) => {
        processedBytes += count;
        report(totalBytes ? processedBytes / totalBytes : 0);
      },
    });
    checkAbort();
    const lh = header(30);
    lh.view.setUint32(0, 0x04034b50, true);
    lh.view.setUint16(4, 20, true);
    lh.view.setUint16(6, 0x0800, true);
    lh.view.setUint16(10, dosTime, true);
    lh.view.setUint16(12, dosDate, true);
    lh.view.setUint32(14, crc, true);
    lh.view.setUint32(18, size, true);
    lh.view.setUint32(22, size, true);
    lh.view.setUint16(26, encodedName.length, true);
    local.push(lh.bytes, encodedName, file.blob);
    const ch = header(46);
    ch.view.setUint32(0, 0x02014b50, true);
    ch.view.setUint16(4, 20, true);
    ch.view.setUint16(6, 20, true);
    ch.view.setUint16(8, 0x0800, true);
    ch.view.setUint16(12, dosTime, true);
    ch.view.setUint16(14, dosDate, true);
    ch.view.setUint32(16, crc, true);
    ch.view.setUint32(20, size, true);
    ch.view.setUint32(24, size, true);
    ch.view.setUint16(28, encodedName.length, true);
    ch.view.setUint32(42, offset, true);
    central.push(ch.bytes, encodedName);
    offset += 30 + encodedName.length + size;
    centralSize += 46 + encodedName.length;
  }
  checkAbort();
  if (offset + centralSize + 22 > 0xffffffff)
    throw new Error("压缩包超过 4 GB，请分批下载。");
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);
  const archive = new Blob([...local, ...central, end.bytes], {
    type: "application/zip",
  });
  report(1);
  checkAbort();
  return archive;
}

export function loadImage(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const ownsUrl = typeof Blob !== "undefined" && fileOrUrl instanceof Blob;
    const src = ownsUrl ? URL.createObjectURL(fileOrUrl) : String(fileOrUrl);
    const image = new Image();
    image.decoding = "async";
    if (!ownsUrl && !/^(data:|blob:)/i.test(src))
      image.crossOrigin = "anonymous";
    const release = () => {
      image.onload = image.onerror = null;
      if (ownsUrl) URL.revokeObjectURL(src);
    };
    image.onload = () => {
      release();
      resolve(image);
    };
    image.onerror = () => {
      release();
      reject(new Error("无法读取图片，请使用有效的 PNG、JPEG 或 WebP 图片。"));
    };
    image.src = src;
  });
}

export function canvasBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("图片导出失败，请缩小画布后重试。")),
        type,
      );
    } catch (error) {
      reject(
        new Error(
          error?.name === "SecurityError"
            ? "图片来源不允许导出，请上传本地图片。"
            : "图片导出失败，请重试。",
        ),
      );
    }
  });
}

/** Record a canvas in real time. draw receives elapsed seconds; progress is 0–1. */
export function recordCanvas(
  canvas,
  draw,
  {
    duration = 3,
    fps = 30,
    videoBitsPerSecond = 6000000,
    onProgress,
    signal,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("导出已取消。", "AbortError"));
    if (
      typeof MediaRecorder === "undefined" ||
      typeof canvas?.captureStream !== "function"
    )
      return reject(
        new Error("当前浏览器不支持视频导出，请使用最新版 Chrome 或 Edge。"),
      );
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isFinite(fps) ||
      fps < 1 ||
      fps > 60
    )
      return reject(new Error("导出时长和帧率无效。"));
    if (
      !Number.isFinite(videoBitsPerSecond) ||
      videoBitsPerSecond < 1000000 ||
      videoBitsPerSecond > 20000000
    )
      return reject(new Error("视频码率必须在 1–20 Mbps 之间。"));
    const mimeType = [
      "video/webm;codecs=vp8",
      "video/webm;codecs=vp9",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType)
      return reject(
        new Error("当前浏览器不支持 WebM 录制，请使用最新版 Chrome 或 Edge。"),
      );
    let stream,
      recorder,
      interval,
      timer,
      settled = false;
    const chunks = [];
    const cleanup = () => {
      clearInterval(interval);
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      stream?.getTracks().forEach((track) => track.stop());
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* Already stopped by the browser. */
        }
      }
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException("导出已取消。", "AbortError"));
    try {
      draw(0);
      if (signal?.aborted) throw new DOMException("导出已取消。", "AbortError");
      stream = canvas.captureStream(fps);
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = (event) =>
        fail(event.error || new Error("录制失败，请重试。"));
      recorder.onstop = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size) resolve(blob);
        else reject(new Error("未录制到画面，请重试。"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      recorder.start(250);
      const started = performance.now();
      onProgress?.(0);
      if (settled) return;
      interval = setInterval(() => {
        try {
          const elapsed = Math.min(
            duration,
            (performance.now() - started) / 1000,
          );
          draw(elapsed);
          if (settled) return;
          onProgress?.(elapsed / duration);
        } catch (error) {
          fail(error);
        }
      }, 1000 / fps);
      timer = setTimeout(() => {
        try {
          clearInterval(interval);
          draw(duration);
          if (settled) return;
          stream.getVideoTracks()[0]?.requestFrame?.();
          onProgress?.(1);
          if (recorder.state !== "inactive") recorder.stop();
        } catch (error) {
          fail(error);
        }
      }, duration * 1000);
    } catch (error) {
      fail(error);
    }
  });
}
