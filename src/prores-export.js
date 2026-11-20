/** Single-thread, browser-local ProRes 4444 export. The encoder runs in an owned worker. */
const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
let encoderQueue = Promise.resolve();

function cancelled() {
  return new DOMException("导出已取消。", "AbortError");
}

function waitWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    // A caller may synchronously abort inside a progress callback, after the
    // underlying promise was created. Observe its later termination rejection.
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(cancelled());
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/**
 * Execute one isolated FFmpeg job. action(ffmpeg, checkAbort) may use WORKERFS,
 * exec and readFile. Its worker and virtual files are always destroyed afterward.
 * A queued cancellation rejects promptly without interrupting another caller.
 */
export function withProResEncoder(
  action,
  { signal, onProgress, label = "ProRes 透明视频编码器" } = {},
) {
  if (signal?.aborted) return Promise.reject(cancelled());
  const task = encoderQueue.then(async () => {
    const checkAbort = () => {
      if (signal?.aborted) throw cancelled();
    };
    checkAbort();
    const base = new URL("vendor/ffmpeg/", document.baseURI);
    if (!["http:", "https:"].includes(base.protocol)) {
      throw new Error(
        `${label}需要通过本地 HTTP 服务或 HTTPS 网站打开。请运行 npm run dev，或使用已部署的网址。`,
      );
    }
    const FFmpeg = globalThis.FFmpegWASM?.FFmpeg;
    if (!FFmpeg)
      throw new Error(
        `${label}未加载，请保留完整 vendor/ffmpeg 目录并刷新页面。`,
      );
    const ffmpeg = new FFmpeg();
    const abort = () => ffmpeg.terminate();
    let timeout;
    let wasmObjectURL;
    signal?.addEventListener("abort", abort, { once: true });
    try {
      checkAbort();
      onProgress?.(0, `正在加载${label}…`);
      checkAbort();
      let wasmParts = await Promise.all([0, 1].map(async (index) => {
        const response = await fetch(new URL(`ffmpeg-core.wasm.part${index}`, base), { signal });
        return response.ok ? response.arrayBuffer() : null;
      }));
      if (wasmParts.some((part) => part === null)) {
        const response = await fetch(new URL("ffmpeg-core.wasm", base), { signal });
        if (!response.ok) throw new Error("视频编码组件加载失败，请刷新页面重试。");
        wasmParts = [await response.arrayBuffer()];
      }
      wasmObjectURL = URL.createObjectURL(new Blob(wasmParts, { type: "application/wasm" }));
      const loading = ffmpeg.load({
        coreURL: new URL("ffmpeg-core.js", base).href,
        wasmURL: wasmObjectURL,
      });
      await waitWithAbort(
        Promise.race([
          loading,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    `${label}加载超时，请检查本地编码文件是否完整后重试。`,
                  ),
                ),
              45000,
            );
          }),
        ]),
        signal,
      );
      clearTimeout(timeout);
      checkAbort();
      const result = await waitWithAbort(
        Promise.resolve(action(ffmpeg, checkAbort)),
        signal,
      );
      checkAbort();
      return result;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw cancelled();
      const message = error?.message || String(error);
      if (
        /out of memory|memory access out of bounds|cannot enlarge memory|\boom\b/i.test(
          message,
        )
      ) {
        throw new Error(
          `${label}内存不足，请缩短片段或降低分辨率后重试。`,
        );
      }
      throw error instanceof Error ? error : new Error(message);
    } finally {
      clearTimeout(timeout);
      if (wasmObjectURL) URL.revokeObjectURL(wasmObjectURL);
      signal?.removeEventListener("abort", abort);
      ffmpeg.terminate();
    }
  });
  encoderQueue = task.catch(() => {});
  return waitWithAbort(task, signal);
}

function validateBlob(blob, label) {
  if (
    !blob ||
    typeof blob.arrayBuffer !== "function" ||
    !Number.isFinite(blob.size) ||
    blob.size <= 0
  ) {
    throw new Error(`${label}内容无效。`);
  }
  if (blob.size > MAX_INPUT_BYTES)
    throw new Error(`${label}超过 256 MiB，请缩短视频或分批导出。`);
}

