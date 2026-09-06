import { execFile } from "node:child_process";
import { lstat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DURATION_TOLERANCE_SECONDS = 0.25;
const MAX_CUES = 2000;
// Vetted defaults for readable burned-in captions (bottom-center, white text
// with a black outline, no background box) split by orientation so a caption
// sized for a landscape frame does not overwhelm a portrait one.
const ORIENTATION_STYLE = {
  portrait: { fontSize: 18, marginV: 50 },
  landscape: { fontSize: 22, marginV: 40 }
};

export class FfmpegSubtitleBurnToolError extends Error {
  constructor(message, code = "ffmpeg_subtitle_burn_failed") {
    super(message);
    this.name = "FfmpegSubtitleBurnToolError";
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
    throw new FfmpegSubtitleBurnToolError(
      "ffprobe không thể đọc video." + (detail ? " " + detail : ""),
      error?.code === "ENOENT" ? "tool_unavailable" : "probe_failed"
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
    if (!parsed?.format || !Array.isArray(parsed.streams)) throw new Error();
  } catch {
    throw new FfmpegSubtitleBurnToolError("ffprobe trả về dữ liệu media không hợp lệ.", "invalid_probe_output");
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
    throw new FfmpegSubtitleBurnToolError("subtitle.burn cần source hợp lệ.", "invalid_input");
  }
  const allowed = source.kind === "resource"
    ? ["kind", "id", "itemPath"]
    : source.kind === "result"
      ? ["kind", "id", "file"]
      : [];
  if (!allowed.length) {
    throw new FfmpegSubtitleBurnToolError("source.kind phải là resource hoặc result.", "invalid_input");
  }
  const unknown = Object.keys(source).filter((field) => !allowed.includes(field));
  if (unknown.length) {
    throw new FfmpegSubtitleBurnToolError(
      "source chứa field không được hỗ trợ: " + unknown.join(", "),
      "invalid_input"
    );
  }
  if (typeof source.id !== "string" || !source.id.trim()) {
    throw new FfmpegSubtitleBurnToolError("source cần id.", "invalid_input");
  }
  if (
    source.itemPath !== undefined &&
    source.itemPath !== null &&
    (typeof source.itemPath !== "string" || !source.itemPath.trim())
  ) {
    throw new FfmpegSubtitleBurnToolError("source.itemPath không hợp lệ.", "invalid_input");
  }
  if (source.file !== undefined && (typeof source.file !== "string" || !source.file.trim())) {
    throw new FfmpegSubtitleBurnToolError("source.file không hợp lệ.", "invalid_input");
  }
  return {
    kind: source.kind,
    id: source.id.trim(),
    ...(source.kind === "resource"
      ? { itemPath: source.itemPath?.trim() ?? null }
      : { file: source.file?.trim() ?? "primary" })
  };
}

function validateCues(cues) {
  if (!Array.isArray(cues) || cues.length === 0 || cues.length > MAX_CUES) {
    throw new FfmpegSubtitleBurnToolError(`cues phải là danh sách 1-${MAX_CUES} phần tử.`, "invalid_input");
  }
  const normalized = cues.map((cue, index) => {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)) {
      throw new FfmpegSubtitleBurnToolError(`cues[${index}] không hợp lệ.`, "invalid_input");
    }
    const unknown = Object.keys(cue).filter(
      (field) => !["text", "startSeconds", "endSeconds"].includes(field)
    );
    if (unknown.length) {
      throw new FfmpegSubtitleBurnToolError(
        `cues[${index}] chứa field không được hỗ trợ: ` + unknown.join(", "),
        "invalid_input"
      );
    }
    if (typeof cue.text !== "string" || !cue.text.trim()) {
      throw new FfmpegSubtitleBurnToolError(`cues[${index}].text không hợp lệ.`, "invalid_input");
    }
    if (!Number.isFinite(cue.startSeconds) || cue.startSeconds < 0) {
      throw new FfmpegSubtitleBurnToolError(`cues[${index}].startSeconds không hợp lệ.`, "invalid_input");
    }
    if (!Number.isFinite(cue.endSeconds) || cue.endSeconds <= cue.startSeconds) {
      throw new FfmpegSubtitleBurnToolError(`cues[${index}].endSeconds phải lớn hơn startSeconds.`, "invalid_input");
    }
    return { text: cue.text.trim(), startSeconds: cue.startSeconds, endSeconds: cue.endSeconds };
  });
  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i].startSeconds < normalized[i - 1].endSeconds) {
      throw new FfmpegSubtitleBurnToolError(
        `cues[${i}] chồng lấp với cues[${i - 1}]; cues phải theo thứ tự thời gian và không chồng lấp.`,
        "invalid_input"
      );
    }
  }
  return normalized;
}

