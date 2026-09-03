import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export class FfprobeToolError extends Error {
  constructor(message, code = "ffprobe_failed") {
    super(message);
    this.name = "FfprobeToolError";
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

function finiteNumber(value) {
  if (value === undefined || value === null || value === "N/A" || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.trunc(number);
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined)
  );
}

function safeDetail(value, filePath) {
  const detail = String(value || "").trim().replaceAll(filePath, "<project-input>");
  return detail.slice(0, 1000);
}

function normalizeStream(stream) {
  const common = {
    index: integer(stream.index),
    type: stream.codec_type,
    codec: stream.codec_name,
    codecLongName: stream.codec_long_name,
    profile: stream.profile,
    durationSeconds: finiteNumber(stream.duration),
    bitRate: integer(stream.bit_rate),
    language: stream.tags?.language
  };
  if (stream.codec_type === "video") {
    return compact({
      ...common,
      width: integer(stream.width),
      height: integer(stream.height),
      pixelFormat: stream.pix_fmt,
      frameRate: stream.avg_frame_rate
    });
  }
  if (stream.codec_type === "audio") {
    return compact({
      ...common,
      sampleRate: integer(stream.sample_rate),
      channels: integer(stream.channels),
      channelLayout: stream.channel_layout
    });
  }
  return compact(common);
}

function normalizeProbeData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FfprobeToolError("ffprobe trả về JSON không hợp lệ.", "invalid_output");
  }
  if (!value.format || typeof value.format !== "object" || !Array.isArray(value.streams)) {
    throw new FfprobeToolError("ffprobe không trả đủ format và streams.", "invalid_output");
  }
  if (value.streams.some((stream) => !stream || typeof stream !== "object" || Array.isArray(stream))) {
    throw new FfprobeToolError("ffprobe trả về stream không hợp lệ.", "invalid_output");
  }
  return {
    format: compact({
      name: value.format.format_name,
      longName: value.format.format_long_name,
      durationSeconds: finiteNumber(value.format.duration),
      sizeBytes: integer(value.format.size),
      bitRate: integer(value.format.bit_rate),
      startTimeSeconds: finiteNumber(value.format.start_time)
    }),
    streams: value.streams.map(normalizeStream)
  };
}

function executableVersion(output) {
  const firstLine = String(output || "").split(/\r?\n/, 1)[0].trim();
  const match = /^ffprobe version\s+([^\s]+)/i.exec(firstLine);
  return match?.[1] ?? null;
}

export function createFfprobeMediaInspector({
  command = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = runCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return {
    name: "ffprobe",
    version: "1.0.0",
    provider: "FFmpeg",
    capability: "media.inspect",
    description: "Đọc metadata kỹ thuật của một file audio hoặc video trong project.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: {
      type: "object",
      required: ["resourceId"],
      properties: {
        resourceId: { type: "string" },
        itemPath: { type: ["string", "null"] }
      }
    },
    outputDescription: "Format, duration, kích thước, bitrate và các audio/video stream.",
    sideEffects: [],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,

    async checkAvailability() {
      try {
        const { stdout } = await executeCommand(command, ["-version"], { timeout: 5_000 });
        return {
          status: "available",
          executableVersion: executableVersion(stdout)
        };
      } catch (error) {
        const reason = error?.code === "ENOENT"
          ? "Không tìm thấy ffprobe. Hãy cài FFmpeg hoặc đặt PADSTUDIO_FFPROBE_PATH."
          : "Không thể chạy ffprobe: " + (error?.message || "lỗi không xác định");
        return { status: "unavailable", reason };
      }
    },

    async prepare({ store, projectId, inputs }) {
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
        throw new FfprobeToolError("Đầu vào media.inspect phải là một object.", "invalid_input");
      }
      const unknown = Object.keys(inputs).filter(
        (field) => !["resourceId", "itemPath"].includes(field)
      );
      if (unknown.length) {
        throw new FfprobeToolError(
          "Đầu vào media.inspect chứa field không được hỗ trợ: " + unknown.join(", "),
          "invalid_input"
        );
      }
      if (typeof inputs.resourceId !== "string" || !inputs.resourceId.trim()) {
        throw new FfprobeToolError("media.inspect cần resourceId.", "invalid_input");
      }
      if (
        inputs.itemPath !== undefined &&
        inputs.itemPath !== null &&
        (typeof inputs.itemPath !== "string" || !inputs.itemPath.trim())
      ) {
        throw new FfprobeToolError("itemPath không hợp lệ.", "invalid_input");
      }
      const input = await store.resolveInputResourceItem(projectId, {
        resourceId: inputs.resourceId.trim(),
        itemPath: inputs.itemPath?.trim() ?? null
      });
      if (!["audio", "video"].includes(input.mediaType)) {
        throw new FfprobeToolError(
          "ffprobe chỉ phân tích resource audio hoặc video; file đã chọn có loại " +
            input.mediaType + ".",
          "unsupported_input"
        );
      }
      return {
        runtime: { filePath: input.filePath },
        trace: {
          resourceId: input.resourceId,
          itemPath: input.itemPath,
          itemName: input.itemName,
          mediaType: input.mediaType
        }
      };
    },

    async execute({ filePath, availability }) {
      let stdout;
      try {
        ({ stdout } = await executeCommand(
          command,
          ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
          { timeout: timeoutMs }
        ));
      } catch (error) {
        if (error?.killed || error?.code === "ETIMEDOUT") {
          throw new FfprobeToolError(
            "ffprobe vượt quá giới hạn " + timeoutMs + " ms.",
            "timeout"
          );
        }
        if (error?.code === "ENOENT") {
          throw new FfprobeToolError("ffprobe không còn khả dụng.", "tool_unavailable");
        }
        const detail = safeDetail(error?.stderr || error?.message, filePath);
        throw new FfprobeToolError(
          "ffprobe không thể đọc file." + (detail ? " " + detail : ""),
          "ffprobe_failed"
        );
      }

      let raw;
      try {
        raw = JSON.parse(stdout);
      } catch {
        throw new FfprobeToolError("ffprobe trả về dữ liệu không phải JSON.", "invalid_output");
      }
      return {
        data: normalizeProbeData(raw),
        verification: {
          status: "passed",
          checks: ["ffprobe_exit_0", "valid_json", "format_and_streams_present"],
          details: {
            executableVersion: availability.executableVersion ?? null
          }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      return {
        type: "media.metadata",
        name: "Metadata: " + prepared.trace.itemName,
        inputResources: [prepared.trace.resourceId],
        data: {
          source: prepared.trace,
          media: execution.data
        },
        verification: execution.verification
      };
    }
  };
}
