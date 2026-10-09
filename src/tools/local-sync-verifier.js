import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { normalizeVisualChoreography, ANIMATION_CHOREOGRAPHY_TYPE } from "../animation/visual-choreography.js";
import {
  DEFAULT_TOLERANCE_SECONDS,
  analyzeNarrationSync,
  parseMotionSeries
} from "../animation/sync-analysis.js";

const execFileAsync = promisify(execFile);

export const SYNC_VERIFIER_VERSION = "1.0.0";
export const SYNC_REPORT_TYPE = "animation.sync-report";

export class SyncVerifierError extends Error {
  constructor(message, code = "sync_verification_failed") {
    super(message);
    this.name = "SyncVerifierError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new SyncVerifierError(message, code);
}

const MOTION_FILTER = "scale=160:-2:flags=area,signalstats,metadata=mode=print:key=lavfi.signalstats.YDIF:file=-";

async function readWords(path) {
  const words = [];
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { fail("Transcript dataset is not valid JSONL.", "invalid_evidence"); }
    for (const word of row.words ?? []) {
      const startSeconds = Number(word.startSeconds);
      const endSeconds = Number(word.endSeconds);
      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) fail("Transcript word lacks a timestamp.", "invalid_evidence");
      words.push({ text: String(word.text ?? ""), startSeconds, endSeconds });
    }
  }
  return words;
}

