import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export class FfmpegThumbnailToolError extends Error {
  constructor(message, code = "ffmpeg_thumbnail_failed") {
    super(message);
    this.name = "FfmpegThumbnailToolError";
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
    throw new FfmpegThumbnailToolError(
      "ffprobe không thể đọc file." + (detail ? " " + detail : ""),
      error?.code === "ENOENT" ? "tool_unavailable" : "probe_failed"
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
    if (!parsed?.format || !Array.isArray(parsed.streams)) throw new Error();
  } catch {
    throw new FfmpegThumbnailToolError("ffprobe trả về dữ liệu media không hợp lệ.", "invalid_probe_output");
  }
  const video = parsed.streams.find((stream) => stream?.codec_type === "video") ?? null;
  return {
    durationSeconds: finiteNumber(parsed.format.duration),
    hasVideo: Boolean(video),
    width: integer(video?.width),
    height: integer(video?.height)
  };
}

function validateSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new FfmpegThumbnailToolError("video.thumbnail cần source hợp lệ.", "invalid_input");
  }
  const allowed = source.kind === "resource"
    ? ["kind", "id", "itemPath"]
    : source.kind === "result"
      ? ["kind", "id", "file"]
      : [];
  if (!allowed.length) {
    throw new FfmpegThumbnailToolError("source.kind phải là resource hoặc result.", "invalid_input");
  }
  const unknown = Object.keys(source).filter((field) => !allowed.includes(field));
  if (unknown.length) {
    throw new FfmpegThumbnailToolError(
      "source chứa field không được hỗ trợ: " + unknown.join(", "),
      "invalid_input"
    );
  }
  if (typeof source.id !== "string" || !source.id.trim()) {
    throw new FfmpegThumbnailToolError("source cần id.", "invalid_input");
  }
  if (
    source.itemPath !== undefined &&
    source.itemPath !== null &&
    (typeof source.itemPath !== "string" || !source.itemPath.trim())
  ) {
    throw new FfmpegThumbnailToolError("source.itemPath không hợp lệ.", "invalid_input");
  }
  if (source.file !== undefined && (typeof source.file !== "string" || !source.file.trim())) {
    throw new FfmpegThumbnailToolError("source.file không hợp lệ.", "invalid_input");
  }
  return {
    kind: source.kind,
    id: source.id.trim(),
    ...(source.kind === "resource"
      ? { itemPath: source.itemPath?.trim() ?? null }
      : { file: source.file?.trim() ?? "primary" })
  };
}

