import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SourceAnalysisToolError,
  checkedFile,
  defaultPythonPath,
  effectiveRange,
  onlyFields,
  outputFile,
  probeSource,
  repositoryRoot,
  resolvePreparedSource,
  runProcess,
  runtimeAnalysisDirectory,
  runtimeHelperPath,
  runtimeProfilePath,
  safeDetail,
  selectStream,
  temporaryOutputPath,
  timeoutForDuration
} from "./source-analysis-common.js";

function parseResponse(buffer, label) {
  try {
    const value = JSON.parse(buffer.toString("utf8"));
    if (!value || value.protocolVersion !== "1.0") throw new Error();
    return value;
  } catch {
    throw new SourceAnalysisToolError(`${label} trả response không hợp lệ.`, "invalid_helper_output");
  }
}

function normalizeOptions(value) {
  onlyFields(value, ["glossary", "glossaryVersion"], "transcript.options");
  const glossary = value.glossary ?? [];
  if (!Array.isArray(glossary) || glossary.length > 100 || glossary.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 200)) {
    throw new SourceAnalysisToolError("transcript.options.glossary phải là tối đa 100 chuỗi không rỗng, mỗi chuỗi tối đa 200 ký tự.", "invalid_input");
  }
  const glossaryVersion = value.glossaryVersion ?? null;
  if (glossary.length && (typeof glossaryVersion !== "string" || !glossaryVersion.trim())) {
    throw new SourceAnalysisToolError("Glossary cần glossaryVersion để đi vào provenance/cache key.", "invalid_input");
  }
  if (glossaryVersion !== null && (typeof glossaryVersion !== "string" || !glossaryVersion.trim())) {
    throw new SourceAnalysisToolError("glossaryVersion không hợp lệ.", "invalid_input");
  }
  return { glossary: glossary.map((entry) => entry.trim()), glossaryVersion: glossaryVersion?.trim() ?? null };
}

function validateTranscriptResponse(response, range, language) {
  const close = (left, right) => Number.isFinite(left) && Math.abs(left - right) <= 0.001;
  if (!response.coverage || !close(response.coverage.startSeconds, range.startSeconds) || !close(response.coverage.endSeconds, range.endSeconds)) {
    throw new SourceAnalysisToolError("ASR helper trả coverage không khớp request.", "invalid_helper_output");
  }
  const counts = response.counts;
  if (
    !counts || !Number.isSafeInteger(counts.segments) || counts.segments < 0 ||
    !Number.isSafeInteger(counts.words) || counts.words < 0 ||
    !Number.isSafeInteger(counts.chunks) || counts.chunks < 1 ||
    !Array.isArray(response.chunks) || response.chunks.length !== counts.chunks ||
    !Array.isArray(response.warnings) || response.warnings.some((warning) => typeof warning !== "string")
  ) throw new SourceAnalysisToolError("ASR helper trả counts/chunks/warnings không hợp lệ.", "invalid_helper_output");
  if (
    !["produced", "empty"].includes(response.outcome) ||
    (response.outcome === "empty" && (response.emptyReason !== "no_speech_detected" || counts.segments !== 0 || counts.words !== 0)) ||
    (response.outcome === "produced" && counts.segments === 0)
  ) throw new SourceAnalysisToolError("ASR helper trả outcome không nhất quán.", "invalid_helper_output");
  let ownershipStart = range.startSeconds;
  let chunkSegments = 0;
  for (const [index, chunk] of response.chunks.entries()) {
    const ownership = chunk?.ownership;
    const decode = chunk?.decodeRange;
    if (
      chunk?.index !== index || !ownership || !decode ||
      !close(ownership.startSeconds, ownershipStart) ||
      !Number.isFinite(ownership.endSeconds) || ownership.endSeconds <= ownership.startSeconds ||
      ownership.endSeconds > range.endSeconds + 0.001 ||
      !Number.isFinite(decode.startSeconds) || !Number.isFinite(decode.endSeconds) ||
      decode.startSeconds < range.startSeconds - 0.001 || decode.endSeconds > range.endSeconds + 0.001 ||
      decode.startSeconds > ownership.startSeconds + 0.001 || decode.endSeconds < ownership.endSeconds - 0.001 ||
      !Number.isFinite(chunk.inferenceSeconds) || chunk.inferenceSeconds < 0 ||
      typeof chunk.language !== "string" || !chunk.language.trim() ||
      !(chunk.languageProbability === null || (Number.isFinite(chunk.languageProbability) && chunk.languageProbability >= 0 && chunk.languageProbability <= 1)) ||
      !Number.isSafeInteger(chunk.segments) || chunk.segments < 0
    ) throw new SourceAnalysisToolError("ASR helper trả chunk ownership/diagnostics không hợp lệ.", "invalid_helper_output");
    ownershipStart = ownership.endSeconds;
    chunkSegments += chunk.segments;
  }
  if (!close(ownershipStart, range.endSeconds) || chunkSegments !== counts.segments) {
    throw new SourceAnalysisToolError("ASR chunk không phủ liên tục coverage hoặc sai segment count.", "invalid_helper_output");
  }
  const decoding = response.decoding;
  if (
    !decoding || typeof decoding !== "object" || Array.isArray(decoding) ||
    decoding.languageRequested !== language ||
    !Number.isSafeInteger(decoding.beamSize) || decoding.beamSize < 1 ||
    decoding.wordTimestamps !== true || typeof decoding.vad !== "boolean" ||
    !Number.isSafeInteger(decoding.vadMinimumSilenceMs) || decoding.vadMinimumSilenceMs < 0 ||
    !Number.isFinite(decoding.chunkSeconds) || decoding.chunkSeconds <= 0 ||
    !Number.isFinite(decoding.overlapSeconds) || decoding.overlapSeconds < 0 || decoding.overlapSeconds >= decoding.chunkSeconds ||
    decoding.conditionOnPreviousText !== false || !Number.isFinite(decoding.temperature)
  ) throw new SourceAnalysisToolError("ASR helper trả cấu hình decoding không hợp lệ.", "invalid_helper_output");
}

