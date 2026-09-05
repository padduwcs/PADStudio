import { execFile } from "node:child_process";
import { lstat, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DURATION_TOLERANCE_SECONDS = 0.5;
const MIN_TRANSITION_SECONDS = 0.1;
const MAX_TRANSITION_SECONDS = 3;
const DEFAULT_TRANSITION_SECONDS = 0.5;
const TRANSITIONS = ["cut", "crossfade", "fadeBlack"];

export class FfmpegConcatToolError extends Error {
  constructor(message, code = "ffmpeg_concat_failed") {
    super(message);
    this.name = "FfmpegConcatToolError";
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

function frameRateNumber(value) {
  if (typeof value !== "string") return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function evenDimension(value) {
  const number = Math.round(Number.isFinite(value) ? value : 0) || 0;
  const safe = number > 0 ? number : 2;
  return safe % 2 === 0 ? safe : safe + 1;
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
    throw new FfmpegConcatToolError(
      "ffprobe không thể đọc video." + (detail ? " " + detail : ""),
      error?.code === "ENOENT" ? "tool_unavailable" : "probe_failed"
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
    if (!parsed?.format || !Array.isArray(parsed.streams)) throw new Error();
  } catch {
    throw new FfmpegConcatToolError("ffprobe trả về dữ liệu media không hợp lệ.", "invalid_probe_output");
  }
  const video = parsed.streams.find((stream) => stream?.codec_type === "video") ?? null;
  const audio = parsed.streams.find((stream) => stream?.codec_type === "audio") ?? null;
  return {
    durationSeconds: finiteNumber(parsed.format.duration),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: integer(video?.width),
    height: integer(video?.height),
    frameRate: video?.avg_frame_rate ?? null,
    videoCodec: video?.codec_name ?? null,
    pixelFormat: video?.pix_fmt ?? null,
    audioCodec: audio?.codec_name ?? null,
    sampleRate: integer(audio?.sample_rate),
    channels: integer(audio?.channels)
  };
}

function validateSourceItem(source, index) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new FfmpegConcatToolError(`sources[${index}] không hợp lệ.`, "invalid_input");
  }
  const allowed = source.kind === "resource"
    ? ["kind", "id", "itemPath"]
    : source.kind === "result"
      ? ["kind", "id", "file"]
      : [];
  if (!allowed.length) {
    throw new FfmpegConcatToolError(`sources[${index}].kind phải là resource hoặc result.`, "invalid_input");
  }
  const unknown = Object.keys(source).filter((field) => !allowed.includes(field));
  if (unknown.length) {
    throw new FfmpegConcatToolError(
      `sources[${index}] chứa field không được hỗ trợ: ` + unknown.join(", "),
      "invalid_input"
    );
  }
  if (typeof source.id !== "string" || !source.id.trim()) {
    throw new FfmpegConcatToolError(`sources[${index}] cần id.`, "invalid_input");
  }
  if (
    source.itemPath !== undefined &&
    source.itemPath !== null &&
    (typeof source.itemPath !== "string" || !source.itemPath.trim())
  ) {
    throw new FfmpegConcatToolError(`sources[${index}].itemPath không hợp lệ.`, "invalid_input");
  }
  if (source.file !== undefined && (typeof source.file !== "string" || !source.file.trim())) {
    throw new FfmpegConcatToolError(`sources[${index}].file không hợp lệ.`, "invalid_input");
  }
  return {
    kind: source.kind,
    id: source.id.trim(),
    ...(source.kind === "resource"
      ? { itemPath: source.itemPath?.trim() ?? null }
      : { file: source.file?.trim() ?? "primary" })
  };
}

export function createFfmpegVideoConcatenator({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = runCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return {
    name: "ffmpeg-concat",
    version: "1.0.0",
    provider: "FFmpeg",
    capability: "video.concat",
    description: "Ghép nhiều clip video theo thứ tự, có thể chuyển cảnh mờ dần hoặc qua đen.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: {
      type: "object",
      required: ["sources"],
      properties: {
        sources: {
          type: "array",
          minItems: 2,
          items: {
            oneOf: [
              { type: "object", required: ["kind", "id"], properties: { kind: { const: "resource" } } },
              { type: "object", required: ["kind", "id"], properties: { kind: { const: "result" } } }
            ]
          }
        },
        transition: { type: "string", enum: TRANSITIONS },
        transitionSeconds: { type: "number", minimum: MIN_TRANSITION_SECONDS, maximum: MAX_TRANSITION_SECONDS }
      }
    },
    outputDescription: "Một video MP4/H.264 nối các clip đầu vào, kèm provenance và kiểm chứng kỹ thuật.",
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
        throw new FfmpegConcatToolError("Đầu vào video.concat phải là một object.", "invalid_input");
      }
      const unknown = Object.keys(inputs).filter(
        (field) => !["sources", "transition", "transitionSeconds"].includes(field)
      );
      if (unknown.length) {
        throw new FfmpegConcatToolError(
          "Đầu vào video.concat chứa field không được hỗ trợ: " + unknown.join(", "),
          "invalid_input"
        );
      }
      if (!Array.isArray(inputs.sources) || inputs.sources.length < 2) {
        throw new FfmpegConcatToolError("video.concat cần ít nhất 2 sources.", "invalid_input");
      }
      const sources = inputs.sources.map(validateSourceItem);
      const transition = inputs.transition ?? "cut";
      if (!TRANSITIONS.includes(transition)) {
        throw new FfmpegConcatToolError("transition không được hỗ trợ.", "invalid_input");
      }
      let transitionSeconds = 0;
      if (transition !== "cut") {
        transitionSeconds = inputs.transitionSeconds ?? DEFAULT_TRANSITION_SECONDS;
        if (
          !Number.isFinite(transitionSeconds) ||
          transitionSeconds < MIN_TRANSITION_SECONDS ||
          transitionSeconds > MAX_TRANSITION_SECONDS
        ) {
          throw new FfmpegConcatToolError(
            `transitionSeconds phải trong khoảng ${MIN_TRANSITION_SECONDS}-${MAX_TRANSITION_SECONDS} giây.`,
            "invalid_input"
          );
        }
      } else if (inputs.transitionSeconds !== undefined) {
        throw new FfmpegConcatToolError("transitionSeconds chỉ dùng khi có transition.", "invalid_input");
      }
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        throw new FfmpegConcatToolError("PADStudio chưa cấp workspace output.", "invalid_output_workspace");
      }

      const resolvedSources = [];
      for (const source of sources) {
        const media = await store.resolveMediaSource(projectId, source);
        if (media.mediaType !== "video") {
          throw new FfmpegConcatToolError("video.concat chỉ nhận nguồn video.", "unsupported_input");
        }
        resolvedSources.push(media);
      }

      const inputResources = [...new Set(resolvedSources.flatMap((media) => media.inputResources))];
      const inputResults = [...new Set(resolvedSources.flatMap((media) => media.inputResults))];

      return {
        runtime: {
          inputPaths: resolvedSources.map((media) => media.filePath),
          temporaryDirectory: outputWorkspace.temporaryDirectory,
          temporaryOutputPath: join(outputWorkspace.temporaryDirectory, "clip.mp4"),
          transition,
          transitionSeconds
        },
        trace: {
          sources: resolvedSources.map((media) => media.trace),
          sourceNames: resolvedSources.map((media) => media.itemName),
          inputResources,
          inputResults,
          finalPath: outputWorkspace.projectRelativeDirectory + "/clip.mp4"
        }
      };
    },

    async execute({ inputPaths, temporaryDirectory, temporaryOutputPath, transition, transitionSeconds, availability }) {
      const probes = [];
      for (const inputPath of inputPaths) {
        const probe = await probeMedia(executeCommand, ffprobeCommand, inputPath, timeoutMs);
        if (!probe.hasVideo || probe.durationSeconds === null) {
          throw new FfmpegConcatToolError(
            "Một nguồn không có video hoặc không xác định được thời lượng.",
            "unsupported_input"
          );
        }
        probes.push(probe);
      }

      if (transition !== "cut") {
        for (let i = 0; i < probes.length - 1; i += 1) {
          const shorter = Math.min(probes[i].durationSeconds, probes[i + 1].durationSeconds);
          if (shorter <= transitionSeconds) {
            throw new FfmpegConcatToolError(
              "transitionSeconds dài hơn một trong hai clip liền kề, không thể chuyển cảnh.",
              "invalid_input"
            );
          }
        }
      }

      const reference = probes[0];
      const targetWidth = evenDimension(reference.width ?? 1280);
      const targetHeight = evenDimension(reference.height ?? 720);
      const targetFrameRate = frameRateNumber(reference.frameRate) ?? 30;
      const hasRealAudio = probes.some((probe) => probe.hasAudio);
      const audioSynthesizedIndexes = [];

      const isFullyCompatible = transition === "cut" && probes.every((probe, index) => (
        index === 0 ||
        (
          probe.width === reference.width &&
          probe.height === reference.height &&
          probe.frameRate === reference.frameRate &&
          probe.videoCodec === reference.videoCodec &&
          probe.pixelFormat === reference.pixelFormat &&
          probe.hasAudio === reference.hasAudio &&
          probe.audioCodec === reference.audioCodec &&
          probe.sampleRate === reference.sampleRate &&
          probe.channels === reference.channels
        )
      ));
      let losslessFastPath = false;

      try {
        if (isFullyCompatible) {
          losslessFastPath = true;
          const listPath = join(temporaryDirectory, "concat-list.txt");
          const listContents = inputPaths
            .map((inputPath) => `file '${inputPath.replaceAll("'", "'\\''")}'`)
            .join("\n") + "\n";
          await writeFile(listPath, listContents, "utf8");
          try {
            await executeCommand(
              ffmpegCommand,
              [
                "-hide_banner", "-loglevel", "error",
                "-f", "concat", "-safe", "0", "-i", listPath,
                "-c", "copy", "-y", temporaryOutputPath
              ],
              { timeout: timeoutMs }
            );
          } finally {
            await rm(listPath, { force: true }).catch(() => {});
          }
        } else {
          const normalizedPaths = [];
          for (const [index, inputPath] of inputPaths.entries()) {
            const probe = probes[index];
            const normalizedPath = join(temporaryDirectory, `normalized-${index}.mp4`);
            const filters = [
              `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`,
              `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
              `fps=${targetFrameRate}`
            ].join(",");
            const args = ["-hide_banner", "-loglevel", "error", "-i", inputPath];
            if (!probe.hasAudio) {
              args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
              audioSynthesizedIndexes.push(index);
            }
            args.push(
              "-vf", filters,
              "-map", "0:v:0",
              "-map", probe.hasAudio ? "0:a:0" : "1:a:0",
              "-t", String(probe.durationSeconds),
              "-c:v", "libx264", "-preset", "medium", "-crf", "18",
              "-c:a", "aac", "-ar", "44100", "-ac", "2",
              "-pix_fmt", "yuv420p",
              "-y", normalizedPath
            );
            await executeCommand(ffmpegCommand, args, { timeout: timeoutMs });
            normalizedPaths.push(normalizedPath);
          }

          if (transition === "cut") {
            const filterInputs = normalizedPaths.map((_, index) => `[${index}:v:0][${index}:a:0]`).join("");
            const args = ["-hide_banner", "-loglevel", "error"];
            for (const path of normalizedPaths) args.push("-i", path);
            args.push(
              "-filter_complex", `${filterInputs}concat=n=${normalizedPaths.length}:v=1:a=1[v][a]`,
              "-map", "[v]", "-map", "[a]",
              "-c:v", "libx264", "-preset", "medium", "-crf", "18",
              "-c:a", "aac",
              "-y", temporaryOutputPath
            );
            await executeCommand(ffmpegCommand, args, { timeout: timeoutMs });
          } else {
            const xfadeTransition = transition === "crossfade" ? "fade" : "fadeblack";
            const args = ["-hide_banner", "-loglevel", "error"];
            for (const path of normalizedPaths) args.push("-i", path);
            const videoFilters = [];
            const audioFilters = [];
            let cumulativeOffset = 0;
            const total = normalizedPaths.length;
            for (let i = 0; i < total - 1; i += 1) {
              const clipDuration = probes[i].durationSeconds;
              const offset = i === 0
                ? Math.max(0, clipDuration - transitionSeconds)
                : Math.max(0, cumulativeOffset + clipDuration - transitionSeconds);
              const vIn1 = i === 0 ? "[0:v]" : `[vfade${i - 1}]`;
              const aIn1 = i === 0 ? "[0:a]" : `[afade${i - 1}]`;
              const vIn2 = `[${i + 1}:v]`;
              const aIn2 = `[${i + 1}:a]`;
              const vOut = i < total - 2 ? `[vfade${i}]` : "[vout]";
              const aOut = i < total - 2 ? `[afade${i}]` : "[aout]";
              videoFilters.push(
                `${vIn1}${vIn2}xfade=transition=${xfadeTransition}:duration=${transitionSeconds}:offset=${offset.toFixed(3)}${vOut}`
              );
              audioFilters.push(`${aIn1}${aIn2}acrossfade=d=${transitionSeconds}${aOut}`);
              cumulativeOffset = offset;
            }
            args.push(
              "-filter_complex", [...videoFilters, ...audioFilters].join(";"),
              "-map", "[vout]", "-map", "[aout]",
              "-c:v", "libx264", "-preset", "medium", "-crf", "18",
              "-c:a", "aac",
              "-y", temporaryOutputPath
            );
            await executeCommand(ffmpegCommand, args, { timeout: timeoutMs });
          }
        }
      } catch (error) {
        if (error instanceof FfmpegConcatToolError) throw error;
        if (error?.killed || error?.code === "ETIMEDOUT") {
          throw new FfmpegConcatToolError("ffmpeg vượt quá giới hạn " + timeoutMs + " ms.", "timeout");
        }
        const detail = safeDetail(error?.stderr || error?.message, [...inputPaths, temporaryOutputPath]);
        throw new FfmpegConcatToolError(
          "ffmpeg không thể ghép video." + (detail ? " " + detail : ""),
          error?.code === "ENOENT" ? "tool_unavailable" : "ffmpeg_failed"
        );
      }

      let info;
      try {
        info = await lstat(temporaryOutputPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new FfmpegConcatToolError("ffmpeg không tạo file video đầu ra.", "invalid_output");
        }
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
        throw new FfmpegConcatToolError("ffmpeg không tạo được file video hợp lệ.", "invalid_output");
      }

      const output = await probeMedia(executeCommand, ffprobeCommand, temporaryOutputPath, timeoutMs);
      const overlapSeconds = transition === "cut" ? 0 : transitionSeconds * (probes.length - 1);
      const expectedDuration = probes.reduce((total, probe) => total + probe.durationSeconds, 0) - overlapSeconds;
      const durationDifference = output.durationSeconds === null
        ? Infinity
        : Math.abs(output.durationSeconds - expectedDuration);
      if (!output.hasVideo || durationDifference > DURATION_TOLERANCE_SECONDS) {
        throw new FfmpegConcatToolError("Video đầu ra không vượt qua kiểm tra thời lượng/stream.", "invalid_output");
      }
      if (hasRealAudio && !output.hasAudio) {
        throw new FfmpegConcatToolError("Video đầu ra bị mất audio.", "invalid_output");
      }

      return {
        file: { sizeBytes: info.size },
        output,
        sourceCount: probes.length,
        losslessFastPath,
        audioSynthesizedIndexes,
        verification: {
          status: "passed",
          checks: [
            "ffmpeg_exit_0", "output_file_present", "video_stream_present",
            "duration_within_tolerance",
            ...(hasRealAudio ? ["audio_stream_preserved"] : [])
          ],
          details: {
            expectedDurationSeconds: expectedDuration,
            actualDurationSeconds: output.durationSeconds,
            toleranceSeconds: DURATION_TOLERANCE_SECONDS,
            transition,
            transitionSeconds,
            losslessFastPath,
            executableVersion: availability.executableVersion ?? null
          }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      return {
        type: "video.clip",
        name: "Video ghép: " + prepared.trace.sourceNames.join(" + "),
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
          sources: prepared.trace.sources,
          sourceCount: execution.sourceCount,
          transition: prepared.runtime.transition,
          transitionSeconds: prepared.runtime.transitionSeconds,
          durationSeconds: execution.output.durationSeconds,
          losslessFastPath: execution.losslessFastPath,
          audioSynthesizedIndexes: execution.audioSynthesizedIndexes,
          video: {
            width: finiteNumber(execution.output.width),
            height: finiteNumber(execution.output.height),
            frameRate: execution.output.frameRate
          },
          hasAudio: execution.output.hasAudio
        },
        verification: execution.verification
      };
    }
  };
}
