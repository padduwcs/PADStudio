import { createHash } from "node:crypto";
import { createDefaultAnalysisService } from "../analysis/default-analysis-service.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { ToolExecutor } from "../execution/tool-executor.js";
import { ProjectStore } from "../project/project-store.js";
import { readOutputQualityProfile } from "./output-quality-profiles.js";
import { compositionTimeline } from "../production/sequence-composition.js";
import { OUTPUT_QUALITY_TOOL_VERSION } from "../tools/local-output-quality.js";

export class OutputQualityServiceError extends Error {
  constructor(message, code = "output_quality_failed") {
    super(message);
    this.name = "OutputQualityServiceError";
    this.code = code;
  }
}

function normalizeExpectedSpeech(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OutputQualityServiceError("expectedSpeech phải là object.", "invalid_input");
  const allowed = ["text", "terms", "minimumSimilarity", "minimumTermSimilarity"];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new OutputQualityServiceError("expectedSpeech chứa field không hỗ trợ: " + unknown.join(", "), "invalid_input");
  if (typeof value.text !== "string" || !value.text.trim()) throw new OutputQualityServiceError("expectedSpeech.text phải là văn bản không rỗng.", "invalid_input");
  const terms = value.terms ?? [];
  if (!Array.isArray(terms) || terms.length > 100 || terms.some((term) => typeof term !== "string" || !term.trim() || term.length > 200)) {
    throw new OutputQualityServiceError("expectedSpeech.terms không hợp lệ.", "invalid_input");
  }
  const threshold = (input, fallback, label) => {
    const number = input ?? fallback;
    if (!Number.isFinite(number) || number < 0 || number > 1) throw new OutputQualityServiceError(`${label} phải nằm trong [0, 1].`, "invalid_input");
    return number;
  };
  return {
    text: value.text.trim(), terms: [...new Set(terms.map((term) => term.trim()))],
    minimumSimilarity: threshold(value.minimumSimilarity, 0.75, "minimumSimilarity"),
    minimumTermSimilarity: threshold(value.minimumTermSimilarity, 0.8, "minimumTermSimilarity"),
  };
}

function normalizeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OutputQualityServiceError("Output quality request phải là object.", "invalid_input");
  }
  const allowed = ["resultId", "profileId", "language", "reuse", "expectedSpeech"];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new OutputQualityServiceError("Output quality request chứa field không hỗ trợ: " + unknown.join(", "), "invalid_input");
  if (typeof value.resultId !== "string" || !value.resultId.trim()) {
    throw new OutputQualityServiceError("Output quality request thiếu resultId.", "invalid_input");
  }
  const profileId = value.profileId ?? "spoken-video-v1";
  const profile = readOutputQualityProfile(profileId);
  const language = value.language ?? (profile.speechExpected ? "vi" : null);
  if (language !== null && (typeof language !== "string" || !language.trim())) {
    throw new OutputQualityServiceError("language không hợp lệ.", "invalid_input");
  }
  const reuse = value.reuse ?? "verified";
  if (!["verified", "never"].includes(reuse)) throw new OutputQualityServiceError("reuse phải là verified hoặc never.", "invalid_input");
  return { resultId: value.resultId.trim(), profile, language: language?.trim() ?? null, reuse, expectedSpeech: normalizeExpectedSpeech(value.expectedSpeech) };
}

function evidenceIds(job, speechExpected) {
  const ids = {};
  for (const operation of ["probe", "frames", "audio", ...(speechExpected ? ["transcript"] : [])]) {
    const unit = job.units.find((candidate) => candidate.operation === operation);
    if (!unit?.resultId || !["succeeded", "reused"].includes(unit.state)) {
      throw new OutputQualityServiceError(`Analysis operation ${operation} không tạo verified Result.`, "analysis_incomplete");
    }
    ids[operation] = unit.resultId;
  }
  return ids;
}

function expectedSpeechFingerprint(expectedSpeech) {
  return expectedSpeech ? createHash("sha256").update(JSON.stringify(expectedSpeech)).digest("hex") : null;
}

function sameEvidence(result, profileId, ids, speechFingerprint) {
  if (result.type !== "video.output-quality" || result.tool?.name !== "local-output-quality" ||
      result.tool?.version !== OUTPUT_QUALITY_TOOL_VERSION || result.data?.profile?.id !== profileId ||
      (result.data?.expectedSpeech?.fingerprint ?? null) !== speechFingerprint) return false;
  const evidence = result.data.evidence ?? {};
  return evidence.probeResultId === ids.probe && evidence.framesResultId === ids.frames &&
    evidence.audioResultId === ids.audio && (evidence.transcriptResultId ?? null) === (ids.transcript ?? null);
}

