import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DURATION_TOLERANCE_SECONDS = 0.25;
const MIN_DURATION_SECONDS = 0.1;
const MAX_DURATION_SECONDS = 300;
const OUTPUT_FRAME_RATE = 30;
const MAX_PRESCALE_WIDTH = 3840;

// Motion presets mirror OpenMontage's remotion-composer `Img` component
// (remotion-composer/src/Explainer.tsx): zoom grows to roughly 1.18-1.22x
// over the clip and pans stay well inside the resulting crop headroom
// (their pan-left/right use +-40px against a much larger available range,
// ken-burns drifts only ~12% of its headroom). zoomEnd=1.2 and the pan
// fractions below are chosen to match that same conservative ratio rather
// than pushing all the way to the crop edge, so no motion preset can expose
// a black edge regardless of source resolution.
const MOTION_PRESETS = {
  static: null,
  zoomIn: { startZoom: 1, endZoom: 1.2, startFracX: 0, endFracX: 0, startFracY: 0, endFracY: 0 },
  zoomOut: { startZoom: 1.2, endZoom: 1, startFracX: 0, endFracX: 0, startFracY: 0, endFracY: 0 },
  panLeft: { startZoom: 1.15, endZoom: 1.15, startFracX: 0.3, endFracX: -0.3, startFracY: 0, endFracY: 0 },
  panRight: { startZoom: 1.15, endZoom: 1.15, startFracX: -0.3, endFracX: 0.3, startFracY: 0, endFracY: 0 },
  kenBurns: { startZoom: 1, endZoom: 1.2, startFracX: 0, endFracX: -0.25, startFracY: 0, endFracY: -0.25 }
};
const MOTIONS = Object.keys(MOTION_PRESETS);

export class FfmpegImageToVideoToolError extends Error {
  constructor(message, code = "ffmpeg_image_to_video_failed") {
    super(message);
    this.name = "FfmpegImageToVideoToolError";
    this.code = code;
  }
}

async function runCommand(command, args, options) {
  return execFileAsync(command, args, {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    ...options
  });
}

function executableVersion(output) {
  return String(output || "").split(String.fromCharCode(10), 1)[0].trim().split(" ")[2] ?? null;
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === "" || value === "N/A") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.trunc(number);
}

function evenDimension(value) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function safeDetail(value, paths) {
  let detail = String(value || "").trim();
  for (const path of paths) {
    if (path) detail = detail.replaceAll(path, "<project-media>");
  }
  return detail.slice(0, 1000);
}

async function probeImage(executeCommand, command, filePath, timeoutMs) {
  let stdout;
  try {
    ({ stdout } = await executeCommand(
      command,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeout: timeoutMs }
    ));
  } catch (error) {
    const detail = safeDetail(error?.stderr || error?.message, [filePath]);
    throw new FfmpegImageToVideoToolError(
      "ffprobe không thể đọc ảnh." + (detail ? " " + detail : ""),
      error?.code === "ENOENT" ? "tool_unavailable" : "probe_failed"
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
    if (!parsed?.format || !Array.isArray(parsed.streams)) throw new Error();
  } catch {
    throw new FfmpegImageToVideoToolError("ffprobe trả về dữ liệu không hợp lệ.", "invalid_probe_output");
  }
  const video = parsed.streams.find((stream) => stream?.codec_type === "video") ?? null;
  return { hasVideo: Boolean(video), width: integer(video?.width), height: integer(video?.height) };
}

async function probeOutput(executeCommand, command, filePath, timeoutMs) {
  let stdout;
  try {
    ({ stdout } = await executeCommand(
      command,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeout: timeoutMs }
    ));
  } catch (error) {
    const detail = safeDetail(error?.stderr || error?.message, [filePath]);
    throw new FfmpegImageToVideoToolError(
      "ffprobe không thể đọc video." + (detail ? " " + detail : ""),
      error?.code === "ENOENT" ? "tool_unavailable" : "probe_failed"
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
    if (!parsed?.format || !Array.isArray(parsed.streams)) throw new Error();
  } catch {
    throw new FfmpegImageToVideoToolError("ffprobe trả về dữ liệu không hợp lệ.", "invalid_probe_output");
  }
  const video = parsed.streams.find((stream) => stream?.codec_type === "video") ?? null;
  const audio = parsed.streams.find((stream) => stream?.codec_type === "audio") ?? null;
  return {
    durationSeconds: finiteNumber(parsed.format.duration),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: integer(video?.width),
    height: integer(video?.height)
  };
}

function validateSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new FfmpegImageToVideoToolError("image.to-video cần source hợp lệ.", "invalid_input");
  }
  const allowed = source.kind === "resource"
    ? ["kind", "id", "itemPath"]
    : source.kind === "result"
      ? ["kind", "id", "file"]
      : [];
  if (!allowed.length) {
    throw new FfmpegImageToVideoToolError("source.kind phải là resource hoặc result.", "invalid_input");
  }
  const unknown = Object.keys(source).filter((field) => !allowed.includes(field));
  if (unknown.length) {
    throw new FfmpegImageToVideoToolError(
      "source chứa field không được hỗ trợ: " + unknown.join(", "),
      "invalid_input"
    );
  }
  if (typeof source.id !== "string" || !source.id.trim()) {
    throw new FfmpegImageToVideoToolError("source cần id.", "invalid_input");
  }
  if (
    source.itemPath !== undefined &&
    source.itemPath !== null &&
    (typeof source.itemPath !== "string" || !source.itemPath.trim())
  ) {
    throw new FfmpegImageToVideoToolError("source.itemPath không hợp lệ.", "invalid_input");
  }
  if (source.file !== undefined && (typeof source.file !== "string" || !source.file.trim())) {
    throw new FfmpegImageToVideoToolError("source.file không hợp lệ.", "invalid_input");
  }
  return {
    kind: source.kind,
    id: source.id.trim(),
    ...(source.kind === "resource"
      ? { itemPath: source.itemPath?.trim() ?? null }
      : { file: source.file?.trim() ?? "primary" })
  };
}

function motionFilterChain(preset, width, height, totalFrames) {
  const denom = totalFrames - 1;
  const linear = (start, end) => (start === end ? String(start) : `${start}+(${end - start})*on/${denom}`);
  const zExpr = linear(preset.startZoom, preset.endZoom);
  const xFracExpr = linear(preset.startFracX, preset.endFracX);
  const yFracExpr = linear(preset.startFracY, preset.endFracY);
  const xExpr = `(iw-iw/zoom)/2+(${xFracExpr})*(iw-iw/zoom)/2`;
  const yExpr = `(ih-ih/zoom)/2+(${yFracExpr})*(ih-ih/zoom)/2`;
  const scaleFactor = Math.max(1, Math.min(2, MAX_PRESCALE_WIDTH / width));
  const preWidth = evenDimension(width * scaleFactor);
  const preHeight = evenDimension(height * scaleFactor);
  return `scale=${preWidth}:${preHeight},zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${width}x${height}:fps=${OUTPUT_FRAME_RATE}`;
}