export function createFfmpegVideoThumbnailer({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = runCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return {
    name: "ffmpeg-thumbnail",
    version: "1.0.0",
    provider: "FFmpeg",
    capability: "video.thumbnail",
    description: "Trích chính xác một khung hình của video làm ảnh đại diện.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: {
      type: "object",
      required: ["source", "atSeconds"],
      properties: {
        source: {
          oneOf: [
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "resource" } } },
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "result" } } }
          ]
        },
        atSeconds: { type: "number", minimum: 0 }
      }
    },
    outputDescription: "Một ảnh PNG trích từ video, kèm provenance và kiểm chứng kỹ thuật.",
    sideEffects: ["Tạo file ảnh mới trong outputs của project."],
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
        throw new FfmpegThumbnailToolError("Đầu vào video.thumbnail phải là một object.", "invalid_input");
      }
      const unknown = Object.keys(inputs).filter(
        (field) => !["source", "atSeconds"].includes(field)
      );
      if (unknown.length) {
        throw new FfmpegThumbnailToolError(
          "Đầu vào video.thumbnail chứa field không được hỗ trợ: " + unknown.join(", "),
          "invalid_input"
        );
      }
      const source = validateSource(inputs.source);
      const atSeconds = inputs.atSeconds;
      if (!Number.isFinite(atSeconds) || atSeconds < 0) {
        throw new FfmpegThumbnailToolError("atSeconds phải là số không âm.", "invalid_input");
      }
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        throw new FfmpegThumbnailToolError("PADStudio chưa cấp workspace output.", "invalid_output_workspace");
      }
      const media = await store.resolveMediaSource(projectId, source);
      if (media.mediaType !== "video") {
        throw new FfmpegThumbnailToolError("video.thumbnail chỉ nhận nguồn video.", "unsupported_input");
      }
      return {
        runtime: {
          inputPath: media.filePath,
          temporaryOutputPath: join(outputWorkspace.temporaryDirectory, "thumbnail.png"),
          atSeconds
        },
        trace: {
          source: media.trace,
          sourceName: media.itemName,
          inputResources: media.inputResources,
          inputResults: media.inputResults,
          finalPath: outputWorkspace.projectRelativeDirectory + "/thumbnail.png"
        }
      };
    },

    async execute({ inputPath, temporaryOutputPath, atSeconds, availability }) {
      const source = await probeMedia(executeCommand, ffprobeCommand, inputPath, timeoutMs);
      if (!source.hasVideo || source.durationSeconds === null) {
        throw new FfmpegThumbnailToolError(
          "Nguồn không có video hoặc không xác định được thời lượng.",
          "unsupported_input"
        );
      }
      if (atSeconds >= source.durationSeconds) {
        throw new FfmpegThumbnailToolError(
          "atSeconds vượt quá thời lượng nguồn " + source.durationSeconds + " giây.",
          "invalid_input"
        );
      }

      try {
        // Seek after -i (not before) so the extracted frame lands exactly at
        // atSeconds instead of the nearest preceding keyframe — a single-frame
        // decode is cheap, so there is no reason to trade away that precision.
        await executeCommand(
          ffmpegCommand,
          [
            "-hide_banner", "-loglevel", "error", "-i", inputPath,
            "-ss", String(atSeconds), "-frames:v", "1",
            "-y", temporaryOutputPath
          ],
          { timeout: timeoutMs }
        );
      } catch (error) {
        if (error?.killed || error?.code === "ETIMEDOUT") {
          throw new FfmpegThumbnailToolError("ffmpeg vượt quá giới hạn " + timeoutMs + " ms.", "timeout");
        }
        const detail = safeDetail(error?.stderr || error?.message, [inputPath, temporaryOutputPath]);
        throw new FfmpegThumbnailToolError(
          "ffmpeg không thể trích khung hình." + (detail ? " " + detail : ""),
          error?.code === "ENOENT" ? "tool_unavailable" : "ffmpeg_failed"
        );
      }

      let info;
      try {
        info = await lstat(temporaryOutputPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new FfmpegThumbnailToolError("ffmpeg không tạo file ảnh đầu ra.", "invalid_output");
        }
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
        throw new FfmpegThumbnailToolError("ffmpeg không tạo được file ảnh hợp lệ.", "invalid_output");
      }

      const output = await probeMedia(executeCommand, ffprobeCommand, temporaryOutputPath, timeoutMs);
      if (!output.hasVideo || output.width !== source.width || output.height !== source.height) {
        throw new FfmpegThumbnailToolError("Ảnh đầu ra không vượt qua kiểm tra khung hình.", "invalid_output");
      }

      return {
        file: { sizeBytes: info.size },
        source,
        output,
        verification: {
          status: "passed",
          checks: ["ffmpeg_exit_0", "output_file_present", "image_stream_present", "resolution_matches_source"],
          details: {
            atSeconds,
            sourceResolution: `${source.width}x${source.height}`,
            executableVersion: availability.executableVersion ?? null
          }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      return {
        type: "image.thumbnail",
        name: "Ảnh đại diện: " + prepared.trace.sourceName,
        inputResources: prepared.trace.inputResources,
        inputResults: prepared.trace.inputResults,
        files: [{
          id: "primary",
          role: "primary",
          path: prepared.trace.finalPath,
          name: "thumbnail.png",
          mediaType: "image",
          sizeBytes: execution.file.sizeBytes
        }],
        data: {
          source: prepared.trace.source,
          atSeconds: prepared.runtime.atSeconds,
          resolution: { width: execution.output.width, height: execution.output.height }
        },
        verification: execution.verification
      };
    }
  };
}
