import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DURATION_TOLERANCE_SECONDS = 0.25;
const MIN_DIMENSION = 16;
const MAX_DIMENSION = 7680;
const FIT_MODES = ["pad", "crop"];

// Named aspect presets, borrowed from a widely used reframing convention
// (portrait/square/landscape/cinematic/4:5) rather than invented dimensions.
const ASPECT_PRESETS = {
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
  cinematic: { width: 2560, height: 1080 },
  vertical4x5: { width: 1080, height: 1350 }
};

export class FfmpegReformatToolError extends Error {
  constructor(message, code = "ffmpeg_reformat_failed") {
    super(message);
    this.name = "FfmpegReformatToolError";
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

function safeDetail(value, paths) {
  let detail = String(value || "").trim();
  for (const path of paths) {
    if (path) detail = detail.replaceAll(path, "<project-media>");
  }
  return detail.slice(0, 1000);
}

async function probeMedia(executeCommand, command, filePath, timeoutMs) {
  let stdout;
  try {
    ({ stdout } = await executeCommand(
      command,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeout: timeoutMs }
    ));
  } catch (error) {
    const detail = safeDetail(error?.stderr || error?.message, [filePath]);
    throw new FfmpegReformatToolError(
      "ffprobe không thể đọc video." + (detail ? " " + detail : ""),
      error?.code === "ENOENT" ? "tool_unavailable" : "probe_failed"
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
    if (!parsed?.format || !Array.isArray(parsed.streams)) throw new Error();
  } catch {
    throw new FfmpegReformatToolError("ffprobe trả về dữ liệu media không hợp lệ.", "invalid_probe_output");
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
    throw new FfmpegReformatToolError("video.reformat cần source hợp lệ.", "invalid_input");
  }
  const allowed = source.kind === "resource"
    ? ["kind", "id", "itemPath"]
    : source.kind === "result"
      ? ["kind", "id", "file"]
      : [];
  if (!allowed.length) {
    throw new FfmpegReformatToolError("source.kind phải là resource hoặc result.", "invalid_input");
  }
  const unknown = Object.keys(source).filter((field) => !allowed.includes(field));
  if (unknown.length) {
    throw new FfmpegReformatToolError(
      "source chứa field không được hỗ trợ: " + unknown.join(", "),
      "invalid_input"
    );
  }
  if (typeof source.id !== "string" || !source.id.trim()) {
    throw new FfmpegReformatToolError("source cần id.", "invalid_input");
  }
  if (
    source.itemPath !== undefined &&
    source.itemPath !== null &&
    (typeof source.itemPath !== "string" || !source.itemPath.trim())
  ) {
    throw new FfmpegReformatToolError("source.itemPath không hợp lệ.", "invalid_input");
  }
  if (source.file !== undefined && (typeof source.file !== "string" || !source.file.trim())) {
    throw new FfmpegReformatToolError("source.file không hợp lệ.", "invalid_input");
  }
  return {
    kind: source.kind,
    id: source.id.trim(),
    ...(source.kind === "resource"
      ? { itemPath: source.itemPath?.trim() ?? null }
      : { file: source.file?.trim() ?? "primary" })
  };
}

function evenDimension(value) {
  return value % 2 === 0 ? value : value - 1;
}

function resolveTargetDimensions(inputs) {
  const hasPreset = inputs.preset !== undefined;
  const hasExplicit = inputs.width !== undefined || inputs.height !== undefined;
  if (hasPreset === hasExplicit) {
    throw new FfmpegReformatToolError(
      "Chỉ định đúng một trong hai cách: preset hoặc cả width và height.",
      "invalid_input"
    );
  }
  if (hasPreset) {
    const preset = ASPECT_PRESETS[inputs.preset];
    if (!preset) {
      throw new FfmpegReformatToolError("preset không được hỗ trợ.", "invalid_input");
    }
    return { width: preset.width, height: preset.height };
  }
  const { width, height } = inputs;
  if (
    !Number.isInteger(width) || width < MIN_DIMENSION || width > MAX_DIMENSION ||
    !Number.isInteger(height) || height < MIN_DIMENSION || height > MAX_DIMENSION
  ) {
    throw new FfmpegReformatToolError(
      `width và height phải là số nguyên trong khoảng ${MIN_DIMENSION}-${MAX_DIMENSION}.`,
      "invalid_input"
    );
  }
  return { width: evenDimension(width), height: evenDimension(height) };
}

export function createFfmpegVideoReformatter({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = runCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return {
    name: "ffmpeg-reformat",
    version: "1.0.0",
    provider: "FFmpeg",
    capability: "video.reformat",
    description: "Đổi tỷ lệ khung hình hoặc độ phân giải của video cho một nền tảng đích.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: {
      type: "object",
      required: ["source"],
      properties: {
        source: {
          oneOf: [
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "resource" } } },
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "result" } } }
          ]
        },
        preset: { type: "string", enum: Object.keys(ASPECT_PRESETS) },
        width: { type: "integer", minimum: MIN_DIMENSION, maximum: MAX_DIMENSION },
        height: { type: "integer", minimum: MIN_DIMENSION, maximum: MAX_DIMENSION },
        fit: { type: "string", enum: FIT_MODES }
      }
    },
    outputDescription: "Một video MP4/H.264 đã đổi khung hình, kèm provenance và kiểm chứng kỹ thuật.",
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
        throw new FfmpegReformatToolError("Đầu vào video.reformat phải là một object.", "invalid_input");
      }
      const unknown = Object.keys(inputs).filter(
        (field) => !["source", "preset", "width", "height", "fit"].includes(field)
      );
      if (unknown.length) {
        throw new FfmpegReformatToolError(
          "Đầu vào video.reformat chứa field không được hỗ trợ: " + unknown.join(", "),
          "invalid_input"
        );
      }
      const source = validateSource(inputs.source);
      const { width: targetWidth, height: targetHeight } = resolveTargetDimensions(inputs);
      const fit = inputs.fit ?? "pad";
      if (!FIT_MODES.includes(fit)) {
        throw new FfmpegReformatToolError("fit phải là pad hoặc crop.", "invalid_input");
      }
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        throw new FfmpegReformatToolError("PADStudio chưa cấp workspace output.", "invalid_output_workspace");
      }
      const media = await store.resolveMediaSource(projectId, source);
      if (media.mediaType !== "video") {
        throw new FfmpegReformatToolError("video.reformat chỉ nhận nguồn video.", "unsupported_input");
      }
      return {
        runtime: {
          inputPath: media.filePath,
          temporaryOutputPath: join(outputWorkspace.temporaryDirectory, "clip.mp4"),
          targetWidth,
          targetHeight,
          fit
        },
        trace: {
          source: media.trace,
          sourceName: media.itemName,
          inputResources: media.inputResources,
          inputResults: media.inputResults,
          finalPath: outputWorkspace.projectRelativeDirectory + "/clip.mp4",
          preset: inputs.preset ?? null
        }
      };
    },

    async execute({ inputPath, temporaryOutputPath, targetWidth, targetHeight, fit, availability }) {
      const source = await probeMedia(executeCommand, ffprobeCommand, inputPath, timeoutMs);
      if (!source.hasVideo || source.durationSeconds === null) {
        throw new FfmpegReformatToolError(
          "Nguồn không có video hoặc không xác định được thời lượng.",
          "unsupported_input"
        );
      }

      const filters = fit === "pad"
        ? `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`
        : `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`;

      try {
        await executeCommand(
          ffmpegCommand,
          [
            "-hide_banner", "-loglevel", "error", "-i", inputPath,
            "-vf", filters,
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-c:a", "aac", "-pix_fmt", "yuv420p",
            "-y", temporaryOutputPath
          ],
          { timeout: timeoutMs }
        );
      } catch (error) {
        if (error?.killed || error?.code === "ETIMEDOUT") {
          throw new FfmpegReformatToolError("ffmpeg vượt quá giới hạn " + timeoutMs + " ms.", "timeout");
        }
        const detail = safeDetail(error?.stderr || error?.message, [inputPath, temporaryOutputPath]);
        throw new FfmpegReformatToolError(
          "ffmpeg không thể đổi khung hình video." + (detail ? " " + detail : ""),
          error?.code === "ENOENT" ? "tool_unavailable" : "ffmpeg_failed"
        );
      }

      let info;
      try {
        info = await lstat(temporaryOutputPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new FfmpegReformatToolError("ffmpeg không tạo file video đầu ra.", "invalid_output");
        }
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
        throw new FfmpegReformatToolError("ffmpeg không tạo được file video hợp lệ.", "invalid_output");
      }

      const output = await probeMedia(executeCommand, ffprobeCommand, temporaryOutputPath, timeoutMs);
      const durationDifference = output.durationSeconds === null
        ? Infinity
        : Math.abs(output.durationSeconds - source.durationSeconds);
      if (
        !output.hasVideo ||
        output.width !== targetWidth ||
        output.height !== targetHeight ||
        durationDifference > DURATION_TOLERANCE_SECONDS
      ) {
        throw new FfmpegReformatToolError("Video đầu ra không vượt qua kiểm tra khung hình/thời lượng.", "invalid_output");
      }
      if (source.hasAudio && !output.hasAudio) {
        throw new FfmpegReformatToolError("Video đầu ra bị mất audio.", "invalid_output");
      }

      return {
        file: { sizeBytes: info.size },
        source,
        output,
        verification: {
          status: "passed",
          checks: [
            "ffmpeg_exit_0", "output_file_present", "video_stream_present",
            "target_resolution_matched", "duration_within_0.25_seconds",
            ...(source.hasAudio ? ["audio_stream_preserved"] : [])
          ],
          details: {
            sourceResolution: `${source.width}x${source.height}`,
            targetResolution: `${targetWidth}x${targetHeight}`,
            fit,
            toleranceSeconds: DURATION_TOLERANCE_SECONDS,
            executableVersion: availability.executableVersion ?? null
          }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      return {
        type: "video.reformatted",
        name: "Đổi khung hình: " + prepared.trace.sourceName,
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
          preset: prepared.trace.preset,
          fit: prepared.runtime.fit,
          sourceResolution: { width: execution.source.width, height: execution.source.height },
          targetResolution: { width: prepared.runtime.targetWidth, height: prepared.runtime.targetHeight },
          durationSeconds: execution.output.durationSeconds,
          hasAudio: execution.output.hasAudio
        },
        verification: execution.verification
      };
    }
  };
}
