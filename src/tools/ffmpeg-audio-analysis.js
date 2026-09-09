import {
  SourceAnalysisToolError,
  effectiveRange,
  executableVersion,
  listedFeature,
  onlyFields,
  outputFile,
  probeSource,
  readRuntimeProfiles,
  resolvePreparedSource,
  runProcess,
  runtimeProfileDigest,
  safeDetail,
  selectStream,
  temporaryOutputPath,
  timeoutForDuration,
  writeJsonLines
} from "./source-analysis-common.js";

function normalizeOptions(value, defaults) {
  onlyFields(value, ["windowSeconds", "silenceThresholdDbfs", "minimumSilenceSeconds", "clippingThreshold", "sampleRate"], "audio.options");
  const options = { ...defaults, ...value };
  if (!Number.isFinite(options.windowSeconds) || options.windowSeconds < 0.02 || options.windowSeconds > 1) {
    throw new SourceAnalysisToolError("audio.options.windowSeconds phải trong [0.02,1].", "invalid_input");
  }
  if (!Number.isFinite(options.silenceThresholdDbfs) || options.silenceThresholdDbfs >= 0 || options.silenceThresholdDbfs < -120) {
    throw new SourceAnalysisToolError("audio.options.silenceThresholdDbfs phải trong [-120,0).", "invalid_input");
  }
  if (!Number.isFinite(options.minimumSilenceSeconds) || options.minimumSilenceSeconds <= 0 || options.minimumSilenceSeconds > 30) {
    throw new SourceAnalysisToolError("audio.options.minimumSilenceSeconds phải trong (0,30].", "invalid_input");
  }
  if (!Number.isFinite(options.clippingThreshold) || options.clippingThreshold <= 0 || options.clippingThreshold > 1) {
    throw new SourceAnalysisToolError("audio.options.clippingThreshold phải trong (0,1].", "invalid_input");
  }
  if (!Number.isSafeInteger(options.sampleRate) || options.sampleRate < 1000 || options.sampleRate > 192000) {
    throw new SourceAnalysisToolError("audio.options.sampleRate không hợp lệ.", "invalid_input");
  }
  return options;
}

function pcmAnalyzer({ sampleRate, windowSeconds, sourceStartSeconds, sourceEndSeconds, silenceThresholdDbfs, minimumSilenceSeconds, clippingThreshold }) {
  const samplesPerWindow = Math.max(1, Math.round(sampleRate * windowSeconds));
  const windows = [];
  let leftover = Buffer.alloc(0);
  let count = 0;
  let minimum = 1;
  let maximum = -1;
  let sumSquares = 0;
  let peak = 0;
  let totalSamples = 0;
  function flush() {
    if (!count) return;
    const rms = Math.sqrt(sumSquares / count);
    const startSeconds = sourceStartSeconds + (totalSamples - count) / sampleRate;
    const endSeconds = Math.min(sourceEndSeconds, sourceStartSeconds + totalSamples / sampleRate);
    windows.push({
      kind: "level_window",
      id: `level-${String(windows.length + 1).padStart(7, "0")}`,
      startSeconds,
      endSeconds,
      minimum,
      maximum,
      rms,
      dbfs: rms > 0 ? 20 * Math.log10(rms) : null,
      peak,
      units: { amplitude: "normalized_full_scale", level: "dBFS" }
    });
    count = 0;
    minimum = 1;
    maximum = -1;
    sumSquares = 0;
    peak = 0;
  }
  return {
    consume(chunk) {
      const buffer = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = buffer.length - (buffer.length % 2);
      for (let offset = 0; offset < usable; offset += 2) {
        const value = buffer.readInt16LE(offset) / 32768;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
        peak = Math.max(peak, Math.abs(value));
        sumSquares += value * value;
        count += 1;
        totalSamples += 1;
        if (count >= samplesPerWindow) flush();
      }
      leftover = buffer.subarray(usable);
    },
    finish() {
      if (leftover.length) throw new SourceAnalysisToolError("PCM decode trả sample bị cắt dở.", "invalid_audio_decode");
      flush();
      const silence = [];
      let open = null;
      for (const row of windows) {
        const silent = row.dbfs === null || row.dbfs <= silenceThresholdDbfs;
        if (silent && open === null) open = row.startSeconds;
        if (!silent && open !== null) {
          if (row.startSeconds - open >= minimumSilenceSeconds) silence.push({ startSeconds: open, endSeconds: row.startSeconds });
          open = null;
        }
      }
      if (open !== null && windows.length) {
        const end = windows.at(-1).endSeconds;
        if (end - open >= minimumSilenceSeconds) silence.push({ startSeconds: open, endSeconds: end });
      }
      const clipping = windows
        .filter((row) => row.peak >= clippingThreshold)
        .map((row, index) => ({
          kind: "clipping_candidate",
          id: `clip-${String(index + 1).padStart(7, "0")}`,
          startSeconds: row.startSeconds,
          endSeconds: row.endSeconds,
          peak: row.peak,
          threshold: clippingThreshold,
          units: "normalized_full_scale"
        }));
      const silenceRows = silence.map((range, index) => ({
        kind: "silence",
        id: `silence-${String(index + 1).padStart(7, "0")}`,
        ...range,
        thresholdDbfs: silenceThresholdDbfs,
        minimumDurationSeconds: minimumSilenceSeconds,
        method: "window_rms_threshold"
      }));
      return { windows, silenceRows, clipping, totalSamples };
    }
  };
}

