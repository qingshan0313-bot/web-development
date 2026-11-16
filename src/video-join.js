import { withProResEncoder } from "./prores-export.js";

const SAMPLE_RATE = 48000;
const AUDIO_CHUNK = SAMPLE_RATE / 2;
const MAX_FRAMES = 1000000;

const cancelled = () => new DOMException("拼接已取消。", "AbortError");
function check(signal) {
  if (signal?.aborted) throw cancelled();
}
const frameAt = (time, fps) => Math.ceil(time * fps - 1e-7);

/** MOV uses a direct software decode/encode path so source alpha never crosses an opaque canvas. */
async function joinProResVideos(
  clips,
  {
    width,
    height,
    fps,
    fit,
    frameCount,
    transparentBackground,
    backgroundColor,
    signal,
    onProgress,
  },
) {
  let solidColor = "0x000000ff";
  if (!transparentBackground) {
    if (
      typeof backgroundColor !== "string" ||
      !CSS.supports("color", backgroundColor)
    )
      throw new Error("请使用有效的背景颜色。");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("无法读取背景颜色。");
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, 1, 1);
    solidColor =
      "0x" +
      [...context.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("") +
      "ff";
  }
  let lastProgress = 0;
  const report = (value, stage) => {
    if (signal?.aborted) return;
    lastProgress = Math.max(lastProgress, Math.max(0, Math.min(1, value)));
    onProgress?.(lastProgress, stage);
  };
  return withProResEncoder(
    async (ffmpeg, checkAbort) => {
      const logs = [];
      const log = ({ message }) => {
        logs.push(message);
        if (logs.length > 12) logs.shift();
      };
      const progress = ({ time }) =>
        report(
          0.08 +
            Math.min(
              1,
              Math.max(0, (time || 0) / 1000000 / (frameCount / fps)),
            ) *
              0.87,
          "正在拼接 ProRes 4444 · 保留透明通道与 PCM 原声",
        );
      ffmpeg.on("log", log);
      try {
        await ffmpeg.createDir("/inputs");
        checkAbort();
        if (
          !(await ffmpeg.mount(
            "WORKERFS",
            {
              blobs: clips.map((clip, index) => ({
                name: `clip-${index}`,
                data: clip.file,
              })),
            },
            "/inputs",
          ))
        )
          throw new Error("无法读取拼接素材，请检查 ProRes 编码组件是否完整。");
        const prepared = [];
        let offset = 0;
        for (const [index, clip] of clips.entries()) {
          checkAbort();
          report(
            0.02 + index * 0.02,
            `正在读取第 ${index + 1} 段透明视频与原声`,
          );
          const input = `/inputs/clip-${index}`;
          const probeFile = `probe-${index}.json`;
          // This FFmpeg build writes valid ffprobe JSON even when its return code is -1.
          await ffmpeg.ffprobe([
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            "-o",
            probeFile,
            input,
          ]);
          checkAbort();
          let metadata;
          try {
            metadata = JSON.parse(await ffmpeg.readFile(probeFile, "utf8"));
          } catch {
            throw new Error(
              `无法识别第 ${index + 1} 段视频，请重新选择完整文件。`,
            );
          }
          const video = metadata.streams?.find(
            (stream) =>
              stream.codec_type === "video" &&
              !stream.disposition?.attached_pic,
          );
          const audio = metadata.streams?.find(
            (stream) => stream.codec_type === "audio",
          );
          if (!video)
            throw new Error(`第 ${index + 1} 个文件没有可用视频画面。`);
          let duration = Number(video.duration || metadata.format?.duration);
          if (!Number.isFinite(duration) || duration <= 0) {
            // MediaRecorder WebM often has no duration header. Scan packet timestamps without decoding.
            const packetFile = `packets-${index}.csv`;
            await ffmpeg.ffprobe([
              "-v",
              "error",
              "-select_streams",
              String(video.index),
              "-show_packets",
              "-show_entries",
              "packet=pts_time,duration_time",
              "-of",
              "csv=p=0",
              "-o",
              packetFile,
              input,
            ]);
            checkAbort();
            const packets = await ffmpeg.readFile(packetFile, "utf8");
            duration = 0;
            for (const line of packets.split("\n")) {
              const [time, length] = line.split(",").map(Number);
              if (Number.isFinite(time))
                duration = Math.max(
                  duration,
                  time + (Number.isFinite(length) ? length : 0),
                );
            }
            duration -= Number(video.start_time) || 0;
          }
          if (
            !Number.isFinite(duration) ||
            duration <= 0 ||
            clip.end > duration + 0.05
          )
            throw new Error(`第 ${index + 1} 段裁切范围超过视频时长。`);
          const durationSelected = clip.end - clip.start;
          const firstFrame = frameAt(offset, fps);
          const frames = frameAt(offset + durationSelected, fps) - firstFrame;
          prepared.push({
            ...clip,
            input,
            video,
            audio,
            duration: durationSelected,
            frames,
            videoStart: clip.start + Math.max(0, firstFrame / fps - offset),
          });
          offset += durationSelected;
        }
        checkAbort();
        const hasAudio = prepared.some((clip) => clip.audio && clip.volume > 0);
        const args = [
          "-hide_banner",
          "-loglevel",
          "error",
          "-filter_complex_threads",
          "1",
        ];
        for (const clip of prepared) {
          // FFmpeg's native VP9 decoder drops alpha; libvpx decodes WebM's alpha side stream.
          if (
            clip.video.codec_name === "vp9" &&
            String(clip.video.tags?.alpha_mode) === "1"
          )
            args.push("-c:v", "libvpx-vp9");
          if (
            clip.video.codec_name === "vp8" &&
            String(clip.video.tags?.alpha_mode) === "1"
          )
            args.push("-c:v", "libvpx");
          args.push("-i", clip.input);
        }
        const filters = [];
        for (const [index, clip] of prepared.entries()) {
          const geometry =
            fit === "cover"
              ? `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${width}:${height}`
              : `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
          filters.push(
            `[${index}:${clip.video.index}]trim=start=${clip.videoStart}:end=${clip.end},setpts=PTS-STARTPTS,` +
              `fps=${fps},format=rgba,${geometry},setsar=1,tpad=stop_mode=clone:stop_duration=${clip.frames / fps},` +
              `trim=end_frame=${clip.frames},setpts=N/(${fps}*TB)[${transparentBackground ? "v" : "foreground"}${index}]`,
          );
          if (!transparentBackground) {
            filters.push(
              `color=c=${solidColor}:s=${width}x${height}:r=${fps}:d=${clip.frames / fps},format=rgba[background${index}]`,
            );
            filters.push(
              `[background${index}][foreground${index}]overlay=shortest=1:format=auto,format=rgba[v${index}]`,
            );
          }
          if (hasAudio) {
            const source =
              clip.audio && clip.volume > 0
                ? `[${index}:${clip.audio.index}]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS,` +
                  `aresample=${SAMPLE_RATE},${clip.audio.channels === 1 ? "pan=stereo|c0=c0|c1=c0," : ""}` +
                  `aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${clip.volume},apad`
                : `anullsrc=r=${SAMPLE_RATE}:cl=stereo`;
            filters.push(
              `${source},atrim=duration=${clip.duration},asetpts=N/SR/TB[a${index}]`,
            );
          }
        }
        // Separate concat clocks prevent segment rounding from inserting silence at the audio cut.
        filters.push("[v0][v1]concat=n=2:v=1:a=0,format=yuva444p10le[v]");
        if (hasAudio)
          filters.push(
            `[a0][a1]concat=n=2:v=0:a=1,apad,atrim=duration=${frameCount / fps},asetpts=N/SR/TB[a]`,
          );
        args.push("-filter_complex", filters.join(";"), "-map", "[v]");
        if (hasAudio)
          args.push(
            "-map",
            "[a]",
            "-c:a",
            "pcm_s24le",
            "-ar",
            String(SAMPLE_RATE),
            "-ac",
            "2",
          );
        else args.push("-an");
        args.push(
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
          "-r",
          String(fps),
          "-f",
          "mov",
          "joined.mov",
        );
        report(0.08, "正在拼接 ProRes 4444 · 保留透明通道与 PCM 原声");
        checkAbort();
        logs.length = 0;
        ffmpeg.on("progress", progress);
        const code = await ffmpeg.exec(args);
        ffmpeg.off("progress", progress);
        checkAbort();
        if (code !== 0)
          throw new Error(
            `透明 MOV 拼接失败：${logs.filter(Boolean).slice(-3).join(" ") || `编码器返回 ${code}`}`,
          );
        report(0.98, "正在准备 ProRes 4444 MOV 文件");
        checkAbort();
        const data = await ffmpeg.readFile("joined.mov");
        checkAbort();
        if (!(data instanceof Uint8Array) || !data.byteLength)
          throw new Error("未生成拼接视频，请检查裁切范围。");
        if (data.byteLength > 512 * 1024 * 1024)
          throw new Error(
            "ProRes 文件超过 512 MiB，请缩短片段或降低分辨率后重试。",
          );
        const blob = new Blob([data], { type: "video/quicktime" });
        report(1, "ProRes 4444 透明 MOV 拼接完成");
        checkAbort();
        return blob;
      } finally {
        ffmpeg.off("progress", progress);
        ffmpeg.off("log", log);
        // withProResEncoder always terminates this owned worker and releases its complete virtual FS.
      }
    },
    { signal, onProgress: report },
  );
}

/** Decode only a rolling half-second window; the offline mixer handles resampling and channel mixing. */
function audioReader(library, track, clip, signal) {
  const iterator =
    track && clip.volume > 0
      ? new library.AudioBufferSink(track).buffers(clip.start, clip.end)
      : null;
  let next = null;
  let ended = !iterator;
  const advance = async () => {
    check(signal);
    const result = await iterator.next();
    check(signal);
    next = result.value || null;
    ended = result.done;
  };
  return {
    async render(start, length) {
      check(signal);
      if (!iterator)
        return new AudioBuffer({
          length,
          numberOfChannels: 2,
          sampleRate: SAMPLE_RATE,
        });
      const end = Math.min(clip.end, start + length / SAMPLE_RATE);
      if (!next && !ended) await advance();
      while (next && next.timestamp + next.duration <= start + 1e-8)
        await advance();
      const context = new OfflineAudioContext(2, length, SAMPLE_RATE);
      const gain = context.createGain();
      gain.gain.value = clip.volume;
      gain.connect(context.destination);
      const nodes = [];
      try {
        while (next && next.timestamp < end - 1e-8) {
          const offset = Math.max(0, start - next.timestamp);
          const when = Math.max(0, next.timestamp - start);
          const duration = Math.min(
            next.buffer.duration - offset,
            end - start - when,
          );
          if (duration > 1e-8) {
            const source = context.createBufferSource();
            source.buffer = next.buffer;
            source.connect(gain);
            source.start(when, offset, duration);
            nodes.push(source);
          }
          if (next.timestamp + next.duration > end + 1e-8) break;
          await advance();
        }
        check(signal);
        const buffer = await context.startRendering();
        check(signal);
        return buffer;
      } finally {
        nodes.forEach((node) => node.disconnect());
        gain.disconnect();
      }
    },
    async close() {
      next = null;
      if (iterator) await iterator.return().catch(() => {});
    },
  };
}

/** Join exactly two trimmed clips on one continuous CFR video/audio timeline. */
export async function joinVideos(
  clips,
  {
    width = 1280,
    height = 720,
    fps = 30,
    format = "mp4",
    fit = "contain",
    backgroundColor = "#000000",
    transparentBackground = true,
    videoBitsPerSecond = 6000000,
    signal,
    onProgress,
  } = {},
) {
  check(signal);
  if (!Array.isArray(clips) || clips.length !== 2)
    throw new Error("请选择一个片头和一个成片，共两个视频。");
  if (
    !["mp4", "mov", "webm"].includes(format) ||
    !["contain", "cover"].includes(fit)
  )
    throw new Error("视频格式或画面适配方式无效。");
  if (
    ![width, height].every(
      (value) =>
        Number.isInteger(value) &&
        value > 0 &&
        value <= 4096 &&
        value % 2 === 0,
    )
  )
    throw new Error("输出宽高必须是 2–4096 范围内的正偶数。");
  if (
    !Number.isFinite(fps) ||
    fps < 1 ||
    fps > 60 ||
    !Number.isFinite(videoBitsPerSecond) ||
    videoBitsPerSecond < 1000000 ||
    videoBitsPerSecond > 20000000
  )
    throw new Error("帧率需为 1–60，视频码率需为 1–20 Mbps。");
  const selected = clips.map((clip, index) => {
    if (!(clip?.file instanceof Blob) || !clip.file.size)
      throw new Error(`第 ${index + 1} 个视频文件无效。`);
    if (
      !Number.isFinite(clip.start) ||
      !Number.isFinite(clip.end) ||
      clip.start < 0 ||
      clip.end <= clip.start
    )
      throw new Error(`第 ${index + 1} 段的开始、结束时间无效。`);
    if (clip.end - clip.start < 1 / fps - 1e-7)
      throw new Error(
        `第 ${index + 1} 段至少保留一帧（${(1 / fps).toFixed(3)} 秒）。`,
      );
    const volume = clip.volume ?? 1;
    if (!Number.isFinite(volume) || volume < 0 || volume > 2)
      throw new Error(`第 ${index + 1} 段音量需在 0–2 之间。`);
    return { file: clip.file, start: clip.start, end: clip.end, volume };
  });
  const totalDuration = selected.reduce(
    (sum, clip) => sum + clip.end - clip.start,
    0,
  );
  const frameCount = frameAt(totalDuration, fps);
  if (
    !Number.isSafeInteger(frameCount) ||
    frameCount < 1 ||
    frameCount > MAX_FRAMES
  )
    throw new Error("拼接帧数超过单次处理范围，请缩短视频或降低帧率。");
  if (format === "mov")
    return joinProResVideos(selected, {
      width,
      height,
      fps,
      fit,
      frameCount,
      transparentBackground,
      backgroundColor,
      signal,
      onProgress,
    });
  const library = globalThis.Mediabunny;
  if (
    !library ||
    typeof VideoEncoder === "undefined" ||
    typeof VideoDecoder === "undefined"
  )
    throw new Error(
      "拼接需要浏览器视频编解码支持，请使用新版 Chrome / Edge 打开完整本地工具或 HTTPS 网站。",
    );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("无法创建拼接画布。");
  if (
    typeof backgroundColor !== "string" ||
    !CSS.supports("color", backgroundColor)
  )
    throw new Error("请使用有效的背景颜色。");

  const inputs = [];
  const iterators = new Set();
  const readers = new Set();
  let output;
  let lastProgress = -1;
  const report = (progress, stage) => {
    check(signal);
    const value = Math.max(lastProgress, Math.min(1, Math.max(0, progress)));
    lastProgress = value;
    onProgress?.(value, stage);
    check(signal);
  };
  const abort = () => {
    if (output) void output.cancel().catch(() => {});
    inputs.forEach((input) => input.dispose());
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    report(0, "正在读取片头与成片");
    let offset = 0;
    const prepared = [];
    for (const [index, clip] of selected.entries()) {
      check(signal);
      const input = new library.Input({
        source: new library.BlobSource(clip.file),
        formats: library.ALL_FORMATS,
      });
      inputs.push(input);
      const video = await input.getPrimaryVideoTrack();
      if (!video || !(await video.canDecode()))
        throw new Error(
          `浏览器无法读取第 ${index + 1} 段画面，请使用可解码的 MP4 或 WebM。`,
        );
      const duration = await input.computeDuration();
      check(signal);
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        clip.end > duration + 0.05
      )
        throw new Error(`第 ${index + 1} 段裁切范围超过视频时长。`);
      const audio = await input.getPrimaryAudioTrack();
      if (audio && clip.volume > 0 && !(await audio.canDecode()))
        throw new Error(
          `浏览器无法解码第 ${index + 1} 段原声，请更换文件或将该段静音。`,
        );
      const firstTimestamp = await video.getFirstTimestamp();
      const durationSelected = clip.end - clip.start;
      prepared.push({
        ...clip,
        input,
        video,
        audio,
        firstTimestamp,
        offset,
        duration: durationSelected,
        frameStart: frameAt(offset, fps),
        frameEnd: frameAt(offset + durationSelected, fps),
      });
      offset += durationSelected;
    }
    const hasAudio = prepared.some((clip) => clip.audio && clip.volume > 0);
    const videoCodec = format === "webm" ? "vp8" : "avc";
    const audioCodec = format === "webm" ? "opus" : "aac";
    if (
      !(await library.canEncodeVideo(videoCodec, {
        width,
        height,
        frameRate: fps,
        quality: new library.Quality({ bitrate: videoBitsPerSecond }),
      }))
    )
      throw new Error(
        `当前浏览器不支持所选尺寸的 ${format.toUpperCase()} 编码，请降低分辨率或更换格式。`,
      );
    if (
      hasAudio &&
      (!(await library.canEncodeAudio(audioCodec, {
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 2,
        quality: new library.Quality({ bitrate: 128000 }),
      })) ||
        typeof OfflineAudioContext === "undefined")
    )
      throw new Error(
        `当前浏览器无法保留 ${format.toUpperCase()} 原声，请更换浏览器或将两段静音。`,
      );
    check(signal);
    const container =
      format === "webm"
        ? new library.WebMOutputFormat()
        : new library.Mp4OutputFormat({ fastStart: "in-memory" });
    output = new library.Output({
      format: container,
      target: new library.BufferTarget(),
    });
    const videoSource = new library.CanvasSource(canvas, {
      codec: videoCodec,
      quality: new library.Quality({ bitrate: videoBitsPerSecond }),
      alpha: "discard",
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    const audioSource = hasAudio
      ? new library.AudioBufferSource({
          codec: audioCodec,
          quality: new library.Quality({ bitrate: 128000 }),
        })
      : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();
    let frameIndex = 0;
    let audioFramesAdded = 0;
    for (const [clipIndex, clip] of prepared.entries()) {
      const sink = new library.CanvasSink(clip.video, { poolSize: 2 });
      function* timestamps() {
        for (let index = clip.frameStart; index < clip.frameEnd; index++)
          yield Math.max(
            clip.firstTimestamp,
            Math.min(clip.end - 1e-8, clip.start + index / fps - clip.offset),
          );
      }
      const frames = sink.canvasesAtTimestamps(timestamps());
      iterators.add(frames);
      const reader = hasAudio
        ? audioReader(library, clip.audio, clip, signal)
        : null;
      if (reader) readers.add(reader);
      const sampleStart = Math.round(clip.offset * SAMPLE_RATE);
      const sampleEnd = Math.round((clip.offset + clip.duration) * SAMPLE_RATE);
      for (
        let sampleCursor = sampleStart;
        sampleCursor < sampleEnd;
        sampleCursor += AUDIO_CHUNK
      ) {
        check(signal);
        const chunkFrames = Math.min(AUDIO_CHUNK, sampleEnd - sampleCursor);
        const batchEnd = (sampleCursor + chunkFrames) / SAMPLE_RATE;
        const lastBatch = sampleCursor + chunkFrames === sampleEnd;
        while (
          frameIndex < clip.frameEnd &&
          (lastBatch || frameIndex / fps < batchEnd - 1e-8)
        ) {
          check(signal);
          const result = await frames.next();
          check(signal);
          if (!result.value)
            throw new Error(`第 ${clipIndex + 1} 段在裁切位置没有可用画面。`);
          const image = result.value.canvas;
          const scale =
            fit === "cover"
              ? Math.max(width / image.width, height / image.height)
              : Math.min(width / image.width, height / image.height);
          const drawWidth = image.width * scale;
          const drawHeight = image.height * scale;
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(
            image,
            (width - drawWidth) / 2,
            (height - drawHeight) / 2,
            drawWidth,
            drawHeight,
          );
          await videoSource.add(frameIndex / fps, 1 / fps);
          frameIndex++;
          report(
            0.04 + (frameIndex / frameCount) * 0.9,
            `正在拼接第 ${clipIndex + 1} 段 · ${frameIndex} / ${frameCount} 帧`,
          );
          if (frameIndex % 8 === 0)
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (audioSource) {
          const buffer = await reader.render(
            clip.start + (sampleCursor - sampleStart) / SAMPLE_RATE,
            chunkFrames,
          );
          check(signal);
          await audioSource.add(buffer);
          audioFramesAdded += chunkFrames;
        }
      }
      await frames.return();
      iterators.delete(frames);
      if (reader) {
        await reader.close();
        readers.delete(reader);
      }
    }
    if (frameIndex !== frameCount)
      throw new Error("视频帧未完整生成，请重试。");
    videoSource.close();
    if (audioSource) {
      const tail =
        Math.round((frameCount / fps) * SAMPLE_RATE) - audioFramesAdded;
      if (tail > 0)
        await audioSource.add(
          new AudioBuffer({
            length: tail,
            numberOfChannels: 2,
            sampleRate: SAMPLE_RATE,
          }),
        );
      audioSource.close();
    }
    report(0.97, `正在封装 ${format.toUpperCase()} 文件`);
    await output.finalize();
    check(signal);
    if (!output.target.buffer?.byteLength)
      throw new Error("未生成拼接视频，请重试。");
    const result = new Blob([output.target.buffer], {
      type: container.mimeType,
    });
    report(1, "拼接完成");
    return result;
  } catch (error) {
    if (output) await output.cancel().catch(() => {});
    if (signal?.aborted) throw cancelled();
    if (/unsupported or unrecognizable format/i.test(error?.message || ""))
      throw new Error(
        "无法识别视频格式，请重新选择完整且浏览器支持的视频文件。",
      );
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    await Promise.all(
      [...iterators].map((iterator) => iterator.return().catch(() => {})),
    );
    await Promise.all([...readers].map((reader) => reader.close()));
    inputs.forEach((input) => input.dispose());
    canvas.width = canvas.height = 1;
  }
}
