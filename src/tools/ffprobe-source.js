import {
  SourceAnalysisToolError,
  compact,
  effectiveRange,
  executableVersion,
  finiteNumber,
  integer,
  onlyFields,
  probeSource,
  readRuntimeProfiles,
  resolvePreparedSource,
  runProcess,
  runtimeProfileDigest,
  safeDetail,
  timeoutForDuration
} from "./source-analysis-common.js";

const DEFAULT_TIMEOUT_MS = 30_000;

function rational(value) {
  if (typeof value !== "string" || !/^\d+\/\d+$/.test(value) || value.endsWith("/0")) return null;
  return value;
}

function sampleAspectRatio(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match || Number(match[2]) === 0) return null;
  return { numerator: Number(match[1]), denominator: Number(match[2]) };
}

function rotationOf(stream) {
  const side = (stream.side_data_list ?? []).find((entry) => finiteNumber(entry.rotation) !== null);
  return finiteNumber(side?.rotation) ?? finiteNumber(stream.tags?.rotate) ?? 0;
}

function normalizeStream(stream) {
  const type = stream.codec_type;
  const rotation = type === "video" ? rotationOf(stream) : 0;
  const encodedWidth = integer(stream.width);
  const encodedHeight = integer(stream.height);
  const sar = sampleAspectRatio(stream.sample_aspect_ratio);
  const squarePixelWidth = encodedWidth !== null && sar
    ? Math.round(encodedWidth * sar.numerator / sar.denominator)
    : encodedWidth;
  const quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  return compact({
    index: integer(stream.index),
    type,
    codec: stream.codec_name ?? null,
    codecLongName: stream.codec_long_name ?? null,
    profile: stream.profile ?? null,
    timeBase: rational(stream.time_base),
    startTimeSeconds: finiteNumber(stream.start_time),
    durationSeconds: finiteNumber(stream.duration),
    bitRate: integer(stream.bit_rate),
    language: stream.tags?.language ?? null,
    default: integer(stream.disposition?.default) === 1,
    encodedWidth,
    encodedHeight,
    displayedWidth: quarterTurn ? encodedHeight : squarePixelWidth,
    displayedHeight: quarterTurn ? squarePixelWidth : encodedHeight,
    rotationDegrees: rotation,
    sampleAspectRatio: stream.sample_aspect_ratio ?? null,
    pixelFormat: stream.pix_fmt ?? null,
    averageFrameRate: rational(stream.avg_frame_rate),
    realFrameRate: rational(stream.r_frame_rate),
    frameCount: integer(stream.nb_frames),
    colorSpace: stream.color_space ?? null,
    colorTransfer: stream.color_transfer ?? null,
    colorPrimaries: stream.color_primaries ?? null,
    sampleRate: integer(stream.sample_rate),
    channels: integer(stream.channels),
    channelLayout: stream.channel_layout ?? null,
    sampleFormat: stream.sample_fmt ?? null
  });
}

function extensionWarning(mediaType, streams) {
  const actual = streams.some((stream) => stream.type === "video")
    ? "video"
    : streams.some((stream) => stream.type === "audio") ? "audio" : "other";
  if (mediaType === actual || (mediaType === "image" && actual === "video")) return [];
  return [{
    code: "extension_content_mismatch",
    message: `Phân loại import ${mediaType} khác loại stream thực tế ${actual}.`,
    importedMediaType: mediaType,
    probedMediaType: actual
  }];
}

function decodePoints(duration, sampleSeconds) {
  if (!Number.isFinite(duration) || duration <= sampleSeconds) return [0];
  return [...new Set([0, duration / 2, Math.max(0, duration - sampleSeconds)].map((value) => Number(value.toFixed(6))))];
}

