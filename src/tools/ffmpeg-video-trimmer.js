import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DURATION_TOLERANCE_SECONDS = 0.25;

export class FfmpegTrimToolError extends Error {
  constructor(message, code = "ffmpeg_trim_failed") {
    super(message);
    this.name = "FfmpegTrimToolError";
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
    throw new FfmpegTrimToolError(
      "ffprobe không thể đọc video." + (detail ? " " + detail : ""),
      error?.code === "ENOENT" ? "tool_unavailable" : "probe_failed"
    );
  }
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed?.format || !Array.isArray(parsed.streams)) throw new Error();
    return {
      durationSeconds: finiteNumber(parsed.format.duration),
      hasVideo: parsed.streams.some((stream) => stream?.codec_type === "video"),
      hasAudio: parsed.streams.some((stream) => stream?.codec_type === "audio"),
      video: parsed.streams.find((stream) => stream?.codec_type === "video") ?? null
    };
  } catch {
    throw new FfmpegTrimToolError("ffprobe trả về dữ liệu media không hợp lệ.", "invalid_probe_output");
  }
}

function validateSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new FfmpegTrimToolError("video.trim cần source hợp lệ.", "invalid_input");
  }
  const allowed = source.kind === "resource"
    ? ["kind", "id", "itemPath"]
    : source.kind === "result"
      ? ["kind", "id", "file"]
      : [];
  if (!allowed.length) {
    throw new FfmpegTrimToolError("source.kind phải là resource hoặc result.", "invalid_input");
  }
  const unknown = Object.keys(source).filter((field) => !allowed.includes(field));
  if (unknown.length) {
    throw new FfmpegTrimToolError(
      "source chứa field không được hỗ trợ: " + unknown.join(", "),
      "invalid_input"
    );
  }
  if (typeof source.id !== "string" || !source.id.trim()) {
    throw new FfmpegTrimToolError("source cần id.", "invalid_input");
  }
  if (
    source.itemPath !== undefined &&
    source.itemPath !== null &&
    (typeof source.itemPath !== "string" || !source.itemPath.trim())
  ) {
    throw new FfmpegTrimToolError("source.itemPath không hợp lệ.", "invalid_input");
  }
  if (
    source.file !== undefined &&
    (typeof source.file !== "string" || !source.file.trim())
  ) {
    throw new FfmpegTrimToolError("source.file không hợp lệ.", "invalid_input");
  }
  return {
    kind: source.kind,
    id: source.id.trim(),
    ...(source.kind === "resource"
      ? { itemPath: source.itemPath?.trim() ?? null }
      : { file: source.file?.trim() ?? "primary" })
  };
}