function validateTranscriptRows(text, range, expectedCounts) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (
    !expectedCounts || !Number.isSafeInteger(expectedCounts.segments) || expectedCounts.segments < 0 ||
    !Number.isSafeInteger(expectedCounts.words) || expectedCounts.words < 0 ||
    !Number.isSafeInteger(expectedCounts.chunks) || expectedCounts.chunks < 1
  ) throw new SourceAnalysisToolError("Transcript helper trả counts không hợp lệ.", "invalid_helper_output");
  let words = 0;
  let previousTimedStart = range.startSeconds;
  let previousTimedEnd = range.startSeconds;
  let hasOverlap = false;
  const wordIds = new Set();
  for (const [index, line] of lines.entries()) {
    let row;
    try { row = JSON.parse(line); } catch {
      throw new SourceAnalysisToolError(`Transcript JSONL lỗi tại dòng ${index + 1}.`, "invalid_helper_output");
    }
    if (
      row.id !== `segment-${String(index + 1).padStart(6, "0")}` ||
      typeof row.text !== "string" || !row.text.trim() ||
      typeof row.language !== "string" || !row.language.trim() ||
      !row.diagnostics || typeof row.diagnostics !== "object" || Array.isArray(row.diagnostics) ||
      !Array.isArray(row.words)
    ) {
      throw new SourceAnalysisToolError("Transcript row thiếu ID/text/words hợp lệ.", "invalid_helper_output");
    }
    if (row.startSeconds === null || row.endSeconds === null) {
      if (!(row.startSeconds === null && row.endSeconds === null && row.diagnostics?.timing === "unaligned")) {
        throw new SourceAnalysisToolError("Transcript timing null phải mang lý do unaligned.", "invalid_helper_output");
      }
    } else {
      if (!Number.isFinite(row.startSeconds) || !Number.isFinite(row.endSeconds) || row.startSeconds < range.startSeconds - 0.05 || row.endSeconds <= row.startSeconds || row.endSeconds > range.endSeconds + 0.05) {
        throw new SourceAnalysisToolError("Transcript segment có timestamp ngoài coverage.", "invalid_helper_output");
      }
      if (row.startSeconds < previousTimedStart - 0.001) throw new SourceAnalysisToolError("Transcript segment không được sắp theo thời gian.", "invalid_helper_output");
      if (row.startSeconds < previousTimedEnd - 0.001) hasOverlap = true;
      previousTimedStart = row.startSeconds;
      previousTimedEnd = Math.max(previousTimedEnd, row.endSeconds);
    }
    let previousWordStart = range.startSeconds;
    for (const word of row.words) {
      if (typeof word.id !== "string" || !word.id || wordIds.has(word.id) || typeof word.text !== "string" || !Number.isFinite(word.startSeconds) || !Number.isFinite(word.endSeconds) || word.endSeconds < word.startSeconds || word.startSeconds < range.startSeconds - 0.05 || word.endSeconds > range.endSeconds + 0.05 || word.startSeconds < previousWordStart - 0.001 || !(word.score === null || word.score === undefined || Number.isFinite(word.score))) {
        throw new SourceAnalysisToolError("Transcript word có schema/timestamp không hợp lệ.", "invalid_helper_output");
      }
      wordIds.add(word.id);
      previousWordStart = word.startSeconds;
      words += 1;
    }
  }
  if (lines.length !== expectedCounts.segments || words !== expectedCounts.words) {
    throw new SourceAnalysisToolError("Transcript count không khớp helper summary.", "invalid_helper_output");
  }
  return { segments: lines.length, words, hasOverlap };
}