function parseIntegratedLoudness(stderr) {
  const matches = [...stderr.matchAll(/\bI:\s*(-?inf|[-+]?\d+(?:\.\d+)?)\s*LUFS/gi)];
  if (!matches.length || /inf/i.test(matches.at(-1)[1])) return null;
  const value = Number(matches.at(-1)[1]);
  return Number.isFinite(value) ? value : null;
}

export function createFfmpegAudioAnalysis({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe"
} = {}) {
  return {
    name: "ffmpeg-audio-analysis",
    version: "1.0.0",
    provider: "FFmpeg",
    capability: "audio.analyze",
    description: "Đo waveform, khoảng lặng, loudness và clipping candidate theo time range nguồn.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: { type: "object", required: ["source", "analysis"], additionalProperties: false },
    outputDescription: "source.audio-analysis với waveform window JSONL và summary loudness.",
    sideEffects: ["Tạo dataset audio JSONL trong outputs của project."],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    producesFiles: true,

    async checkAvailability({ profileId = "audio-standard-v1" } = {}) {
      try {
        profileId ??= "audio-standard-v1";
        const profileDigest = await runtimeProfileDigest(profileId);
        const [response, filters] = await Promise.all([
          runProcess(ffmpegCommand, ["-version"], { timeoutMs: 5_000 }),
          runProcess(ffmpegCommand, ["-hide_banner", "-filters"], { timeoutMs: 5_000 })
        ]);
        if (!listedFeature(filters.stdout, "ebur128")) throw new SourceAnalysisToolError("FFmpeg thiếu filter ebur128.", "tool_unavailable");
        return { status: "available", executableVersion: executableVersion(response.stdout, "ffmpeg"), profileVersion: profileId, profileDigest, requiredFeatures: ["filter:ebur128"] };
      } catch (error) {
        return { status: "unavailable", reason: safeDetail(error.message, [ffmpegCommand]) };
      }
    },

    async prepare(context) {
      const prepared = await resolvePreparedSource({ ...context, operation: "audio", producesFiles: true });
      const profileId = prepared.normalized.analysis.profileId ?? "audio-standard-v1";
      const profiles = await readRuntimeProfiles();
      if (profileId !== "audio-standard-v1" || !profiles.profiles[profileId]) {
        throw new SourceAnalysisToolError(`Audio profile không hỗ trợ: ${profileId}.`, "invalid_input");
      }
      const options = normalizeOptions(prepared.normalized.analysis.options, profiles.profiles[profileId]);
      const probe = await probeSource(prepared.media.filePath, { ffprobeCommand, signal: context.signal });
      const selected = selectStream(probe, "audio", prepared.normalized.analysis.track, { allowDefault: false });
      const duration = Number(probe.format.duration ?? selected.stream.duration);
      const range = effectiveRange(prepared.normalized.analysis.range, duration);
      const name = "audio-analysis.jsonl";
      return {
        runtime: {
          inputPath: prepared.media.filePath,
          outputPath: temporaryOutputPath(prepared.output, name),
          audioStream: Number(selected.stream.index),
          range,
          options,
          signal: context.signal
        },
        trace: { ...prepared.trace, workspace: prepared.output, name }
      };
    },

    async execute({ inputPath, outputPath, audioStream, range, options, signal, availability }) {
      const timeoutMs = timeoutForDuration(range, { baseMs: 60_000, factor: 3 });
      const analyzer = pcmAnalyzer({
        sampleRate: options.sampleRate,
        windowSeconds: options.windowSeconds,
        sourceStartSeconds: range.startSeconds,
        sourceEndSeconds: range.endSeconds,
        silenceThresholdDbfs: options.silenceThresholdDbfs,
        minimumSilenceSeconds: options.minimumSilenceSeconds,
        clippingThreshold: options.clippingThreshold
      });
      await runProcess(ffmpegCommand, [
        "-hide_banner", "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe",
        "-ss", String(range.startSeconds), "-i", inputPath, "-t", String(range.endSeconds - range.startSeconds),
        "-map", `0:${audioStream}`, "-vn", "-ac", "1", "-ar", String(options.sampleRate),
        "-f", "s16le", "pipe:1"
      ], { signal, timeoutMs, collectStdout: false, onStdout: (chunk) => analyzer.consume(chunk) });
      const measured = analyzer.finish();
      const expectedSamples = (range.endSeconds - range.startSeconds) * options.sampleRate;
      const sampleTolerance = Math.max(options.sampleRate * 0.05, Math.round(options.sampleRate * options.windowSeconds));
      if (measured.totalSamples < expectedSamples - sampleTolerance) {
        throw new SourceAnalysisToolError("Audio decode ended before requested coverage.", "decode_failed");
      }
      if (!measured.totalSamples) throw new SourceAnalysisToolError("Audio decode không trả sample.", "decode_failed");
      const loudnessRun = await runProcess(ffmpegCommand, [
        "-hide_banner", "-nostats", "-nostdin", "-protocol_whitelist", "file,pipe",
        "-ss", String(range.startSeconds), "-i", inputPath, "-t", String(range.endSeconds - range.startSeconds),
        "-map", `0:${audioStream}`, "-vn", "-af", "ebur128=peak=true", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"
      ], { signal, timeoutMs });
      const integratedLufs = parseIntegratedLoudness(loudnessRun.stderr.toString("utf8"));
      const rows = [...measured.windows, ...measured.silenceRows, ...measured.clipping];
      const info = await writeJsonLines(outputPath, rows);
      const peak = measured.windows.reduce((maximum, row) => Math.max(maximum, row.peak), 0);
      return {
        file: { sizeBytes: info.size },
        counts: { levelWindows: measured.windows.length, silenceIntervals: measured.silenceRows.length, clippingCandidates: measured.clipping.length },
        details: {
          audioStream,
          integratedLufs,
          ...(integratedLufs === null ? { integratedLoudnessReason: "silence_or_ffmpeg_reported_undefined" } : {}),
          peakNormalized: peak,
          thresholds: {
            silenceDbfs: options.silenceThresholdDbfs,
            minimumSilenceSeconds: options.minimumSilenceSeconds,
            clippingNormalized: options.clippingThreshold
          },
          waveform: {
            sampleRate: options.sampleRate,
            windowSeconds: options.windowSeconds,
            decodedSamples: measured.totalSamples,
            decodedDurationSeconds: measured.totalSamples / options.sampleRate
          }
        },
        warnings: [{ code: "silence_is_level_threshold", message: "Khoảng lặng dựa trên dBFS, không phải nhận biết lời nói/VAD." }],
        verification: {
          status: "passed",
          checks: ["pcm_decode_exit_0", "waveform_windows_valid", "ebur128_exit_0", "timestamps_in_range"],
          details: { executableVersion: availability.executableVersion }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      const dataset = outputFile({
        id: "audio", role: "dataset", workspace: prepared.trace.workspace, name: prepared.trace.name,
        mediaType: "application/x-ndjson", sizeBytes: execution.file.sizeBytes
      });
      return {
        type: "source.audio-analysis",
        name: `Phân tích âm thanh: ${prepared.trace.sourceName}`,
        inputResources: prepared.trace.inputResources,
        inputResults: prepared.trace.inputResults,
        files: [dataset],
        data: {
          coverage: { ...prepared.runtime.range, mode: "continuous" },
          outcome: "produced",
          counts: execution.counts,
          datasets: [{ kind: "audio-analysis", fileId: "audio" }],
          warnings: execution.warnings,
          contentReview: "not_performed",
          details: execution.details
        },
        verification: execution.verification
      };
    }
  };
}
