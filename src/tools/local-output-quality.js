import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { readOutputQualityProfile, listOutputQualityProfiles } from "../quality/output-quality-profiles.js";

const execFileAsync = promisify(execFile);

export class OutputQualityToolError extends Error {
  constructor(message, code = "output_quality_failed") {
    super(message);
    this.name = "OutputQualityToolError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new OutputQualityToolError(message, code);
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} phải là object.`, "invalid_input");
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length) fail(`${label} chứa field không hỗ trợ: ${unknown.join(", ")}.`, "invalid_input");
  return value;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value) {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

export function parseVisualDefects(stderr) {
  const text = String(stderr ?? ""), black = [], freeze = [];
  for (const match of text.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)) {
    black.push({ startSeconds: Number(match[1]), endSeconds: Number(match[2]), durationSeconds: Number(match[3]) });
  }
  const starts = [...text.matchAll(/freeze_start:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  const ends = [...text.matchAll(/freeze_end:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  const durations = [...text.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  for (let index = 0; index < starts.length; index++) freeze.push({ startSeconds: starts[index], endSeconds: ends[index] ?? null, durationSeconds: durations[index] ?? (ends[index] === undefined ? null : ends[index] - starts[index]) });
  return { black, freeze };
}

async function transcriptRows(path) {
  const rows = [];
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { fail("Transcript evidence không phải JSONL hợp lệ.", "invalid_evidence"); }
  }
  return rows;
}

function transcriptMetrics(rows) {
  let segments = 0;
  let words = 0;
  let firstWordStartSeconds = null;
  let lastWordEndSeconds = null;
  let finalWord = null;
  for (const row of rows) {
    segments += 1;
    for (const word of row.words ?? []) {
      const start = finite(word.startSeconds);
      const end = finite(word.endSeconds);
      if (start === null || end === null) fail("Transcript word thiếu timestamp.", "invalid_evidence");
      if (firstWordStartSeconds === null) firstWordStartSeconds = start;
      lastWordEndSeconds = end;
      finalWord = { text: String(word.text ?? ""), startSeconds: start, endSeconds: end, score: finite(word.score) };
      words += 1;
    }
  }
  return { segments, words, firstWordStartSeconds, lastWordEndSeconds, finalWord };
}

export function sourceCutBoundaryCheck(rows, range, toleranceSeconds = 0.001) {
  const words = rows.flatMap((row) => row.words ?? []).map((word) => ({
    text: String(word.text ?? ""),
    startSeconds: finite(word.startSeconds),
    endSeconds: finite(word.endSeconds)
  })).filter((word) => word.startSeconds !== null && word.endSeconds !== null);
  const crosses = (boundary) => words.filter((word) =>
    word.startSeconds < boundary - toleranceSeconds && word.endSeconds > boundary + toleranceSeconds
  );
  const startCrossings = crosses(range.startSeconds);
  const endCrossings = crosses(range.endSeconds);
  const previous = words.filter((word) => word.endSeconds <= range.endSeconds + toleranceSeconds).at(-1) ?? null;
  return {
    status: startCrossings.length || endCrossings.length ? "failed" : "passed",
    startCrossings,
    endCrossings,
    endMarginSeconds: previous ? rounded(Math.max(0, range.endSeconds - previous.endSeconds)) : null
  };
}

async function sourceCutEvidence(store, projectId, context, sourceResult, profile) {
  if (!profile.speechExpected) return [];
  const artifact = context.artifacts.find((candidate) => candidate.id === sourceResult.data?.sequence?.artifactId);
  if (!artifact) fail("Không tìm thấy exact sequence artifact của render.", "invalid_source_result");
  const inspected = [];
  for (const segment of artifact.data?.segments ?? []) {
    const visual = segment.visual;
    if (!visual?.source || visual.volume === 0 || !Number.isFinite(visual.startSeconds)) continue;
    const references = [...(artifact.references ?? []), ...(segment.references ?? [])];
    const transcript = references.map((reference) =>
      reference.kind === "result" ? context.results.find((candidate) => candidate.id === reference.id) : null
    ).filter((candidate) => candidate?.type === "source.transcript").find((candidate) =>
      visual.source.kind === "resource"
        ? candidate.inputResources.includes(visual.source.id)
        : candidate.inputResults.includes(visual.source.id)
    );
    if (!transcript) continue;
    const dataset = await store.verifyResultFile(projectId, transcript.id, "segments");
    const range = {
      startSeconds: visual.startSeconds,
      endSeconds: visual.startSeconds + segment.durationSeconds
    };
    inspected.push({
      segmentId: segment.id,
      transcriptResultId: transcript.id,
      source: visual.source,
      range,
      ...sourceCutBoundaryCheck(await transcriptRows(dataset.filePath), range)
    });
  }
  return inspected;
}

function check(id, status, evidence, metrics = undefined) {
  return { id, status, evidence, ...(metrics === undefined ? {} : { metrics }) };
}

function evidenceMatches(result, sourceResult, type) {
  return result?.type === type && result.verification?.status === "passed" &&
    result.data?.source?.kind === "result" &&
    result.data.source.id === sourceResult.id && result.data.source.file === "primary" &&
    result.inputResults.includes(sourceResult.id);
}

export function createLocalOutputQuality({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  executeCommand = (command, args, options) => execFileAsync(command, args, {
    windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...options
  }),
  timeoutMs = 180_000,
  now = () => new Date().toISOString()
} = {}) {
  return {
    name: "local-output-quality",
    version: "1.2.0",
    provider: "PADStudio",
    capability: "video.inspect-output",
    description: "Tổng hợp full decode, hình, audio và ASR của exact render thành bằng chứng QA fail-closed.",
    runtime: "local",
    executionMode: "sync",
    producesFiles: true,
    approvalRequired: false,
    cost: { currency: "USD", estimated: 0 },
    sideEffects: ["Tạo một Result QA và report JSON; không sửa video, review hoặc Decision."],
    inputSchema: {
      type: "object",
      required: ["resultId", "analysisJobId", "profileId", "evidenceResultIds", "inspectionPoints"],
      properties: {
        resultId: { type: "string" }, analysisJobId: { type: "string" },
        profileId: { enum: listOutputQualityProfiles().map((profile) => profile.id) },
        evidenceResultIds: { type: "object" }, inspectionPoints: { type: "array" }
      },
      additionalProperties: false
    },
    outputDescription: "video.output-quality với report, exact evidence references, cut margins và delivery gate.",

    async checkAvailability() {
      try {
        const response = await executeCommand(ffmpegCommand, ["-version"], { timeout: 5_000 });
        return { status: "available", executableVersion: String(response.stdout).split(/\r?\n/)[0] };
      } catch (error) {
        return { status: "unavailable", reason: error?.message || "FFmpeg unavailable." };
      }
    },

    async prepare({ store, projectId, inputs, outputWorkspace }) {
      exactObject(inputs, ["resultId", "analysisJobId", "profileId", "evidenceResultIds", "inspectionPoints"], "Output QA inputs");
      if (![inputs.resultId, inputs.analysisJobId, inputs.profileId].every((value) => typeof value === "string" && value.trim())) {
        fail("Output QA thiếu resultId, analysisJobId hoặc profileId.", "invalid_input");
      }
      const profile = readOutputQualityProfile(inputs.profileId);
      if (!Array.isArray(inputs.inspectionPoints) || inputs.inspectionPoints.length < 1 || inputs.inspectionPoints.length > 24 || inputs.inspectionPoints.some((item) => !item || !Number.isFinite(item.seconds) || typeof item.track !== "string" || typeof item.label !== "string" || !["start", "middle", "end"].includes(item.position))) {
        fail("inspectionPoints không hợp lệ.", "invalid_input");
      }
      const evidenceIds = exactObject(
        inputs.evidenceResultIds,
        ["probe", "frames", "audio", "transcript"],
        "evidenceResultIds"
      );
      for (const key of ["probe", "frames", "audio", ...(profile.speechExpected ? ["transcript"] : [])]) {
        if (typeof evidenceIds[key] !== "string" || !evidenceIds[key]) fail(`Thiếu evidence ${key}.`, "missing_evidence");
      }
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        fail("PADStudio chưa cấp output workspace cho QA.", "invalid_output_workspace");
      }
      const context = await store.readContext(projectId);
      const sourceResult = context.results.find((result) => result.id === inputs.resultId);
      if (!sourceResult || sourceResult.type !== "video.sequence-render" || sourceResult.verification?.status !== "passed") {
        fail("Output QA cần exact video.sequence-render đã kiểm chứng.", "invalid_source_result");
      }
      const definitions = {
        probe: "source.metadata", frames: "source.frames", audio: "source.audio-analysis", transcript: "source.transcript"
      };
      const evidence = {};
      for (const [key, type] of Object.entries(definitions)) {
        if (!evidenceIds[key]) continue;
        const result = context.results.find((candidate) => candidate.id === evidenceIds[key]);
        if (!evidenceMatches(result, sourceResult, type)) {
          fail(`Evidence ${key} không khớp exact render/job.`, "invalid_evidence");
        }
        evidence[key] = result;
      }
      for (const result of Object.values(evidence)) {
        for (const file of result.files) await store.verifyResultFile(projectId, result.id, file.id);
      }
      const sourceFile = await store.verifyResultFile(projectId, sourceResult.id, "primary");
      const frameDataset = await store.verifyResultFile(projectId, evidence.frames.id, "frames");
      const frameRows = await transcriptRows(frameDataset.filePath);
      const contactSheetFiles = evidence.frames.data?.details?.contactSheets?.map((page) => page.fileId) ?? [];
      for (const fileId of contactSheetFiles) await store.verifyResultFile(projectId, evidence.frames.id, fileId);
      const audioDataset = await store.verifyResultFile(projectId, evidence.audio.id, "audio");
      const transcriptDataset = profile.speechExpected
        ? await store.verifyResultFile(projectId, evidence.transcript.id, "segments") : null;
      const sourceCuts = await sourceCutEvidence(store, projectId, context, sourceResult, profile);
      return {
        runtime: {
          sourcePath: sourceFile.filePath,
          sourceSha256: sourceFile.sha256,
          sourceResult,
          analysisJobId: inputs.analysisJobId,
          profile,
          evidence,
          transcriptPath: transcriptDataset?.filePath ?? null,
          sourceCuts,
          inspectionPoints: inputs.inspectionPoints,
          frameRows,
          reportPath: join(outputWorkspace.temporaryDirectory, "quality-report.json"),
          generatedAt: now()
        },
        trace: {
          sourceResult,
          evidenceIds: [...new Set([
            ...Object.values(evidenceIds).filter(Boolean),
            ...sourceCuts.map((item) => item.transcriptResultId)
          ])],
          finalDirectory: outputWorkspace.projectRelativeDirectory,
          verifiedFiles: [sourceFile, frameDataset, audioDataset, ...(transcriptDataset ? [transcriptDataset] : [])],
          contactSheetFiles
        }
      };
    },

    async execute({ sourcePath, sourceSha256, sourceResult, analysisJobId, profile, evidence, transcriptPath, sourceCuts, inspectionPoints, frameRows, reportPath, generatedAt, availability, signal }) {
      try {
        await executeCommand(ffmpegCommand, ["-hide_banner", "-v", "error", "-nostdin", "-i", sourcePath, "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"], { timeout: timeoutMs, signal });
      } catch (error) {
        fail(error?.killed ? "Full decode QA vượt thời gian." : "Exact render không vượt qua full decode.", "decode_failed");
      }
      const durationSeconds = finite(evidence.probe.data?.details?.format?.durationSeconds) ?? finite(sourceResult.data?.durationSeconds);
      if (durationSeconds === null || durationSeconds <= 0) fail("QA không xác định được thời lượng render.", "invalid_evidence");
      let visualDefects;
      try {
        const visualResponse = await executeCommand(ffmpegCommand, ["-hide_banner", "-nostdin", "-i", sourcePath,
          "-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-60dB:d=2", "-an", "-f", "null", "-"], { timeout: timeoutMs, signal });
        visualDefects = parseVisualDefects(visualResponse.stderr);
      } catch (error) {
        fail(error?.killed ? "Visual defect scan vượt thời gian." : "Không thể quét black/freeze frame.", "visual_scan_failed");
      }
      const severeBlack = visualDefects.black.filter((item) => item.durationSeconds >= Math.min(2, durationSeconds * 0.2));
      const severeFreeze = visualDefects.freeze.filter((item) => item.durationSeconds !== null && item.durationSeconds >= Math.max(5, durationSeconds * 0.5));
      const uncoveredPoints = inspectionPoints.filter((point) => !frameRows.some((row) => Math.abs((finite(row.actualTime) ?? finite(row.requestedTime) ?? -999) - point.seconds) <= 0.25));
      const transcript = profile.speechExpected ? transcriptMetrics(await transcriptRows(transcriptPath)) : null;
      const leadSeconds = transcript?.firstWordStartSeconds === null || transcript?.firstWordStartSeconds === undefined
        ? null : transcript.firstWordStartSeconds;
      const tailSeconds = transcript?.lastWordEndSeconds === null || transcript?.lastWordEndSeconds === undefined
        ? null : Math.max(0, durationSeconds - transcript.lastWordEndSeconds);
      const checks = [
        check("full-decode", "passed", "FFmpeg decoded the exact registered render without errors."),
        check("visual-samples", evidence.frames.data.counts.frames >= profile.minimumFrames && evidence.frames.data.counts.contactSheets >= profile.minimumContactSheets ? "passed" : "failed",
          "Frame extraction and contact-sheet evidence must meet the selected profile.", {
            frames: evidence.frames.data.counts.frames, contactSheets: evidence.frames.data.counts.contactSheets,
            minimumFrames: profile.minimumFrames, minimumContactSheets: profile.minimumContactSheets
          }),
        check("audio-analysis", evidence.audio.verification.status === "passed" ? "passed" : "failed", "Exact-output PCM decode and loudness analysis completed."),
        check("clipping", evidence.audio.data.counts.clippingCandidates === 0 ? "passed" : "failed", "No clipping candidate is allowed.", {
          clippingCandidates: evidence.audio.data.counts.clippingCandidates,
          peakNormalized: evidence.audio.data.details?.peakNormalized ?? null
        }),
        check("black-frame-windows", severeBlack.length ? "failed" : visualDefects.black.length ? "warning" : "passed", "Black windows are measured from exact decoded pixels; short windows may be intentional transitions.", { windows: visualDefects.black, severeWindows: severeBlack.length }),
        check("freeze-windows", severeFreeze.length ? "warning" : "passed", "Frozen windows are reported for review because intentional still-image segments can look identical.", { windows: visualDefects.freeze, severeWindows: severeFreeze.length })
        ,check("timeline-window-samples", uncoveredPoints.length ? "failed" : "passed", "Exact frames must cover planned segment, caption, overlay, and transition windows.", { requested: inspectionPoints.length, covered: inspectionPoints.length - uncoveredPoints.length, uncoveredPoints })
      ];
      if (profile.speechExpected) {
        const failedSourceCuts = sourceCuts.filter((item) => item.status === "failed");
        checks.push(
          check("speech-detected", transcript.words > 0 ? "passed" : "failed", "Spoken profile requires word-timestamp evidence.", { words: transcript.words, segments: transcript.segments }),
          check("speech-lead", leadSeconds !== null && leadSeconds >= profile.minimumSpeechLeadSeconds ? "passed" : "failed", "First word must not touch the start cut.", { leadSeconds: rounded(leadSeconds), minimumSeconds: profile.minimumSpeechLeadSeconds }),
          check("speech-tail", tailSeconds !== null && tailSeconds >= profile.minimumSpeechTailSeconds ? "passed" : "failed", "Final word must have safe room before the end cut.", { tailSeconds: rounded(tailSeconds), minimumSeconds: profile.minimumSpeechTailSeconds }),
          check("final-word-confidence", transcript.finalWord?.score !== null && transcript.finalWord?.score >= profile.minimumFinalWordScore ? "passed" : "failed", "Final ASR word needs a usable confidence score; this does not prove semantic correctness.", { finalWord: transcript.finalWord, minimumScore: profile.minimumFinalWordScore }),
          check("source-word-boundaries", sourceCuts.length === 0 ? "not_applicable" : failedSourceCuts.length ? "failed" : "passed", sourceCuts.length === 0
            ? "No referenced source transcript is available for source-led cut validation."
            : "Source-led in/out points must not cross referenced source transcript words.", { inspectedSegments: sourceCuts.length, failedSegments: failedSourceCuts.map((item) => item.segmentId) })
        );
      }
      const failed = checks.filter((item) => item.status === "failed");
      const report = {
        version: "1.0",
        generatedAt,
        sourceResultId: sourceResult.id,
        sourceSha256,
        analysisJobId,
        profile,
        gate: { status: failed.length ? "failed" : "passed_with_notes", deliveryEligible: failed.length === 0, failedCheckIds: failed.map((item) => item.id) },
        checks,
        metrics: {
          durationSeconds: rounded(durationSeconds),
          frames: evidence.frames.data.counts.frames,
          contactSheets: evidence.frames.data.counts.contactSheets,
          clippingCandidates: evidence.audio.data.counts.clippingCandidates,
          integratedLufs: evidence.audio.data.details?.integratedLufs ?? null,
          visualDefects,
          timelineInspection: { points: inspectionPoints, uncoveredPoints },
          ...(transcript ? { transcript, speechLeadSeconds: rounded(leadSeconds), speechTailSeconds: rounded(tailSeconds) } : {})
        },
        sourceCuts,
        evidence: {
          probeResultId: evidence.probe.id,
          framesResultId: evidence.frames.id,
          audioResultId: evidence.audio.id,
          transcriptResultId: evidence.transcript?.id ?? null,
          contactSheetFileIds: evidence.frames.data?.details?.contactSheets?.map((page) => page.fileId) ?? [],
          analysisJobIds: Object.fromEntries(Object.entries(evidence).map(([key, result]) => [key, result.data.analysisJobId]))
        },
        humanReview: {
          visual: "not_performed",
          auditory: "not_performed",
          note: "Machine QA, contact sheets and ASR do not replace full human viewing/listening or creative review."
        }
      };
      await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      return { report, reportSizeBytes: (await lstat(reportPath)).size, verification: {
        status: "passed",
        checks: ["exact_render_resolved", "evidence_bound_to_analysis_job", "evidence_checksums_verified", "full_decode_passed", "quality_report_written"],
        details: { executableVersion: availability.executableVersion }
      }, actualCostUsd: 0 };
    },

    createResult({ prepared, execution }) {
      return {
        type: "video.output-quality",
        name: `Output QA: ${prepared.trace.sourceResult.name}`,
        inputResources: prepared.trace.sourceResult.inputResources,
        inputResults: [prepared.trace.sourceResult.id, ...prepared.trace.evidenceIds],
        inputArtifacts: prepared.trace.sourceResult.inputArtifacts,
        files: [{
          id: "report", role: "quality-report",
          path: prepared.trace.finalDirectory + "/quality-report.json",
          name: "quality-report.json", mediaType: "application/json",
          sizeBytes: execution.reportSizeBytes
        }],
        data: execution.report,
        verification: execution.verification
      };
    }
  };
}
