import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DURATION_TOLERANCE_SECONDS = 0.25;
const MODES = ["mix", "duck"];
const MAX_FADE_SECONDS = 10;
// Matches the tested default in OpenMontage's audio_mixer.py (music stays
// audible but clearly secondary while the video's own audio is present).
const DEFAULT_DUCK_LEVEL = 0.15;
const DEFAULT_DUCK_ATTACK_MS = 200;
const DEFAULT_DUCK_RELEASE_MS = 500;

export class FfmpegAudioOverlayToolError extends Error {
  constructor(message, code = "ffmpeg_audio_overlay_failed") {
    super(message);
    this.name = "FfmpegAudioOverlayToolError";
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
    throw new FfmpegAudioOverlayToolError(
      "ffprobe không thể đọc file." + (detail ? " " + detail : ""),
      error?.code === "ENOENT" ? "tool_unavailable" : "probe_failed"
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
    if (!parsed?.format || !Array.isArray(parsed.streams)) throw new Error();
  } catch {
    throw new FfmpegAudioOverlayToolError("ffprobe trả về dữ liệu media không hợp lệ.", "invalid_probe_output");
  }
  const video = parsed.streams.find((stream) => stream?.codec_type === "video") ?? null;
  const audio = parsed.streams.find((stream) => stream?.codec_type === "audio") ?? null;
  return {
    durationSeconds: finiteNumber(parsed.format.duration),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio)
  };
}

function validateMediaSource(source, label) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new FfmpegAudioOverlayToolError(`${label} cần source hợp lệ.`, "invalid_input");
  }
  const allowed = source.kind === "resource"
    ? ["kind", "id", "itemPath"]
    : source.kind === "result"
      ? ["kind", "id", "file"]
      : [];
  if (!allowed.length) {
    throw new FfmpegAudioOverlayToolError(`${label}.kind phải là resource hoặc result.`, "invalid_input");
  }
  const unknown = Object.keys(source).filter((field) => !allowed.includes(field));
  if (unknown.length) {
    throw new FfmpegAudioOverlayToolError(
      `${label} chứa field không được hỗ trợ: ` + unknown.join(", "),
      "invalid_input"
    );
  }
  if (typeof source.id !== "string" || !source.id.trim()) {
    throw new FfmpegAudioOverlayToolError(`${label} cần id.`, "invalid_input");
  }
  if (
    source.itemPath !== undefined &&
    source.itemPath !== null &&
    (typeof source.itemPath !== "string" || !source.itemPath.trim())
  ) {
    throw new FfmpegAudioOverlayToolError(`${label}.itemPath không hợp lệ.`, "invalid_input");
  }
  if (source.file !== undefined && (typeof source.file !== "string" || !source.file.trim())) {
    throw new FfmpegAudioOverlayToolError(`${label}.file không hợp lệ.`, "invalid_input");
  }
  return {
    kind: source.kind,
    id: source.id.trim(),
    ...(source.kind === "resource"
      ? { itemPath: source.itemPath?.trim() ?? null }
      : { file: source.file?.trim() ?? "primary" })
  };
}

function boundedNumber(value, { label, min, max, fallback }) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new FfmpegAudioOverlayToolError(`${label} phải trong khoảng ${min}-${max}.`, "invalid_input");
  }
  return value;
}