function json(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

export function createLocalSyncVerifier({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  executeCommand = (command, args, options) => execFileAsync(command, args, {
    windowsHide: true, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options
  }),
  timeoutMs = 20 * 60 * 1000,
  now = () => new Date().toISOString()
} = {}) {
  return {
    name: "local-sync-verifier",
    version: SYNC_VERIFIER_VERSION,
    provider: "PADStudio",
    capability: "animation.verify-sync",
    description: "Đối chiếu narrationCueMap của choreography với video animation đã render: khi nào pixel thực sự đổi và (nếu có transcript) khi nào lời được nói.",
    runtime: "local",
    executionMode: "sync",
    producesFiles: true,
    approvalRequired: false,
    cost: { currency: "USD", estimated: 0 },
    sideEffects: ["Tạo một Result animation.sync-report mới trong outputs của project; không sửa render, choreography hay transcript."],
    inputSchema: {
      type: "object",
      required: ["resultId"],
      properties: {
        resultId: { type: "string" },
        transcriptResultId: { type: "string" },
        toleranceSeconds: { type: "number", minimum: 0.05, maximum: 2 }
      },
      additionalProperties: false
    },
    outputDescription: "Báo cáo từng cue: thời điểm đổi hình so với kế hoạch, khoảng giữ hình, và thời điểm lời nói nếu có transcript. Là bằng chứng để review, không phải phán quyết sáng tạo.",

    async checkAvailability() {
      try {
        const response = await executeCommand(ffmpegCommand, ["-version"], { timeout: 8_000 });
        return { status: "available", executableVersion: String(response.stdout).split(/\r?\n/)[0] };
      } catch (error) {
        return { status: "unavailable", reason: "FFmpeg là bắt buộc để đo chuyển động: " + (error?.message ?? "không chạy được.") };
      }
    },

    async prepare({ store, projectId, inputs, outputWorkspace }) {
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) ||
          Object.keys(inputs).some((key) => !["resultId", "transcriptResultId", "toleranceSeconds"].includes(key)) ||
          typeof inputs.resultId !== "string" || !inputs.resultId.trim() ||
          (inputs.transcriptResultId !== undefined && (typeof inputs.transcriptResultId !== "string" || !inputs.transcriptResultId.trim()))) {
        fail("Chỉ nhận resultId, transcriptResultId và toleranceSeconds tùy chọn.", "invalid_input");
      }
      const toleranceSeconds = inputs.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
      if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0.05 || toleranceSeconds > 2) {
        fail("toleranceSeconds phải trong khoảng 0.05–2.", "invalid_input");
      }
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        fail("PADStudio chưa cấp output workspace.", "invalid_output_workspace");
      }

      const render = await store.readResult(projectId, inputs.resultId.trim());
      if (render.type !== "animation.render") fail("Chỉ kiểm chứng được exact Result animation.render.", "invalid_source_result");
      const choreographyArtifactId = render.data?.choreographyArtifactId ?? null;
      if (!choreographyArtifactId) {
        fail("Render này không gắn choreography nào (composition 1.0), nên không có narrationCueMap để đối chiếu.", "no_choreography");
      }
      const artifact = (await store.readArtifacts(projectId)).find((item) => item.id === choreographyArtifactId);
      if (!artifact || artifact.type !== ANIMATION_CHOREOGRAPHY_TYPE) fail("Không tìm thấy exact choreography mà render đã bind.", "stale_choreography");
      const choreography = normalizeVisualChoreography(artifact.data);
      if (!choreography.narrationCueMap) {
        fail("Choreography đã bind không có narrationCueMap (chỉ có ở contract 1.3 khi Agent đã ghi).", "no_cue_map");
      }
      const frameRate = Number(render.data?.video?.frameRate);
      if (Number.isFinite(frameRate) && Math.abs(frameRate - choreography.fps) > 0.05) {
        fail("FPS của render khác choreography đã bind.", "fps_mismatch");
      }
      const durationSeconds = Number(render.data?.durationSeconds);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) fail("Render không có thời lượng hợp lệ.", "invalid_source_result");
      if (Math.abs(durationSeconds - choreography.durationSeconds) > Math.max(1, choreography.durationSeconds * 0.02)) {
        fail("Thời lượng render lệch choreography đã bind quá mức cho phép.", "duration_mismatch");
      }

      const video = await store.verifyResultFile(projectId, render.id, "primary");
      let transcript = null;
      let words = null;
      if (inputs.transcriptResultId !== undefined) {
        transcript = await store.readResult(projectId, inputs.transcriptResultId.trim());
        if (transcript.type !== "source.transcript") fail("transcriptResultId phải là Result source.transcript.", "invalid_transcript");
        if (transcript.data?.source?.kind !== "result" || transcript.data.source.id !== render.id ||
            transcript.data.sourceVersion !== video.sha256) {
          fail("Transcript không phải của đúng byte render này.", "transcript_not_for_render");
        }
        const dataset = (transcript.data.datasets ?? []).find((entry) => entry.kind === "transcript");
        if (!dataset) fail("Transcript Result không có dataset transcript.", "invalid_transcript");
        const file = await store.verifyResultFile(projectId, transcript.id, dataset.fileId);
        words = await readWords(file.filePath);
      }

      return {
        runtime: {
          videoPath: video.filePath, videoSha256: video.sha256, choreography, words, durationSeconds,
          toleranceSeconds, directory: outputWorkspace.temporaryDirectory, generatedAt: now()
        },
        trace: {
          renderResultId: render.id,
          transcriptResultId: transcript?.id ?? null,
          choreographyArtifactId: artifact.id,
          choreographyRevision: artifact.revision,
          compositionId: render.data?.composition?.id ?? null,
          compositionRevision: render.data?.composition?.revision ?? null,
          directory: outputWorkspace.projectRelativeDirectory,
          inputResults: [render.id, ...(transcript ? [transcript.id] : [])],
          inputArtifacts: [artifact.id, ...(render.data?.composition?.id ? [render.data.composition.id] : [])],
          inputResources: render.inputResources ?? []
        }
      };
    },

    async execute({ videoPath, videoSha256, choreography, words, durationSeconds, toleranceSeconds, directory, generatedAt, availability, signal }) {
      let output;
      try {
        const { stdout } = await executeCommand(
          ffmpegCommand,
          ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-an", "-vf", MOTION_FILTER, "-f", "null", "-"],
          { timeout: timeoutMs, signal }
        );
        output = stdout;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        fail("FFmpeg không đo được chuyển động: " + String(error?.stderr || error?.message || "lỗi không rõ").slice(-500),
          error?.code === "ENOENT" ? "tool_unavailable" : "motion_measurement_failed");
      }
      const series = parseMotionSeries(output);
      if (series.length < 2) fail("Không đọc được chuỗi chuyển động từ FFmpeg.", "motion_measurement_failed");

      const analysis = analyzeNarrationSync({ choreography, series, words, toleranceSeconds, durationSeconds });
      const report = {
        ...analysis,
        generatedAt,
        source: { videoSha256, durationSeconds },
        choreography: { cueMapDescription: choreography.narrationCueMap.sourceDescription, fps: choreography.fps }
      };
      const reportPath = join(directory, "sync-report.json");
      const motionPath = join(directory, "motion.json");
      await writeFile(reportPath, json(report), "utf8");
      await writeFile(motionPath, json({
        version: analysis.version, metric: analysis.motion.metric, noiseFloor: analysis.motion.noiseFloor,
        threshold: analysis.motion.threshold,
        // [seconds, value] pairs keep the file compact for long videos.
        frames: series.map((point) => [Math.round(point.seconds * 1000) / 1000, Math.round(point.value * 10000) / 10000])
      }), "utf8");
      return {
        report,
        files: [
          { id: "primary", role: "primary", path: reportPath, name: "sync-report.json", mediaType: "application/json", sizeBytes: (await lstat(reportPath)).size },
          { id: "motion", role: "evidence", path: motionPath, name: "motion.json", mediaType: "application/json", sizeBytes: (await lstat(motionPath)).size }
        ],
        executableVersion: availability?.executableVersion ?? null,
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      const { trace } = prepared;
      const { report } = execution;
      return {
        type: SYNC_REPORT_TYPE,
        name: `Narration sync: ${trace.renderResultId}`,
        inputResources: trace.inputResources,
        inputResults: trace.inputResults,
        inputArtifacts: trace.inputArtifacts,
        files: execution.files.map((file) => ({
          id: file.id, role: file.role, path: `${trace.directory}/${file.name}`, name: file.name,
          mediaType: file.mediaType, sizeBytes: file.sizeBytes
        })),
        data: {
          version: report.version,
          sourceResultId: trace.renderResultId,
          transcriptResultId: trace.transcriptResultId,
          choreographyArtifactId: trace.choreographyArtifactId,
          choreographyRevision: trace.choreographyRevision,
          composition: trace.compositionId ? { id: trace.compositionId, revision: trace.compositionRevision } : null,
          sourceSha256: report.source.videoSha256,
          toleranceSeconds: report.toleranceSeconds,
          motion: report.motion,
          transcriptSupplied: report.transcriptSupplied,
          summary: report.summary,
          limits: report.limits
        },
        verification: {
          status: "passed",
          checks: ["exact_render_checksum_verified", "choreography_binding_verified", "cue_map_present", "motion_series_measured",
            ...(report.transcriptSupplied ? ["transcript_bound_to_render_bytes"] : [])],
          details: {
            executableVersion: execution.executableVersion,
            creativeReview: "not_performed",
            note: "Measurement of pixel change and word timing only; not a verdict on motion quality or meaning."
          }
        }
      };
    }
  };
}