function canvasPng(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("无法读取透明画面，请降低分辨率后重试。")),
        "image/png",
      );
    } catch (error) {
      reject(
        new Error(
          error?.name === "SecurityError"
            ? "画面包含不允许读取的外部图片，请改用本地素材。"
            : "无法生成透明画面，请重试。",
        ),
      );
    }
  });
}

async function execute(ffmpeg, args, checkAbort) {
  const lines = [];
  const log = ({ message }) => {
    lines.push(message);
    if (lines.length > 12) lines.shift();
  };
  ffmpeg.on("log", log);
  try {
    checkAbort();
    const code = await ffmpeg.exec([
      "-hide_banner",
      "-loglevel",
      "error",
      ...args,
    ]);
    checkAbort();
    if (code !== 0)
      throw new Error(
        `ProRes 编码失败：${lines.filter(Boolean).slice(-3).join(" ") || `编码器返回 ${code}`}`,
      );
  } finally {
    ffmpeg.off("log", log);
  }
}

async function mountInputs(ffmpeg, entries, checkAbort) {
  await ffmpeg.createDir("/inputs");
  checkAbort();
  if (!(await ffmpeg.mount("WORKERFS", { blobs: entries }, "/inputs"))) {
    throw new Error("当前 ProRes 编码器无法读取本地素材，请检查编码组件版本。");
  }
  checkAbort();
}

async function cleanupFiles(ffmpeg) {
  if (!ffmpeg.loaded) return;
  await ffmpeg.deleteFile("output.mov").catch(() => {});
  await ffmpeg.deleteFile("source-info.json").catch(() => {});
  await ffmpeg.unmount("/inputs").catch(() => {});
  await ffmpeg.deleteDir("/inputs").catch(() => {});
}

async function inputDecoder(ffmpeg, checkAbort) {
  checkAbort();
  // This core can return -1 despite writing valid ffprobe JSON. Read and
  // validate the actual result instead of rejecting solely on its return code.
  await ffmpeg.ffprobe([
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name:stream_tags=alpha_mode",
    "-of",
    "json",
    "-o",
    "source-info.json",
    "/inputs/source-video",
  ]);
  checkAbort();
  let stream;
  try {
    const result = JSON.parse(
      await ffmpeg.readFile("source-info.json", "utf8"),
    );
    stream = result.streams?.[0];
  } catch {
    checkAbort();
    throw new Error("无法读取视频信息，请使用完整、未损坏的视频文件。");
  }
  if (!stream) throw new Error("素材没有可读取的视频轨道。");
  // Native VP8/VP9 decoders ignore WebM's separate alpha bitstream.
  const alpha = Object.entries(stream.tags || {}).some(
    ([name, value]) =>
      name.toLowerCase() === "alpha_mode" && String(value) === "1",
  );
  if (alpha && stream.codec_name === "vp9") return ["-c:v", "libvpx-vp9"];
  if (alpha && stream.codec_name === "vp8") return ["-c:v", "libvpx"];
  return [];
}

async function readOutput(ffmpeg, checkAbort) {
  checkAbort();
  const data = await ffmpeg.readFile("output.mov");
  checkAbort();
  if (!(data instanceof Uint8Array) || !data.byteLength)
    throw new Error("未生成 ProRes 视频，请重试。");
  if (data.byteLength > MAX_OUTPUT_BYTES)
    throw new Error("ProRes 文件超过 512 MiB，请缩短视频或降低分辨率后重试。");
  return new Blob([data], { type: "video/quicktime" });
}

const proResArguments = () => [
  "-c:v",
  "prores_ks",
  "-profile:v",
  "4",
  "-pix_fmt",
  "yuva444p10le",
  "-alpha_bits",
  "16",
  "-qscale:v",
  "4",
  "-threads",
  "1",
];

