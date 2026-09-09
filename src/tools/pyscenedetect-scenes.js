import { readFile } from "node:fs/promises";
import {
  SourceAnalysisToolError,
  checkedFile,
  defaultPythonPath,
  effectiveRange,
  outputFile,
  onlyFields,
  probeSource,
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

function validateOptions(options) {
  onlyFields(options, ["adaptiveThreshold", "minSceneLengthFrames", "windowWidth", "minContentValue"], "scenes.options");
  const normalized = {};
  for (const field of ["adaptiveThreshold", "minContentValue"]) {
    if (options[field] !== undefined) {
      if (!Number.isFinite(options[field]) || options[field] <= 0) {
        throw new SourceAnalysisToolError(`scenes.options.${field} phải là số dương.`, "invalid_input");
      }
      normalized[field] = options[field];
    }
  }
  for (const field of ["minSceneLengthFrames", "windowWidth"]) {
    if (options[field] !== undefined) {
      if (!Number.isSafeInteger(options[field]) || options[field] <= 0) {
        throw new SourceAnalysisToolError(`scenes.options.${field} phải là số nguyên dương.`, "invalid_input");
      }
      normalized[field] = options[field];
    }
  }
  return normalized;
}

export function createPyscenedetectScenes({
  pythonCommand = defaultPythonPath(),
  helperPath = runtimeHelperPath(),
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe"
} = {}) {
  return {
    name: "pyscenedetect-scenes",
    version: "1.0.0",
    provider: "PySceneDetect",
    capability: "video.detect-scenes",
    description: "Phát hiện ranh giới shot hình ảnh bằng AdaptiveDetector và giữ diagnostic score.",
    runtime: "local-python",
    executionMode: "sync",
    inputSchema: { type: "object", required: ["source", "analysis"], additionalProperties: false },
    outputDescription: "source.scenes với shot liên tục, boundary kind/score và coverage đã quét.",
    sideEffects: ["Tạo dataset JSONL trong outputs của project."],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    producesFiles: true,

    async checkAvailability({ profileId = "source-standard-v1" } = {}) {
      try {
        profileId ??= "source-standard-v1";
        const result = await runProcess(pythonCommand, [
          "-I", helperPath, "doctor", "--kind", "scenes", "--profile", profileId,
          "--profiles", runtimeProfilePath(), "--models-lock", `${runtimeAnalysisDirectory}/models.lock.json`
        ], { timeoutMs: 20_000 });
        const response = parseResponse(result.stdout, "Scene doctor");
        if (!response.available) return { status: "unavailable", reason: safeDetail(JSON.stringify(response.blockers), [pythonCommand, helperPath, runtimeProfilePath(), `${runtimeAnalysisDirectory}/models.lock.json`]) };
        return {
          status: "available",
          helperVersion: "1.0",
          protocolVersion: response.protocolVersion,
          pythonVersion: response.python,
          profileVersion: profileId,
          profileDigest: response.profileDigest,
          libraryVersions: response.packages,
          device: "cpu"
        };
      } catch (error) {
        return { status: "unavailable", reason: safeDetail(error.message, [pythonCommand, helperPath, runtimeProfilePath(), `${runtimeAnalysisDirectory}/models.lock.json`]) };
      }
    },

    async prepare(context) {
      const prepared = await resolvePreparedSource({ ...context, operation: "scenes", producesFiles: true });
      if (prepared.media.mediaType === "image") {
        throw new SourceAnalysisToolError("Scene detection không áp dụng cho nguồn ảnh.", "not_applicable");
      }
      const profileId = prepared.normalized.analysis.profileId ?? "source-standard-v1";
      if (profileId !== "source-standard-v1") {
        throw new SourceAnalysisToolError(`Visual profile không hỗ trợ: ${profileId}.`, "invalid_input");
      }
      const detectorOptions = validateOptions(prepared.normalized.analysis.options);
      const probe = await probeSource(prepared.media.filePath, { ffprobeCommand, signal: context.signal });
      const videos = probe.streams.filter((stream) => stream.codec_type === "video");
      const selected = selectStream(probe, "video", prepared.normalized.analysis.track);
      if (selected.stream !== videos[0]) {
        throw new SourceAnalysisToolError("PySceneDetect production hiện chỉ hỗ trợ video stream đầu tiên.", "unsupported_track");
      }
      const duration = Number(probe.format.duration ?? selected.stream.duration);
      const range = effectiveRange(prepared.normalized.analysis.range, duration);
      const name = "scenes.jsonl";
      return {
        runtime: {
          inputPath: prepared.media.filePath,
          outputPath: temporaryOutputPath(prepared.output, name),
          profileId,
          detectorOptions,
          range,
          signal: context.signal
        },
        trace: { ...prepared.trace, workspace: prepared.output, name }
      };
    },

    async execute({ inputPath, outputPath, profileId, detectorOptions, range, signal, availability }) {
      const result = await runProcess(pythonCommand, ["-I", helperPath, "scenes"], {
        signal,
        timeoutMs: timeoutForDuration(range, { baseMs: 60_000, factor: 2 }),
        input: {
          protocolVersion: "1.0",
          command: "scenes",
          inputPath,
          outputPath,
          profileId,
          profilesPath: runtimeProfilePath(),
          detectorOptions,
          range
        }
      });
      const response = parseResponse(result.stdout, "Scene helper");
      if (response.profileDigest !== availability.profileDigest) {
        throw new SourceAnalysisToolError("Scene profile đổi trong lúc chạy.", "tool_environment_changed");
      }
      if (
        !response.coverage ||
        Math.abs(response.coverage.startSeconds - range.startSeconds) > 0.001 ||
        Math.abs(response.coverage.endSeconds - range.endSeconds) > 0.001 ||
        !response.counts || !Number.isSafeInteger(response.counts.scenes) || response.counts.scenes < 1 ||
        !Number.isSafeInteger(response.counts.cuts) || response.counts.cuts !== response.counts.scenes - 1 ||
        !Array.isArray(response.warnings)
      ) throw new SourceAnalysisToolError("Scene helper trả coverage/counts không hợp lệ.", "invalid_helper_output");
      const info = await checkedFile(outputPath, "Dataset scene");
      const lines = (await readFile(outputPath, "utf8")).split(/\r?\n/).filter(Boolean);
      if (lines.length !== response.counts.scenes) {
        throw new SourceAnalysisToolError("Số row scene không khớp helper summary.", "invalid_helper_output");
      }
      let previous = range.startSeconds;
      for (const [index, line] of lines.entries()) {
        const row = JSON.parse(line);
        if (
          row.id !== `shot-${String(index + 1).padStart(5, "0")}` ||
          !Number.isFinite(row.startSeconds) || !Number.isFinite(row.endSeconds) ||
          Math.abs(row.startSeconds - previous) > 0.001 || row.endSeconds <= row.startSeconds ||
          row.endSeconds > range.endSeconds + 0.001 ||
          (index > 0 && !Number.isFinite(row.score))
        ) throw new SourceAnalysisToolError("Dataset scene có timestamp/ID không hợp lệ.", "invalid_helper_output");
        previous = row.endSeconds;
      }
      if (Math.abs(previous - range.endSeconds) > 0.001) {
        throw new SourceAnalysisToolError("Dataset scene không phủ hết range đã khai báo.", "invalid_helper_output");
      }
      return {
        file: { sizeBytes: info.size },
        response,
        verification: {
          status: "passed",
          checks: ["helper_exit_0", "jsonl_rows_valid", "continuous_range", "timestamps_in_range"],
          details: { helperVersion: availability.helperVersion, profileId }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      const file = outputFile({
        id: "scenes", role: "dataset", workspace: prepared.trace.workspace,
        name: prepared.trace.name, mediaType: "application/x-ndjson", sizeBytes: execution.file.sizeBytes
      });
      return {
        type: "source.scenes",
        name: `Cảnh: ${prepared.trace.sourceName}`,
        inputResources: prepared.trace.inputResources,
        inputResults: prepared.trace.inputResults,
        files: [file],
        data: {
          coverage: { ...execution.response.coverage, mode: "continuous" },
          outcome: "produced",
          counts: execution.response.counts,
          datasets: [{ kind: "scenes", fileId: "scenes" }],
          warnings: execution.response.warnings,
          contentReview: "not_performed",
          details: { boundaryMeaning: "visual_shot_candidate", detector: "AdaptiveDetector" }
        },
        verification: execution.verification
      };
    }
  };
}