function resultCoverage(details) {
  const duration = details.format.durationSeconds;
  const decode = details.decode;
  if (!Number.isFinite(duration) || duration <= 0 || decode.mode === "none") return { mode: "metadata" };
  if (decode.fullyDecoded) {
    return { startSeconds: 0, endSeconds: duration, mode: "continuous" };
  }
  const intervals = decode.samples
    .map((sample) => ({
      startSeconds: Math.max(0, Math.min(duration, sample.startSeconds)),
      endSeconds: Math.max(0, Math.min(duration, sample.startSeconds + sample.durationSeconds))
    }))
    .filter((range) => range.endSeconds > range.startSeconds);
  return intervals.length
    ? { startSeconds: 0, endSeconds: duration, mode: "sampled", intervals }
    : { mode: "metadata" };
}

async function checkDecode({ ffmpegCommand, inputPath, streams, duration, mode, sampleSeconds, signal, timeoutMs }) {
  if (mode === "none") return { mode: "none", samples: [], fullyDecoded: false };
  const mapped = streams.filter((stream) => ["audio", "video"].includes(stream.type));
  const sink = process.platform === "win32" ? "NUL" : "/dev/null";
  if (!mapped.length) throw new SourceAnalysisToolError("Nguồn không có stream media giải mã được.", "unsupported_input");
  const points = mode === "full" ? [0] : decodePoints(duration, sampleSeconds);
  const samples = [];
  for (const startSeconds of points) {
    const args = ["-hide_banner", "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe"];
    if (mode !== "full" && startSeconds > 0) args.push("-ss", String(startSeconds));
    args.push("-i", inputPath);
    for (const stream of mapped) args.push("-map", `0:${stream.index}`);
    if (mode !== "full") args.push("-t", String(sampleSeconds));
    args.push("-f", "null", "-y", sink);
    try {
      await runProcess(ffmpegCommand, args, {
        signal,
        timeoutMs: mode === "full" && Number.isFinite(duration) && duration > 0
          ? timeoutForDuration(effectiveRange(null, duration), { baseMs: timeoutMs, factor: 3 })
          : timeoutMs
      });
    } catch (error) {
      throw new SourceAnalysisToolError(
        `Không giải mã được mẫu tại ${startSeconds.toFixed(3)} giây. ${safeDetail(error.message, [inputPath])}`,
        error.code === "analysis_cancelled" ? error.code : "decode_failed",
        { cause: error }
      );
    }
    samples.push({ startSeconds, durationSeconds: mode === "full" ? duration : sampleSeconds, status: "decoded" });
  }
  return { mode, samples, fullyDecoded: mode === "full" };
}