export function createFfmpegImageToVideo({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = runCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return {
    name: "ffmpeg-image-to-video",
    version: "1.1.0",
    provider: "FFmpeg",
    capability: "image.to-video",
    description: "Biến một ảnh tĩnh thành đoạn video trong thời lượng cho trước, có thể giữ nguyên khung hình hoặc thêm chuyển động máy quay nhẹ (zoom/pan/Ken Burns).",
    runtime: "local",
    executionMode: "sync",
    inputSchema: {
      type: "object",
      required: ["source", "durationSeconds"],
      properties: {
        source: {
          oneOf: [
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "resource" } } },
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "result" } } }
          ]
        },
        durationSeconds: { type: "number", minimum: MIN_DURATION_SECONDS, maximum: MAX_DURATION_SECONDS },
        motion: { type: "string", enum: MOTIONS }
      }
    },
    outputDescription: "Một video MP4/H.264 dựng từ ảnh nguồn (giữ nguyên khung hình hoặc có chuyển động máy quay nhẹ), kèm provenance và kiểm chứng kỹ thuật.",
    sideEffects: ["Tạo file video mới trong outputs của project."],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    producesFiles: true,

    async checkAvailability() {
      try {
        const [ffmpeg, ffprobe] = await Promise.all([
          executeCommand(ffmpegCommand, ["-version"], { timeout: 5_000 }),
          executeCommand(ffprobeCommand, ["-version"], { timeout: 5_000 })
        ]);
        return {
          status: "available",
          executableVersion: executableVersion(ffmpeg.stdout),
          ffprobeVersion: executableVersion(ffprobe.stdout)
        };
      } catch (error) {
        return {
          status: "unavailable",
          reason: error?.code === "ENOENT"
            ? "Không tìm thấy ffmpeg/ffprobe. Hãy cài FFmpeg hoặc cấu hình đường dẫn."
            : "Không thể chạy ffmpeg/ffprobe: " + (error?.message || "lỗi không xác định")
        };
      }
    },

    async prepare({ store, projectId, inputs, outputWorkspace }) {
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
        throw new FfmpegImageToVideoToolError("Đầu vào image.to-video phải là một object.", "invalid_input");
      }
      const unknown = Object.keys(inputs).filter(
        (field) => !["source", "durationSeconds", "motion"].includes(field)
      );
      if (unknown.length) {
        throw new FfmpegImageToVideoToolError(
          "Đầu vào image.to-video chứa field không được hỗ trợ: " + unknown.join(", "),
          "invalid_input"
        );
      }
      const source = validateSource(inputs.source);
      const durationSeconds = inputs.durationSeconds;
      if (
        !Number.isFinite(durationSeconds) ||
        durationSeconds < MIN_DURATION_SECONDS ||
        durationSeconds > MAX_DURATION_SECONDS
      ) {
        throw new FfmpegImageToVideoToolError(
          `durationSeconds phải trong khoảng ${MIN_DURATION_SECONDS}-${MAX_DURATION_SECONDS} giây.`,
          "invalid_input"
        );
      }
      const motion = inputs.motion ?? "static";
      if (!MOTIONS.includes(motion)) {
        throw new FfmpegImageToVideoToolError("motion không được hỗ trợ.", "invalid_input");
      }
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        throw new FfmpegImageToVideoToolError("PADStudio chưa cấp workspace output.", "invalid_output_workspace");
      }
      const media = await store.resolveMediaSource(projectId, source);
      if (media.mediaType !== "image") {
        throw new FfmpegImageToVideoToolError("image.to-video chỉ nhận nguồn ảnh.", "unsupported_input");
      }
      return {
        runtime: {
          inputPath: media.filePath,
          temporaryOutputPath: join(outputWorkspace.temporaryDirectory, "clip.mp4"),
          durationSeconds,
          motion
        },
        trace: {
          source: media.trace,
          sourceName: media.itemName,
          inputResources: media.inputResources,
          inputResults: media.inputResults,
          finalPath: outputWorkspace.projectRelativeDirectory + "/clip.mp4"
        }
      };
    },

    async execute({ inputPath, temporaryOutputPath, durationSeconds, motion, availability }) {
      const source = await probeImage(executeCommand, ffprobeCommand, inputPath, timeoutMs);
      if (!source.hasVideo || !source.width || !source.height) {
        throw new FfmpegImageToVideoToolError("Không đọc được kích thước ảnh nguồn.", "unsupported_input");
      }
      const width = evenDimension(source.width);
      const height = evenDimension(source.height);
      const totalFrames = Math.round(durationSeconds * OUTPUT_FRAME_RATE);
      const preset = MOTION_PRESETS[motion];
      // A motion curve needs at least two output frames to interpolate over;
      // an extremely short clip falls back to a static hold instead of
      // dividing by zero.
      const effectiveMotion = preset && totalFrames >= 2 ? motion : "static";

      const filter = effectiveMotion === "static"
        ? "scale=trunc(iw/2)*2:trunc(ih/2)*2"
        : motionFilterChain(MOTION_PRESETS[effectiveMotion], width, height, totalFrames);

      const args = [
        "-hide_banner", "-loglevel", "error",
        "-loop", "1", "-i", inputPath,
        "-t", String(durationSeconds),
        "-vf", filter,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p"
      ];
      if (effectiveMotion === "static") args.push("-r", String(OUTPUT_FRAME_RATE));
      args.push("-y", temporaryOutputPath);

      try {
        await executeCommand(ffmpegCommand, args, { timeout: timeoutMs });
      } catch (error) {
        if (error?.killed || error?.code === "ETIMEDOUT") {
          throw new FfmpegImageToVideoToolError("ffmpeg vượt quá giới hạn " + timeoutMs + " ms.", "timeout");
        }
        const detail = safeDetail(error?.stderr || error?.message, [inputPath, temporaryOutputPath]);
        throw new FfmpegImageToVideoToolError(
          "ffmpeg không thể tạo video từ ảnh." + (detail ? " " + detail : ""),
          error?.code === "ENOENT" ? "tool_unavailable" : "ffmpeg_failed"
        );
      }

      let info;
      try {
        info = await lstat(temporaryOutputPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new FfmpegImageToVideoToolError("ffmpeg không tạo file video đầu ra.", "invalid_output");
        }
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
        throw new FfmpegImageToVideoToolError("ffmpeg không tạo được file video hợp lệ.", "invalid_output");
      }

      const output = await probeOutput(executeCommand, ffprobeCommand, temporaryOutputPath, timeoutMs);
      const durationDifference = output.durationSeconds === null
        ? Infinity
        : Math.abs(output.durationSeconds - durationSeconds);
      if (
        !output.hasVideo ||
        output.hasAudio ||
        output.width !== width ||
        output.height !== height ||
        durationDifference > DURATION_TOLERANCE_SECONDS
      ) {
        throw new FfmpegImageToVideoToolError("Video đầu ra không vượt qua kiểm tra khung hình/thời lượng.", "invalid_output");
      }

      return {
        file: { sizeBytes: info.size },
        source,
        output,
        effectiveMotion,
        verification: {
          status: "passed",
          checks: ["ffmpeg_exit_0", "output_file_present", "video_stream_present", "resolution_matches_source", "duration_within_0.25_seconds"],
          details: {
            sourceResolution: `${source.width}x${source.height}`,
            outputResolution: `${output.width}x${output.height}`,
            frameRate: OUTPUT_FRAME_RATE,
            motion: effectiveMotion,
            executableVersion: availability.executableVersion ?? null
          }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      return {
        type: "video.clip",
        name: "Video từ ảnh: " + prepared.trace.sourceName,
        inputResources: prepared.trace.inputResources,
        inputResults: prepared.trace.inputResults,
        files: [{
          id: "primary",
          role: "primary",
          path: prepared.trace.finalPath,
          name: "clip.mp4",
          mediaType: "video",
          sizeBytes: execution.file.sizeBytes
        }],
        data: {
          source: prepared.trace.source,
          motion: execution.effectiveMotion,
          durationSeconds: execution.output.durationSeconds,
          video: { width: execution.output.width, height: execution.output.height, frameRate: OUTPUT_FRAME_RATE },
          hasAudio: false
        },
        verification: execution.verification
      };
    }
  };
}