export function createFasterWhisperTranscribe({
  pythonCommand = defaultPythonPath(),
  helperPath = runtimeHelperPath(),
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  modelRoot = process.env.PADSTUDIO_ANALYSIS_MODEL_DIR?.trim() || join(repositoryRoot, ".cache", "source-eval", "models")
} = {}) {
  return {
    name: "faster-whisper-transcribe",
    version: "1.0.0",
    provider: "faster-whisper",
    capability: "audio.transcribe",
    description: "Chép lời nguyên ngữ bằng faster-whisper local, chia ownership window và giữ word timestamps.",
    runtime: "local-python",
    executionMode: "sync",
    inputSchema: { type: "object", required: ["source", "analysis"], additionalProperties: false },
    outputDescription: "source.transcript với raw segment/word JSONL, language diagnostics và chunk coverage.",
    sideEffects: ["Tạo transcript dataset trong outputs của project."],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    producesFiles: true,

    async checkAvailability({ profileId = "large-v3-gpu-fp16" } = {}) {
      try {
        profileId ??= "large-v3-gpu-fp16";
        const result = await runProcess(pythonCommand, [
          "-I", helperPath, "doctor", "--kind", "asr", "--profile", profileId,
          "--profiles", runtimeProfilePath(), "--models-lock", join(runtimeAnalysisDirectory, "models.lock.json"),
          "--model-root", modelRoot
        ], { timeoutMs: 30_000 });
        const response = parseResponse(result.stdout, "ASR doctor");
        const modelsLockPath = join(runtimeAnalysisDirectory, "models.lock.json");
        if (!response.available) return { status: "unavailable", reason: safeDetail(JSON.stringify(response.blockers), [pythonCommand, helperPath, runtimeProfilePath(), modelsLockPath, modelRoot]) };
        return {
          status: "available",
          helperVersion: "1.0",
          protocolVersion: response.protocolVersion,
          pythonVersion: response.python,
          profileVersion: profileId,
          profileDigest: response.profileDigest,
          modelLockDigest: response.modelLockDigest,
          modelRevision: response.modelRevision,
          device: response.device,
          computeType: response.computeType,
          libraryVersions: response.packages
        };
      } catch (error) {
        return { status: "unavailable", reason: safeDetail(error.message, [pythonCommand, helperPath, runtimeProfilePath(), join(runtimeAnalysisDirectory, "models.lock.json"), modelRoot]) };
      }
    },

    async prepare(context) {
      const prepared = await resolvePreparedSource({ ...context, operation: "transcript", producesFiles: true });
      const profileId = prepared.normalized.analysis.profileId ?? "large-v3-gpu-fp16";
      if (![
        "large-v3-gpu-fp16", "large-v3-gpu-int8", "medium-gpu-fp16", "large-v3-cpu-int8"
      ].includes(profileId)) throw new SourceAnalysisToolError(`ASR profile không hỗ trợ: ${profileId}.`, "invalid_input");
      const options = normalizeOptions(prepared.normalized.analysis.options);
      const language = prepared.normalized.analysis.language ?? "auto";
      if (typeof language !== "string" || !/^(auto|[a-z]{2,3}(?:-[A-Za-z0-9]+)*)$/.test(language)) {
        throw new SourceAnalysisToolError("Ngôn ngữ ASR phải là auto hoặc mã ngôn ngữ hợp lệ.", "invalid_input");
      }
      const probe = await probeSource(prepared.media.filePath, { ffprobeCommand, signal: context.signal });
      const selected = selectStream(probe, "audio", prepared.normalized.analysis.track, { allowDefault: false });
      const duration = Number(probe.format.duration ?? selected.stream.duration);
      const range = effectiveRange(prepared.normalized.analysis.range, duration);
      const name = "transcript.jsonl";
      return {
        runtime: {
          inputPath: prepared.media.filePath,
          outputPath: temporaryOutputPath(prepared.output, name),
          profileId,
          audioStream: Number(selected.stream.index),
          range,
          language,
          options,
          signal: context.signal
        },
        trace: { ...prepared.trace, workspace: prepared.output, name }
      };
    },

    async execute({ inputPath, outputPath, profileId, audioStream, range, language, options, signal, availability }) {
      const result = await runProcess(pythonCommand, ["-I", helperPath, "transcribe"], {
        signal,
        timeoutMs: timeoutForDuration(range, { baseMs: 5 * 60_000, factor: 2, maximumMs: 4 * 60 * 60_000 }),
        input: {
          protocolVersion: "1.0",
          command: "transcribe",
          inputPath,
          outputPath,
          profileId,
          profilesPath: runtimeProfilePath(),
          modelsLockPath: join(runtimeAnalysisDirectory, "models.lock.json"),
          modelRoot,
          ffmpegCommand,
          audioStream,
          range,
          language,
          glossary: options.glossary,
          glossaryVersion: options.glossaryVersion
        }
      });
      const response = parseResponse(result.stdout, "ASR helper");
      validateTranscriptResponse(response, range, language);
      if (
        response.modelRevision !== availability.modelRevision || response.device !== availability.device ||
        response.computeType !== availability.computeType ||
        response.profileDigest !== availability.profileDigest ||
        response.modelLockDigest !== availability.modelLockDigest
      ) throw new SourceAnalysisToolError("ASR runtime khác môi trường đã preflight.", "tool_environment_changed");
      const info = await checkedFile(outputPath, "Transcript dataset", { allowEmpty: response.outcome === "empty" });
      const validation = validateTranscriptRows(await readFile(outputPath, "utf8"), range, response.counts);
      const warningMessages = {
        unaligned_segments: "Một số segment có text nhưng không có word timing; timing được giữ null.",
        no_speech_is_model_outcome: "Không có segment là kết quả của model/VAD trên coverage đã chạy, không phải khẳng định tuyệt đối nguồn không có tiếng nói."
      };
      const warnings = (response.warnings ?? []).map((code) => ({ code, message: warningMessages[code] ?? code }));
      if (validation.hasOverlap && !warnings.some((warning) => warning.code === "segment_timing_overlap_requires_review")) {
        warnings.push({ code: "segment_timing_overlap_requires_review", message: "Một số segment timing chồng nhau; cần review khi dùng." });
      }
      return {
        file: { sizeBytes: info.size },
        response,
        warnings,
        verification: {
          status: "passed",
          checks: ["helper_exit_0", "model_lock_verified", "jsonl_rows_valid", "timestamps_in_source_range", "chunk_ownership_applied"],
          details: { profileId, modelRevision: response.modelRevision, computeType: response.computeType }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      const transcript = outputFile({
        id: "segments", role: "dataset", workspace: prepared.trace.workspace, name: prepared.trace.name,
        mediaType: "application/x-ndjson", sizeBytes: execution.file.sizeBytes
      });
      return {
        type: "source.transcript",
        name: `Transcript raw: ${prepared.trace.sourceName}`,
        inputResources: prepared.trace.inputResources,
        inputResults: prepared.trace.inputResults,
        files: [transcript],
        data: {
          coverage: { ...execution.response.coverage, mode: "continuous" },
          outcome: execution.response.outcome,
          ...(execution.response.emptyReason ? { emptyReason: execution.response.emptyReason } : {}),
          counts: execution.response.counts,
          datasets: [{ kind: "transcript", fileId: "segments" }],
          warnings: execution.warnings,
          contentReview: "not_performed",
          details: {
            modelRevision: execution.response.modelRevision,
            device: execution.response.device,
            computeType: execution.response.computeType,
            loadSeconds: execution.response.loadSeconds,
            chunks: execution.response.chunks,
            decoding: execution.response.decoding,
            glossaryVersion: execution.response.glossaryVersion
          }
        },
        verification: execution.verification
      };
    }
  };
}