export function sequenceInspectionPoints(artifact, limit = 120, targetGapSeconds = 5) {
  const rows = compositionTimeline(artifact.data).filter((row) => row.track === "Hình" || row.track === "Chữ" || row.track.startsWith("Lớp phủ") || row.track === "Chuyển cảnh");
  const duration = Number(artifact.data.segments.reduce((sum, segment) => sum + segment.durationSeconds - (segment.transition?.durationSeconds ?? 0), 0).toFixed(6));
  const points = [];
  for (const row of rows) for (const [position, time] of [["start", row.startSeconds], ["middle", (row.startSeconds + row.endSeconds) / 2], ["end", row.endSeconds]]) {
    const seconds = Math.max(0, Math.min(duration - 0.001, time));
    const key = seconds.toFixed(3); if (!points.some((item) => item.seconds.toFixed(3) === key)) points.push({ seconds, track: row.track, label: row.label, position });
  }
  const cadenceCount = Math.min(limit, Math.max(2, Math.ceil(duration / targetGapSeconds) + 1));
  for (let index = 0; index < cadenceCount; index++) {
    const seconds = Math.max(0, Math.min(duration - 0.001, index * duration / (cadenceCount - 1)));
    const key = seconds.toFixed(3);
    if (!points.some((item) => item.seconds.toFixed(3) === key)) points.push({ seconds, track: "Coverage", label: "Timeline cadence", position: index === 0 ? "start" : index === cadenceCount - 1 ? "end" : "middle" });
  }
  points.sort((left, right) => left.seconds - right.seconds);
  if (points.length <= limit) return points;
  return Array.from({ length: limit }, (_, index) => points[Math.round(index * (points.length - 1) / (limit - 1))]);
}

export class OutputQualityService {
  constructor({ rootDir, store = null, registry = null, analysisService = null, executor = null } = {}) {
    if (typeof rootDir !== "string" || !rootDir) throw new OutputQualityServiceError("OutputQualityService cần project root.");
    this.store = store ?? new ProjectStore(rootDir);
    this.registry = registry ?? createDefaultToolRegistry();
    this.analysisService = analysisService ?? createDefaultAnalysisService({ rootDir, registry: this.registry });
    this.executor = executor ?? new ToolExecutor({ store: this.store, registry: this.registry });
  }

  async inspect(projectId, requestValue) {
    const request = normalizeRequest(requestValue);
    const source = await this.store.readResult(projectId, request.resultId);
    if (source.type !== "video.sequence-render") {
      throw new OutputQualityServiceError("Output QA chỉ nhận video.sequence-render.", "invalid_source_result");
    }
    const artifact = (await this.store.readArtifacts(projectId)).find((item) => item.id === source.data?.sequence?.artifactId);
    if (!artifact || artifact.revision !== source.data?.sequence?.revision) throw new OutputQualityServiceError("Không tìm thấy exact sequence artifact của render.", "invalid_source_result");
    const derivedText = artifact.data.segments.map((segment) => segment.narration?.text).filter(Boolean).join(" ").trim();
    const expectedSpeech = request.profile.speechExpected
      ? request.expectedSpeech ?? (derivedText ? normalizeExpectedSpeech({ text: derivedText }) : null)
      : null;
    const speechFingerprint = expectedSpeechFingerprint(expectedSpeech);
    const inspectionPoints = sequenceInspectionPoints(artifact);
    const operations = ["frames", "audio", ...(request.profile.speechExpected ? ["transcript"] : [])];
    const analysis = await this.analysisService.createAndRun(projectId, {
      version: "1.0",
      sources: [{ kind: "result", id: source.id, file: "primary" }],
      resourceFolders: [],
      operations,
      profiles: {
        probe: "source-probe-v1",
        visual: "source-standard-v1",
        audio: "audio-standard-v1",
        ...(request.profile.speechExpected ? { asr: "large-v3-gpu-fp16" } : {})
      },
      language: request.language,
      reuse: request.reuse,
      ranges: {}, tracks: {}, options: {
        frames: { contactSheet: true, timestamps: inspectionPoints.map((item) => item.seconds), budget: inspectionPoints.length },
        ...(expectedSpeech?.terms.length ? { transcript: { glossary: expectedSpeech.terms, glossaryVersion: speechFingerprint } } : {})
      }
    });
    if (analysis.state !== "completed") {
      const detail = analysis.job.units.map((unit) =>
        `${unit.operation}=${unit.state}${unit.error ? ` (${unit.error})` : ""}`
      ).join(", ");
      throw new OutputQualityServiceError(
        `Analysis job ${analysis.analysisJobId} kết thúc ở trạng thái ${analysis.state}: ${detail}.`,
        "analysis_incomplete"
      );
    }
    const ids = evidenceIds(analysis.job, request.profile.speechExpected);
    const context = await this.store.readContext(projectId);
    const reusable = context.results.filter((result) =>
      result.inputResults.includes(source.id) && sameEvidence(result, request.profile.id, ids, speechFingerprint)).at(-1);
    if (reusable && request.reuse === "verified") {
      await this.store.verifyResultFile(projectId, reusable.id, "report");
      return { status: "completed", reused: true, analysis, result: reusable };
    }
    const execution = await this.executor.execute(projectId, {
      capability: "video.inspect-output",
      tool: "local-output-quality",
      purpose: `Tạo automated output QA cho exact Result ${source.id}.`,
      inputs: {
        resultId: source.id,
        analysisJobId: analysis.analysisJobId,
        profileId: request.profile.id,
        evidenceResultIds: ids,
        inspectionPoints,
        expectedSpeech
      }
    });
    return { ...execution, reused: false, analysis };
  }
}

export function createDefaultOutputQualityService({ rootDir } = {}) {
  return new OutputQualityService({ rootDir });
}