export function createFfmpegAudioOverlay({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = runCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return {
    name: "ffmpeg-audio-overlay",
    version: "1.0.0",
    provider: "FFmpeg",
    capability: "audio.overlay",
    description: "Chèn một track âm thanh có sẵn (nhạc nền hoặc giọng đọc) vào video, có thể tự giảm âm lượng khi video đã có tiếng.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: {
      type: "object",
      required: ["video", "audio"],
      properties: {
        video: {
          oneOf: [
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "resource" } } },
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "result" } } }
          ]
        },
        audio: {
          oneOf: [
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "resource" } } },
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "result" } } }
          ]
        },
        mode: { type: "string", enum: MODES },
        audioVolume: { type: "number", minimum: 0, maximum: 2 },
        duckLevel: { type: "number", minimum: 0, maximum: 1 },
        duckAttackMs: { type: "number", minimum: 1, maximum: 2000 },
        duckReleaseMs: { type: "number", minimum: 1, maximum: 5000 },
        fadeInSeconds: { type: "number", minimum: 0, maximum: MAX_FADE_SECONDS },
        fadeOutSeconds: { type: "number", minimum: 0, maximum: MAX_FADE_SECONDS },
        loudnessTargetLufs: { type: "number", minimum: -40, maximum: 0 }
      }
    },
    outputDescription: "Video MP4/H.264 gốc với track âm thanh mới chèn vào, kèm provenance và kiểm chứng kỹ thuật.",
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
        throw new FfmpegAudioOverlayToolError("Đầu vào audio.overlay phải là một object.", "invalid_input");
      }
      const unknown = Object.keys(inputs).filter(
        (field) => ![
          "video", "audio", "mode", "audioVolume", "duckLevel",
          "duckAttackMs", "duckReleaseMs", "fadeInSeconds", "fadeOutSeconds", "loudnessTargetLufs"
        ].includes(field)
      );
      if (unknown.length) {
        throw new FfmpegAudioOverlayToolError(
          "Đầu vào audio.overlay chứa field không được hỗ trợ: " + unknown.join(", "),
          "invalid_input"
        );
      }
      const videoSource = validateMediaSource(inputs.video, "video");
      const audioSource = validateMediaSource(inputs.audio, "audio");
      const mode = inputs.mode ?? "mix";
      if (!MODES.includes(mode)) {
        throw new FfmpegAudioOverlayToolError("mode phải là mix hoặc duck.", "invalid_input");
      }
      const audioVolume = boundedNumber(inputs.audioVolume, { label: "audioVolume", min: 0, max: 2, fallback: 1 });
      const duckLevel = boundedNumber(inputs.duckLevel, { label: "duckLevel", min: 0, max: 1, fallback: DEFAULT_DUCK_LEVEL });
      const duckAttackMs = boundedNumber(inputs.duckAttackMs, { label: "duckAttackMs", min: 1, max: 2000, fallback: DEFAULT_DUCK_ATTACK_MS });
      const duckReleaseMs = boundedNumber(inputs.duckReleaseMs, { label: "duckReleaseMs", min: 1, max: 5000, fallback: DEFAULT_DUCK_RELEASE_MS });
      const fadeInSeconds = boundedNumber(inputs.fadeInSeconds, { label: "fadeInSeconds", min: 0, max: MAX_FADE_SECONDS, fallback: 0 });
      const fadeOutSeconds = boundedNumber(inputs.fadeOutSeconds, { label: "fadeOutSeconds", min: 0, max: MAX_FADE_SECONDS, fallback: 0 });
      const loudnessTargetLufs = inputs.loudnessTargetLufs === undefined
        ? null
        : boundedNumber(inputs.loudnessTargetLufs, { label: "loudnessTargetLufs", min: -40, max: 0, fallback: null });
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        throw new FfmpegAudioOverlayToolError("PADStudio chưa cấp workspace output.", "invalid_output_workspace");
      }

      const video = await store.resolveMediaSource(projectId, videoSource);
      if (video.mediaType !== "video") {
        throw new FfmpegAudioOverlayToolError("video phải là một nguồn video.", "unsupported_input");
      }
      const audio = await store.resolveMediaSource(projectId, audioSource);
      if (audio.mediaType !== "audio") {
        throw new FfmpegAudioOverlayToolError("audio phải là một nguồn audio.", "unsupported_input");
      }

      const inputResources = [...new Set([...video.inputResources, ...audio.inputResources])];
      const inputResults = [...new Set([...video.inputResults, ...audio.inputResults])];

      return {
        runtime: {
          videoPath: video.filePath,
          audioPath: audio.filePath,
          temporaryOutputPath: join(outputWorkspace.temporaryDirectory, "clip.mp4"),
          mode, audioVolume, duckLevel, duckAttackMs, duckReleaseMs,
          fadeInSeconds, fadeOutSeconds, loudnessTargetLufs
        },
        trace: {
          video: video.trace,
          audio: audio.trace,
          videoName: video.itemName,
          inputResources,
          inputResults,
          finalPath: outputWorkspace.projectRelativeDirectory + "/clip.mp4"
        }
      };
    },

    async execute({
      videoPath, audioPath, temporaryOutputPath, mode, audioVolume, duckLevel,
      duckAttackMs, duckReleaseMs, fadeInSeconds, fadeOutSeconds, loudnessTargetLufs, availability
    }) {
      const video = await probeMedia(executeCommand, ffprobeCommand, videoPath, timeoutMs);
      if (!video.hasVideo || video.durationSeconds === null) {
        throw new FfmpegAudioOverlayToolError("video không có hình hoặc không xác định được thời lượng.", "unsupported_input");
      }
      const audio = await probeMedia(executeCommand, ffprobeCommand, audioPath, timeoutMs);
      if (!audio.hasAudio) {
        throw new FfmpegAudioOverlayToolError("audio không có track âm thanh.", "unsupported_input");
      }
      if (fadeInSeconds + fadeOutSeconds > video.durationSeconds) {
        throw new FfmpegAudioOverlayToolError("fadeInSeconds + fadeOutSeconds vượt quá thời lượng video.", "invalid_input");
      }

      const duckApplied = mode === "duck" && video.hasAudio;
      const trackFilters = [`volume=${audioVolume}`];
      if (fadeInSeconds > 0) trackFilters.push(`afade=t=in:d=${fadeInSeconds}`);
      if (fadeOutSeconds > 0) {
        const fadeStart = Math.max(0, video.durationSeconds - fadeOutSeconds);
        trackFilters.push(`afade=t=out:st=${fadeStart}:d=${fadeOutSeconds}`);
      }

      // -stream_loop -1 loops the added track indefinitely regardless of its
      // natural length; the output-level -t below then caps the result to the
      // video's duration either way, so short and long tracks need no branch.
      const filterParts = [`[1:a]${trackFilters.join(",")}[track]`];
      let premixLabel = "track";

      if (duckApplied) {
        filterParts.push("[0:a]asplit=2[speech_key][speech_out]");
        filterParts.push(
          `[track][speech_key]sidechaincompress=` +
          `threshold=0.02:ratio=9:attack=${duckAttackMs / 1000}:release=${duckReleaseMs / 1000}:` +
          `level_sc=1:mix=0.9[ducked]`
        );
        filterParts.push(`[ducked]volume=${duckLevel * 3}[ducked_out]`);
        filterParts.push("[speech_out][ducked_out]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[premix]");
        premixLabel = "premix";
      } else if (video.hasAudio) {
        filterParts.push("[0:a][track]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[premix]");
        premixLabel = "premix";
      }

      let outLabel = premixLabel;
      if (loudnessTargetLufs !== null) {
        filterParts.push(`[${premixLabel}]loudnorm=I=${loudnessTargetLufs}:LRA=11:TP=-1.5[aout]`);
        outLabel = "aout";
      }

      const args = [
        "-hide_banner", "-loglevel", "error",
        "-i", videoPath,
        "-stream_loop", "-1", "-i", audioPath,
        "-filter_complex", filterParts.join(";"),
        "-map", "0:v:0", "-map", `[${outLabel}]`,
        "-t", String(video.durationSeconds),
        "-c:v", "copy",
        "-c:a", "aac",
        "-y", temporaryOutputPath
      ];

      try {
        await executeCommand(ffmpegCommand, args, { timeout: timeoutMs });
      } catch (error) {
        if (error?.killed || error?.code === "ETIMEDOUT") {
          throw new FfmpegAudioOverlayToolError("ffmpeg vượt quá giới hạn " + timeoutMs + " ms.", "timeout");
        }
        const detail = safeDetail(error?.stderr || error?.message, [videoPath, audioPath, temporaryOutputPath]);
        throw new FfmpegAudioOverlayToolError(
          "ffmpeg không thể chèn âm thanh." + (detail ? " " + detail : ""),
          error?.code === "ENOENT" ? "tool_unavailable" : "ffmpeg_failed"
        );
      }

      let info;
      try {
        info = await lstat(temporaryOutputPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new FfmpegAudioOverlayToolError("ffmpeg không tạo file video đầu ra.", "invalid_output");
        }
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
        throw new FfmpegAudioOverlayToolError("ffmpeg không tạo được file video hợp lệ.", "invalid_output");
      }

      const output = await probeMedia(executeCommand, ffprobeCommand, temporaryOutputPath, timeoutMs);
      const durationDifference = output.durationSeconds === null
        ? Infinity
        : Math.abs(output.durationSeconds - video.durationSeconds);
      if (!output.hasVideo || !output.hasAudio || durationDifference > DURATION_TOLERANCE_SECONDS) {
        throw new FfmpegAudioOverlayToolError("Video đầu ra không vượt qua kiểm tra thời lượng/audio.", "invalid_output");
      }

      return {
        file: { sizeBytes: info.size },
        output,
        duckApplied,
        verification: {
          status: "passed",
          checks: [
            "ffmpeg_exit_0", "output_file_present", "video_stream_present",
            "audio_stream_present", "duration_within_0.25_seconds"
          ],
          details: {
            mode,
            duckApplied,
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
        name: "Chèn âm thanh: " + prepared.trace.videoName,
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
          video: prepared.trace.video,
          audio: prepared.trace.audio,
          mode: prepared.runtime.mode,
          duckApplied: execution.duckApplied,
          audioVolume: prepared.runtime.audioVolume,
          duckLevel: prepared.runtime.duckLevel,
          loudnessTargetLufs: prepared.runtime.loudnessTargetLufs,
          durationSeconds: execution.output.durationSeconds
        },
        verification: execution.verification
      };
    }
  };
}