/** draw(seconds) may be async. PNG inputs preserve genuine canvas alpha. */
export async function exportCanvasProRes(
  canvas,
  draw,
  { duration = 3, fps = 30, audioBlob, signal, onProgress } = {},
) {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(fps) ||
    fps < 1 ||
    fps > 60
  ) {
    throw new Error("ProRes 导出时长和帧率无效。");
  }
  if (
    !canvas?.width ||
    !canvas?.height ||
    typeof canvas.toBlob !== "function" ||
    typeof draw !== "function"
  ) {
    throw new Error("ProRes 导出画布无效。");
  }
  if (audioBlob !== undefined) validateBlob(audioBlob, "原声素材");
  const frameCount = Math.max(1, Math.ceil(duration * fps - 1e-7));
  if (!Number.isSafeInteger(frameCount))
    throw new Error("ProRes 视频时长过长，请分段导出。");
  return withProResEncoder(
    async (ffmpeg, checkAbort) => {
      const frames = [];
      let bytes = 0;
      const progress = ({ progress: value }) => {
        if (!signal?.aborted)
          onProgress?.(
            0.5 + Math.max(0, Math.min(1, value || 0)) * 0.46,
            "正在编码 ProRes 4444 · 保留 Alpha",
          );
      };
      ffmpeg.on("progress", progress);
      try {
        for (let index = 0; index < frameCount; index++) {
          checkAbort();
          await draw(index / fps);
          checkAbort();
          const png = await canvasPng(canvas);
          checkAbort();
          bytes += png.size;
          if (bytes > MAX_INPUT_BYTES)
            throw new Error(
              "透明帧素材累计超过 256 MiB，请缩短片段或降低分辨率后重试。",
            );
          frames.push({
            name: `frame-${String(index).padStart(6, "0")}.png`,
            data: png,
          });
          onProgress?.(
            0.05 + ((index + 1) / frameCount) * 0.44,
            `正在生成透明帧 · ${index + 1} / ${frameCount}`,
          );
        }
        if (audioBlob !== undefined)
          frames.push({ name: "audio-source", data: audioBlob });
        await mountInputs(ffmpeg, frames, checkAbort);
        frames.length = 0;
        const args = [
          "-framerate",
          String(fps),
          "-start_number",
          "0",
          "-i",
          "/inputs/frame-%06d.png",
        ];
        if (audioBlob !== undefined) args.push("-i", "/inputs/audio-source");
        args.push("-map", "0:v:0");
        if (audioBlob !== undefined) {
          args.push(
            "-map",
            "1:a:0?",
            "-c:a",
            "pcm_s16le",
            "-af",
            `apad,atrim=duration=${frameCount / fps},asetpts=PTS-STARTPTS`,
          );
        } else args.push("-an");
        // The finite PNG sequence determines the exact frame count. -frames:v would
        // stop audio muxing early; -t lets padded PCM reach the same duration.
        args.push(
          ...proResArguments(),
          "-t",
          String(frameCount / fps),
          "-f",
          "mov",
          "output.mov",
        );
        await execute(ffmpeg, args, checkAbort);
        onProgress?.(0.98, "正在准备透明 MOV 文件…");
        const blob = await readOutput(ffmpeg, checkAbort);
        onProgress?.(1, "ProRes 4444 透明 MOV 已完成");
        checkAbort();
        return blob;
      } finally {
        frames.length = 0;
        ffmpeg.off("progress", progress);
        await cleanupFiles(ffmpeg);
      }
    },
    { signal, onProgress },
  );
}

/** Preserve an input video's existing alpha and convert its audio to PCM. */
export async function exportVideoProRes(blob, { signal, onProgress } = {}) {
  validateBlob(blob, "视频素材");
  return withProResEncoder(
    async (ffmpeg, checkAbort) => {
      const progress = ({ progress: value }) => {
        if (!signal?.aborted)
          onProgress?.(
            Math.max(0, Math.min(1, value || 0)) * 0.96,
            "正在生成 ProRes 4444 / PCM",
          );
      };
      ffmpeg.on("progress", progress);
      try {
        await mountInputs(
          ffmpeg,
          [{ name: "source-video", data: blob }],
          checkAbort,
        );
        const decoder = await inputDecoder(ffmpeg, checkAbort);
        await execute(
          ffmpeg,
          [
            ...decoder,
            "-i",
            "/inputs/source-video",
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            ...proResArguments(),
            "-c:a",
            "pcm_s16le",
            "-f",
            "mov",
            "output.mov",
          ],
          checkAbort,
        );
        const output = await readOutput(ffmpeg, checkAbort);
        onProgress?.(1, "ProRes 4444 MOV 已完成");
        checkAbort();
        return output;
      } finally {
        ffmpeg.off("progress", progress);
        await cleanupFiles(ffmpeg);
      }
    },
    { signal, onProgress },
  );
}
