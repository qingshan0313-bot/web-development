import { withProResEncoder } from "./prores-export.js";

export const SMART_MEDIA_SIZE_LIMIT = 32 * 1024 * 1024;

export function smartVideoTarget({ width, height }) {
  return width > height ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

export function smartMediaChecks(file, metadata) {
  const target = metadata.type === "video" ? smartVideoTarget(metadata) : null;
  return {
    compress: file.size > SMART_MEDIA_SIZE_LIMIT,
    resize: Boolean(target && (metadata.width !== target.width || metadata.height !== target.height)),
  };
}

function videoResizeFilter(metadata) {
  const { width, height } = smartVideoTarget(metadata);
  const dimensions = `${width}:${height}`;
  return `scale=${dimensions}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${dimensions},setsar=1`;
}

export function optimizeSmartMedia(file, metadata, { signal, onProgress } = {}) {
  const { compress, resize } = smartMediaChecks(file, metadata);
  if (!compress && !resize) return Promise.resolve(file);

  const video = metadata.type === "video";
  const gif = /^image\/gif$/i.test(file.type) || /\.gif$/i.test(file.name);
  const sourceExtension = file.name.match(/\.[a-z0-9]+$/i)?.[0] || "";
  const source = `/inputs/source${sourceExtension}`;
  const extension = video ? "mp4" : gif ? "gif" : "webp";
  const output = `optimized.${extension}`;
  const duration = Number(metadata.duration);
  if (video && (!Number.isFinite(duration) || duration <= 0))
    return Promise.reject(new Error("无法读取视频时长，不能计算压缩目标。"));

  const audioBitrate = 96_000;
  const videoBudget = video ? (SMART_MEDIA_SIZE_LIMIT * 8 * 0.93) / duration - audioBitrate : null;

  return withProResEncoder(
    async (ffmpeg, checkAbort) => {
      await ffmpeg.createDir("/inputs");
      checkAbort();
      const mounted = await ffmpeg.mount(
        "WORKERFS",
        { blobs: [{ name: source.slice("/inputs/".length), data: file }] },
        "/inputs",
      );
      if (!mounted) throw new Error("FFmpeg 无法读取本地素材。");

      let bitrate = compress ? videoBudget : null;
      let attempt = 0;
      const report = ({ progress }) => {
        if (!Number.isFinite(progress)) return;
        const value = Math.max(0, Math.min(1, progress));
        onProgress?.((attempt + value) / 3, "FFmpeg 正在处理…");
      };
      ffmpeg.on("progress", report);
      try {
        for (attempt = 0; attempt < 3; attempt++) {
          checkAbort();
          const args = ["-y", "-i", source, "-map", "0:V:0"];
          if (video) {
            if (bitrate !== null && bitrate < 24_000)
              throw new Error("视频过长，无法在保留音轨的情况下压到 32 MB。");
            args.push("-map", "0:a:0?");
            if (resize) args.push("-vf", videoResizeFilter(metadata));
            args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p");
            if (bitrate === null) args.push("-crf", "22");
            else args.push("-b:v", String(Math.floor(bitrate)));
            args.push("-c:a", "aac", "-b:a", String(audioBitrate), "-movflags", "+faststart");
          } else {
            const maxSide = [4096, 2560, 1600][attempt];
            args.push("-vf", `scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease`);
            if (!gif)
              args.push("-frames:v", "1", "-c:v", "libwebp", "-quality", "82");
          }
          args.push("-threads", "1", output);
          onProgress?.(attempt / 3, "FFmpeg 正在处理…");
          const code = await ffmpeg.exec(args);
          checkAbort();
          if (code !== 0) throw new Error("FFmpeg 无法转换此素材。");

          const data = await ffmpeg.readFile(output);
          checkAbort();
          if (!(data instanceof Uint8Array) || !data.byteLength)
            throw new Error("FFmpeg 未生成有效文件。");
          if (data.byteLength <= SMART_MEDIA_SIZE_LIMIT) {
            onProgress?.(1, "正在检查处理结果…");
            const name = file.name.slice(0, file.name.length - sourceExtension.length);
            return new File([data], `${name}.${extension}`, {
              type: video ? "video/mp4" : `image/${extension}`,
              lastModified: file.lastModified,
            });
          }

          if (video) {
            bitrate = bitrate === null
              ? videoBudget
              : bitrate * (SMART_MEDIA_SIZE_LIMIT / data.byteLength) * 0.88;
          }
          await ffmpeg.deleteFile(output);
        }
        throw new Error("处理结果仍超过 32 MB。");
      } finally {
        ffmpeg.off("progress", report);
      }
    },
    { signal, onProgress, label: "本地 FFmpeg" },
  );
}