export function createFfprobeSource({
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return {
    name: "ffprobe-source",
    version: "1.0.0",
    provider: "FFmpeg",
    capability: "source.probe",
    description: "Đọc metadata ảnh/audio/video và kiểm tra giải mã có coverage rõ ràng.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: { type: "object", required: ["source", "analysis"], additionalProperties: false },
    outputDescription: "source.metadata với format, track, timebase, rotation và bằng chứng decode.",
    sideEffects: [],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    producesFiles: false,

    async checkAvailability({ profileId = "source-probe-v1" } = {}) {
      try {
        profileId ??= "source-probe-v1";
        const profileDigest = await runtimeProfileDigest(profileId);
        const [ffprobe, ffmpeg] = await Promise.all([
          runProcess(ffprobeCommand, ["-version"], { timeoutMs: 5_000 }),
          runProcess(ffmpegCommand, ["-version"], { timeoutMs: 5_000 })
        ]);
        return {
          status: "available",
          executableVersion: executableVersion(ffprobe.stdout, "ffprobe"),
          libraryVersions: { ffmpeg: executableVersion(ffmpeg.stdout, "ffmpeg") },
          profileVersion: profileId,
          profileDigest
        };
      } catch (error) {
        return { status: "unavailable", reason: safeDetail(error.message, [ffprobeCommand, ffmpegCommand]) };
      }
    },

    async prepare(context) {
      const prepared = await resolvePreparedSource({ ...context, operation: "probe" });
      const options = prepared.normalized.analysis.options;
      onlyFields(options, ["decodeCheck", "sampleSeconds"], "probe.options");
      const profiles = await readRuntimeProfiles();
      const profileId = prepared.normalized.analysis.profileId ?? "source-probe-v1";
      const profile = profiles.profiles[profileId];
      if (!profile || profileId !== "source-probe-v1") {
        throw new SourceAnalysisToolError(`Probe profile không hỗ trợ: ${profileId}.`, "invalid_input");
      }
      const decodeCheck = options.decodeCheck ?? profile.decodeCheck;
      if (!["none", "sampled", "full"].includes(decodeCheck)) {
        throw new SourceAnalysisToolError("probe.options.decodeCheck phải là none, sampled hoặc full.", "invalid_input");
      }
      const sampleSeconds = options.sampleSeconds ?? profile.sampleSeconds;
      if (!Number.isFinite(sampleSeconds) || sampleSeconds <= 0 || sampleSeconds > 10) {
        throw new SourceAnalysisToolError("probe.options.sampleSeconds phải trong (0,10].", "invalid_input");
      }
      return {
        runtime: {
          inputPath: prepared.media.filePath,
          importedMediaType: prepared.media.mediaType,
          decodeCheck,
          sampleSeconds,
          signal: context.signal
        },
        trace: prepared.trace
      };
    },

    async execute({ inputPath, importedMediaType, decodeCheck, sampleSeconds, availability, signal }) {
      const raw = await probeSource(inputPath, { ffprobeCommand, signal, timeoutMs });
      const streams = raw.streams.map(normalizeStream);
      if (!streams.some((stream) => ["audio", "video"].includes(stream.type))) {
        throw new SourceAnalysisToolError("Nguồn không có audio/video/image stream được hỗ trợ.", "unsupported_input");
      }
      const streamDurations = streams
        .map((stream) => stream.durationSeconds)
        .filter((duration) => duration !== null && duration !== undefined);
      const durationSeconds = finiteNumber(raw.format.duration)
        ?? (streamDurations.length ? Math.max(...streamDurations) : null);
      const decode = await checkDecode({
        ffmpegCommand,
        inputPath,
        streams,
        duration: durationSeconds,
        mode: decodeCheck,
        sampleSeconds,
        signal,
        timeoutMs
      });
      const animated = importedMediaType === "image" && (
        streams.some((stream) => (stream.frameCount ?? 1) > 1)
        || durationSeconds > 0.1
      );
      const warnings = [
        ...extensionWarning(importedMediaType, streams),
        ...(decodeCheck === "none" ? [{ code: "decode_not_checked", message: "Chỉ đọc metadata; chưa kiểm tra giải mã." }] : []),
        ...(decodeCheck === "sampled" ? [{ code: "decode_sampled_not_full", message: "Chỉ giải mã mẫu đầu/giữa/cuối, không khẳng định toàn file." }] : []),
        ...(animated ? [{ code: "animated_image", message: "Nguồn ảnh có nhiều frame; coverage theo thời gian phải được xem riêng." }] : [])
      ];
      return {
        details: {
          importedMediaType,
          format: compact({
            name: raw.format.format_name ?? null,
            longName: raw.format.format_long_name ?? null,
            durationSeconds,
            startTimeSeconds: finiteNumber(raw.format.start_time),
            sizeBytes: integer(raw.format.size),
            bitRate: integer(raw.format.bit_rate)
          }),
          streams,
          decode,
          animated
        },
        warnings,
        counts: {
          tracks: streams.length,
          videoTracks: streams.filter((stream) => stream.type === "video").length,
          audioTracks: streams.filter((stream) => stream.type === "audio").length,
          decodeSamples: decode.samples.length
        },
        verification: {
          status: "passed",
          checks: ["ffprobe_exit_0", "format_and_streams_present", ...(decodeCheck === "none" ? [] : ["requested_decode_coverage_passed"])],
          details: { executableVersion: availability.executableVersion ?? null, decodeCheck }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      return {
        type: "source.metadata",
        name: `Metadata nguồn: ${prepared.trace.sourceName}`,
        inputResources: prepared.trace.inputResources,
        inputResults: prepared.trace.inputResults,
        data: {
          coverage: resultCoverage(execution.details),
          outcome: "produced",
          counts: execution.counts,
          datasets: [],
          warnings: execution.warnings,
          contentReview: "not_performed",
          details: execution.details
        },
        verification: execution.verification
      };
    }
  };
}