export function createFfmpegVideoTrimmer({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = runCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return {
    name: "ffmpeg-trim",
    version: "1.0.0",
    provider: "FFmpeg",
    capability: "video.trim",
    description: "Cắt chính xác một đoạn video và tạo file MP4 mới trong project.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: {
      type: "object",
      required: ["source", "startSeconds", "endSeconds"],
      properties: {
        source: {
          oneOf: [
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "resource" } } },
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "result" } } }
          ]
        },
        startSeconds: { type: "number", minimum: 0 },
        endSeconds: { type: "number", exclusiveMinimum: 0 }
      }
    },
    outputDescription: "Một video MP4/H.264 đã cắt, kèm provenance và kiểm chứng kỹ thuật.",
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
        throw new FfmpegTrimToolError("Đầu vào video.trim phải là một object.", "invalid_input");
      }
      const unknown = Object.keys(inputs).filter(
        (field) => !["source", "startSeconds", "endSeconds"].includes(field)
      );
      if (unknown.length) {
        throw new FfmpegTrimToolError(
          "Đầu vào video.trim chứa field không được hỗ trợ: " + unknown.join(", "),
          "invalid_input"
        );
      }
      const source = validateSource(inputs.source);
      const startSeconds = inputs.startSeconds;
      const endSeconds = inputs.endSeconds;
      if (!Number.isFinite(startSeconds) || startSeconds < 0) {
        throw new FfmpegTrimToolError("startSeconds phải là số không âm.", "invalid_input");
      }
      if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
        throw new FfmpegTrimToolError("endSeconds phải lớn hơn startSeconds.", "invalid_input");
      }
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        throw new FfmpegTrimToolError("PADStudio chưa cấp workspace output.", "invalid_output_workspace");
      }
      const media = await store.resolveMediaSource(projectId, source);
      if (media.mediaType !== "video") {
        throw new FfmpegTrimToolError("video.trim chỉ nhận nguồn video.", "unsupported_input");
      }
      return {
        runtime: {
          inputPath: media.filePath,
          temporaryOutputPath: join(outputWorkspace.temporaryDirectory, "clip.mp4"),
          startSeconds,
          endSeconds
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

    async execute({ inputPath, temporaryOutputPath, startSeconds, endSeconds, availability }) {
      const source = await probeMedia(executeCommand, ffprobeCommand, inputPath, timeoutMs);
      if (!source.hasVideo || source.durationSeconds === null) {
        throw new FfmpegTrimToolError("Nguồn không có video hoặc không xác định được thời lượng.", "unsupported_input");
      }
      if (endSeconds > source.durationSeconds + 0.001) {
        throw new FfmpegTrimToolError(
          "endSeconds vượt quá thời lượng nguồn " + source.durationSeconds + " giây.",
          "invalid_input"
        );
      }
      const requestedDuration = endSeconds - startSeconds;
      try {
        await executeCommand(
          ffmpegCommand,
          [
            "-hide_banner", "-loglevel", "error", "-i", inputPath,
            "-ss", String(startSeconds), "-t", String(requestedDuration),
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-c:a", "aac", "-movflags", "+faststart", "-y", temporaryOutputPath
          ],
          { timeout: timeoutMs }
        );
      } catch (error) {
        if (error?.killed || error?.code === "ETIMEDOUT") {
          throw new FfmpegTrimToolError("ffmpeg vượt quá giới hạn " + timeoutMs + " ms.", "timeout");
        }
        const detail = safeDetail(error?.stderr || error?.message, [inputPath, temporaryOutputPath]);
        throw new FfmpegTrimToolError(
          "ffmpeg không thể cắt video." + (detail ? " " + detail : ""),
          error?.code === "ENOENT" ? "tool_unavailable" : "ffmpeg_failed"
        );
      }

      let info;
      try {
        info = await lstat(temporaryOutputPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new FfmpegTrimToolError("ffmpeg không tạo file video đầu ra.", "invalid_output");
        }
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
        throw new FfmpegTrimToolError("ffmpeg không tạo được file video hợp lệ.", "invalid_output");
      }
      const output = await probeMedia(executeCommand, ffprobeCommand, temporaryOutputPath, timeoutMs);
      const durationDifference = output.durationSeconds === null
        ? Infinity
        : Math.abs(output.durationSeconds - requestedDuration);
      if (!output.hasVideo || durationDifference > DURATION_TOLERANCE_SECONDS) {
        throw new FfmpegTrimToolError("Video đầu ra không vượt qua kiểm tra thời lượng/stream.", "invalid_output");
      }
      if (source.hasAudio && !output.hasAudio) {
        throw new FfmpegTrimToolError("Video đầu ra bị mất audio.", "invalid_output");
      }
      return {
        file: { sizeBytes: info.size },
        output,
        verification: {
          status: "passed",
          checks: [
            "ffmpeg_exit_0", "output_file_present", "video_stream_present",
            "duration_within_0.25_seconds",
            ...(source.hasAudio ? ["audio_stream_preserved"] : [])
          ],
          details: {
            requestedDurationSeconds: requestedDuration,
            actualDurationSeconds: output.durationSeconds,
            toleranceSeconds: DURATION_TOLERANCE_SECONDS,
            executableVersion: availability.executableVersion ?? null
          }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      return {
        type: "video.clip",
        name: "Clip: " + prepared.trace.sourceName,
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
          startSeconds: prepared.runtime.startSeconds,
          endSeconds: prepared.runtime.endSeconds,
          durationSeconds: execution.output.durationSeconds,
          cutMode: "accurate",
          video: {
            width: finiteNumber(execution.output.video?.width),
            height: finiteNumber(execution.output.video?.height),
            frameRate: execution.output.video?.avg_frame_rate ?? null
          },
          hasAudio: execution.output.hasAudio
        },
        verification: execution.verification
      };
    }
  };
}