// Round to whole milliseconds before splitting into h/m/s/ms so a value like
// 0.9996s carries into the next second instead of producing a malformed
// four-digit millisecond field with the seconds left unincremented.
function srtTimestamp(seconds) {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (value, width) => String(value).padStart(width, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
}

function renderSrt(cues) {
  return cues
    .map((cue, index) => `${index + 1}\n${srtTimestamp(cue.startSeconds)} --> ${srtTimestamp(cue.endSeconds)}\n${cue.text}\n`)
    .join("\n");
}

// The subtitles filter's own escaping only reaches ':' (a Windows drive
// letter) — OpenMontage's tested tools (tools/video/video_compose.py,
// remotion_caption_burn.py) escape exactly that and nothing else. A literal
// "'" anywhere in the path is not something FFmpeg's quoted-value escaping
// can represent the way the shell-style 'X'\''Y' trick suggests: a direct
// test against real FFmpeg showed that sequence gets misparsed, merging the
// filename with the following force_style option instead of reassembling
// the quote. Sidestepping the whole escaping question is simpler and
// verified to work: run FFmpeg with its working directory set to the
// subtitle file's own folder (see execute()) and reference it by bare file
// name below, which never contains a drive letter, quote, or separator.
function escapeSubtitlesFilterPath(path) {
  return path.replaceAll("\\", "/").replaceAll(":", "\\:");
}

export function createFfmpegSubtitleBurner({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = runCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return {
    name: "ffmpeg-subtitle-burn",
    version: "1.0.0",
    provider: "FFmpeg",
    capability: "subtitle.burn",
    description: "Ghim cứng phụ đề (đã có sẵn văn bản và mốc thời gian) lên video.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: {
      type: "object",
      required: ["source", "cues"],
      properties: {
        source: {
          oneOf: [
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "resource" } } },
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "result" } } }
          ]
        },
        cues: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["text", "startSeconds", "endSeconds"],
            properties: {
              text: { type: "string" },
              startSeconds: { type: "number", minimum: 0 },
              endSeconds: { type: "number", exclusiveMinimum: 0 }
            }
          }
        },
        fontSize: { type: "integer", minimum: 8, maximum: 96 },
        marginV: { type: "integer", minimum: 0, maximum: 400 }
      }
    },
    outputDescription: "Một video MP4/H.264 đã ghim phụ đề, kèm provenance và kiểm chứng kỹ thuật.",
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
        throw new FfmpegSubtitleBurnToolError("Đầu vào subtitle.burn phải là một object.", "invalid_input");
      }
      const unknown = Object.keys(inputs).filter(
        (field) => !["source", "cues", "fontSize", "marginV"].includes(field)
      );
      if (unknown.length) {
        throw new FfmpegSubtitleBurnToolError(
          "Đầu vào subtitle.burn chứa field không được hỗ trợ: " + unknown.join(", "),
          "invalid_input"
        );
      }
      const source = validateSource(inputs.source);
      const cues = validateCues(inputs.cues);
      if (inputs.fontSize !== undefined && (!Number.isInteger(inputs.fontSize) || inputs.fontSize < 8 || inputs.fontSize > 96)) {
        throw new FfmpegSubtitleBurnToolError("fontSize phải là số nguyên trong khoảng 8-96.", "invalid_input");
      }
      if (inputs.marginV !== undefined && (!Number.isInteger(inputs.marginV) || inputs.marginV < 0 || inputs.marginV > 400)) {
        throw new FfmpegSubtitleBurnToolError("marginV phải là số nguyên trong khoảng 0-400.", "invalid_input");
      }
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        throw new FfmpegSubtitleBurnToolError("PADStudio chưa cấp workspace output.", "invalid_output_workspace");
      }
      const media = await store.resolveMediaSource(projectId, source);
      if (media.mediaType !== "video") {
        throw new FfmpegSubtitleBurnToolError("subtitle.burn chỉ nhận nguồn video.", "unsupported_input");
      }
      const subtitlePath = join(outputWorkspace.temporaryDirectory, "captions.srt");
      await writeFile(subtitlePath, renderSrt(cues), "utf8");

      return {
        runtime: {
          inputPath: media.filePath,
          subtitlePath,
          temporaryOutputPath: join(outputWorkspace.temporaryDirectory, "clip.mp4"),
          fontSizeOverride: inputs.fontSize ?? null,
          marginVOverride: inputs.marginV ?? null,
          lastCueEndSeconds: cues.at(-1).endSeconds
        },
        trace: {
          source: media.trace,
          sourceName: media.itemName,
          inputResources: media.inputResources,
          inputResults: media.inputResults,
          finalPath: outputWorkspace.projectRelativeDirectory + "/clip.mp4",
          cueCount: cues.length
        }
      };
    },

    async execute({ inputPath, subtitlePath, temporaryOutputPath, fontSizeOverride, marginVOverride, lastCueEndSeconds, availability }) {
      const source = await probeMedia(executeCommand, ffprobeCommand, inputPath, timeoutMs);
      if (!source.hasVideo || source.durationSeconds === null) {
        throw new FfmpegSubtitleBurnToolError("Nguồn không có video hoặc không xác định được thời lượng.", "unsupported_input");
      }
      if (lastCueEndSeconds > source.durationSeconds + 0.001) {
        throw new FfmpegSubtitleBurnToolError(
          "Có cues kết thúc sau thời lượng nguồn " + source.durationSeconds + " giây.",
          "invalid_input"
        );
      }

      const orientation = (source.height ?? 0) > (source.width ?? 0) ? "portrait" : "landscape";
      const style = ORIENTATION_STYLE[orientation];
      const fontSize = fontSizeOverride ?? style.fontSize;
      const marginV = marginVOverride ?? style.marginV;
      const forceStyle = `FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=${marginV},Alignment=2`;
      // Run with cwd set to the subtitle file's own folder and reference it
      // by bare name — see escapeSubtitlesFilterPath for why this sidesteps
      // quoting a full path instead of trying to escape it.
      const subtitlesFilter = `subtitles=filename='${escapeSubtitlesFilterPath(basename(subtitlePath))}':force_style='${forceStyle}'`;

      try {
        await executeCommand(
          ffmpegCommand,
          [
            "-hide_banner", "-loglevel", "error", "-i", inputPath,
            "-vf", subtitlesFilter,
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-c:a", "copy", "-pix_fmt", "yuv420p",
            "-y", temporaryOutputPath
          ],
          { timeout: timeoutMs, cwd: dirname(subtitlePath) }
        );
      } catch (error) {
        if (error?.killed || error?.code === "ETIMEDOUT") {
          throw new FfmpegSubtitleBurnToolError("ffmpeg vượt quá giới hạn " + timeoutMs + " ms.", "timeout");
        }
        const detail = safeDetail(error?.stderr || error?.message, [inputPath, subtitlePath, temporaryOutputPath]);
        throw new FfmpegSubtitleBurnToolError(
          "ffmpeg không thể ghim phụ đề." + (detail ? " " + detail : ""),
          error?.code === "ENOENT" ? "tool_unavailable" : "ffmpeg_failed"
        );
      }

      let info;
      try {
        info = await lstat(temporaryOutputPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new FfmpegSubtitleBurnToolError("ffmpeg không tạo file video đầu ra.", "invalid_output");
        }
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
        throw new FfmpegSubtitleBurnToolError("ffmpeg không tạo được file video hợp lệ.", "invalid_output");
      }

      const output = await probeMedia(executeCommand, ffprobeCommand, temporaryOutputPath, timeoutMs);
      const durationDifference = output.durationSeconds === null
        ? Infinity
        : Math.abs(output.durationSeconds - source.durationSeconds);
      if (
        !output.hasVideo ||
        output.width !== source.width ||
        output.height !== source.height ||
        durationDifference > DURATION_TOLERANCE_SECONDS
      ) {
        throw new FfmpegSubtitleBurnToolError("Video đầu ra không vượt qua kiểm tra khung hình/thời lượng.", "invalid_output");
      }
      if (source.hasAudio && !output.hasAudio) {
        throw new FfmpegSubtitleBurnToolError("Video đầu ra bị mất audio.", "invalid_output");
      }

      return {
        file: { sizeBytes: info.size },
        output,
        orientation,
        fontSize,
        marginV,
        verification: {
          status: "passed",
          checks: [
            "ffmpeg_exit_0", "output_file_present", "video_stream_present",
            "resolution_unchanged", "duration_within_0.25_seconds",
            ...(source.hasAudio ? ["audio_stream_preserved"] : [])
          ],
          details: {
            orientation,
            fontSize,
            marginV,
            toleranceSeconds: DURATION_TOLERANCE_SECONDS,
            executableVersion: availability.executableVersion ?? null
          }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      return {
        type: "video.captioned",
        name: "Phụ đề: " + prepared.trace.sourceName,
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
          cueCount: prepared.trace.cueCount,
          orientation: execution.orientation,
          fontSize: execution.fontSize,
          marginV: execution.marginV,
          durationSeconds: execution.output.durationSeconds,
          hasAudio: execution.output.hasAudio
        },
        verification: execution.verification
      };
    }
  };
}
