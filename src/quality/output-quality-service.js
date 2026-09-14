import { createDefaultAnalysisService } from "../analysis/default-analysis-service.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { ToolExecutor } from "../execution/tool-executor.js";
import { ProjectStore } from "../project/project-store.js";
import { readOutputQualityProfile } from "./output-quality-profiles.js";
import { compositionTimeline } from "../production/sequence-composition.js";

export class OutputQualityServiceError extends Error {
  constructor(message, code = "output_quality_failed") {
    super(message);
    this.name = "OutputQualityServiceError";
    this.code = code;
  }
}

function normalizeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OutputQualityServiceError("Output quality request phải là object.", "invalid_input");
  }
  const allowed = ["resultId", "profileId", "language", "reuse"];
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
  return { resultId: value.resultId.trim(), profile, language: language?.trim() ?? null, reuse };
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

function sameEvidence(result, profileId, ids) {
  if (result.type !== "video.output-quality" || result.tool?.name !== "local-output-quality" ||
      result.tool?.version !== "1.2.0" || result.data?.profile?.id !== profileId) return false;
  const evidence = result.data.evidence ?? {};
  return evidence.probeResultId === ids.probe && evidence.framesResultId === ids.frames &&
    evidence.audioResultId === ids.audio && (evidence.transcriptResultId ?? null) === (ids.transcript ?? null);
}

export function sequenceInspectionPoints(artifact, limit = 24) {
  const rows = compositionTimeline(artifact.data).filter((row) => row.track === "Hình" || row.track === "Chữ" || row.track.startsWith("Lớp phủ") || row.track === "Chuyển cảnh");
  const duration = Number(artifact.data.segments.reduce((sum, segment) => sum + segment.durationSeconds - (segment.transition?.durationSeconds ?? 0), 0).toFixed(6));
  const points = [];
  for (const row of rows) for (const [position, time] of [["start", row.startSeconds], ["middle", (row.startSeconds + row.endSeconds) / 2], ["end", row.endSeconds]]) {
    const seconds = Math.max(0, Math.min(duration - 0.001, time));
    const key = seconds.toFixed(3); if (!points.some((item) => item.seconds.toFixed(3) === key)) points.push({ seconds, track: row.track, label: row.label, position });
  }
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
      ranges: {}, tracks: {}, options: { frames: { contactSheet: true, timestamps: inspectionPoints.map((item) => item.seconds), budget: inspectionPoints.length } }
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
      result.inputResults.includes(source.id) && sameEvidence(result, request.profile.id, ids)).at(-1);
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
        inspectionPoints
      }
    });
    return { ...execution, reused: false, analysis };
  }
}

export function createDefaultOutputQualityService({ rootDir } = {}) {
  return new OutputQualityService({ rootDir });
}
