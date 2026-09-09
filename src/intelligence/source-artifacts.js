import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  assertSha256,
  normalizeSourceReference,
  normalizeTimeRange
} from "../analysis/contracts.js";
import { resolveAnalysisSource, sha256File } from "../analysis/source-identity.js";
import {
  IntelligenceValidationError,
  assertOnlyFields,
  normalizeStringList,
  requireId,
  requireObject,
  requireText
} from "./contracts.js";

export const SOURCE_PROFILE_TYPE = "source.profile";
export const SOURCE_ASSESSMENT_TYPE = "source.assessment";
export const TRANSCRIPT_EDIT_TYPE = "source.transcript-edit";
export const SOURCE_ARTIFACT_TYPES = new Set([
  SOURCE_PROFILE_TYPE,
  SOURCE_ASSESSMENT_TYPE,
  TRANSCRIPT_EDIT_TYPE
]);

const VERSION = "1.0";
const EVIDENCE_ACTIONS = new Set([
  "viewed_frame", "listened", "watched", "read_transcript", "read_measurement"
]);

function optionalText(value, label) {
  return value === undefined || value === null || value === "" ? null : requireText(value, label);
}

function sourceIdentity(data, label) {
  if (data.version !== VERSION) throw new IntelligenceValidationError(label + ".version must be 1.0.");
  return {
    version: VERSION,
    source: normalizeSourceReference(data.source, label + ".source"),
    sourceKey: assertSha256(data.sourceKey, label + ".sourceKey"),
    sourceVersion: assertSha256(data.sourceVersion, label + ".sourceVersion")
  };
}

function evidencePointer(value, label) {
  const pointer = requireObject(value, label);
  assertOnlyFields(pointer, ["resultId", "itemId", "fileId", "range"], label);
  return {
    resultId: requireId(pointer.resultId, label + ".resultId"),
    ...(pointer.itemId === undefined ? {} : { itemId: requireId(pointer.itemId, label + ".itemId") }),
    ...(pointer.fileId === undefined ? {} : { fileId: requireId(pointer.fileId, label + ".fileId") }),
    ...(pointer.range === undefined ? {} : { range: normalizeTimeRange(pointer.range, label + ".range", { nullable: false }) })
  };
}

function evidencePointers(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new IntelligenceValidationError(label + " must be a non-empty array.");
  }
  return value.map((entry, index) => evidencePointer(entry, label + "[" + index + "]"));
}

function reviewedEvidence(value, label) {
  if (!Array.isArray(value)) throw new IntelligenceValidationError(label + " must be an array.");
  return value.map((entry, index) => {
    const itemLabel = label + "[" + index + "]";
    const item = requireObject(entry, itemLabel);
    assertOnlyFields(item, ["resultId", "itemId", "fileId", "range", "action", "reviewedBy"], itemLabel);
    const action = requireText(item.action, itemLabel + ".action");
    if (!EVIDENCE_ACTIONS.has(action)) throw new IntelligenceValidationError(itemLabel + ".action is unsupported.");
    const reviewedBy = requireText(item.reviewedBy, itemLabel + ".reviewedBy");
    if (!["agent", "user", "system"].includes(reviewedBy)) {
      throw new IntelligenceValidationError(itemLabel + ".reviewedBy is unsupported.");
    }
    return {
      ...evidencePointer({
        resultId: item.resultId,
        ...(item.itemId === undefined ? {} : { itemId: item.itemId }),
        ...(item.fileId === undefined ? {} : { fileId: item.fileId }),
        ...(item.range === undefined ? {} : { range: item.range })
      }, itemLabel),
      action,
      reviewedBy
    };
  });
}

function normalizeProfile(data) {
  const label = "source.profile data";
  requireObject(data, label);
  assertOnlyFields(data, [
    "version", "source", "sourceKey", "sourceVersion", "usage", "purpose",
    "constraints", "originNote", "changeReason"
  ], label);
  const usage = requireText(data.usage, label + ".usage");
  if (!["source", "reference", "both", "unclassified"].includes(usage)) {
    throw new IntelligenceValidationError(label + ".usage is unsupported.");
  }
  return {
    ...sourceIdentity(data, label),
    usage,
    purpose: requireText(data.purpose, label + ".purpose"),
    constraints: normalizeStringList(data.constraints, label + ".constraints"),
    originNote: optionalText(data.originNote, label + ".originNote"),
    changeReason: requireText(data.changeReason, label + ".changeReason")
  };
}

function normalizeCoverage(value) {
  const coverage = requireObject(value, "source.assessment data.reviewCoverage");
  assertOnlyFields(coverage, ["visual", "audio", "text"], "source.assessment data.reviewCoverage");
  const result = {};
  for (const modality of ["visual", "audio", "text"]) {
    const label = "source.assessment data.reviewCoverage." + modality;
    const entry = requireObject(coverage[modality], label);
    assertOnlyFields(entry, ["status", "ranges", "note"], label);
    const status = requireText(entry.status, label + ".status");
    if (!["not_reviewed", "sampled", "partial", "complete"].includes(status)) {
      throw new IntelligenceValidationError(label + ".status is unsupported.");
    }
    const ranges = entry.ranges ?? [];
    if (!Array.isArray(ranges)) throw new IntelligenceValidationError(label + ".ranges must be an array.");
    result[modality] = {
      status,
      ranges: ranges.map((range, index) => normalizeTimeRange(range, label + ".ranges[" + index + "]", { nullable: false })),
      note: optionalText(entry.note, label + ".note")
    };
  }
  return result;
}

function normalizeAssessment(data) {
  const label = "source.assessment data";
  requireObject(data, label);
  assertOnlyFields(data, [
    "version", "source", "sourceKey", "sourceVersion", "purpose", "summary",
    "changeReason", "evidenceReviewed", "findings", "usableRanges", "limitations",
    "openQuestions", "reviewCoverage", "referenceNotes"
  ], label);
  const findings = data.findings;
  if (!Array.isArray(findings)) throw new IntelligenceValidationError(label + ".findings must be an array.");
  const normalizedFindings = findings.map((finding, index) => {
    const itemLabel = label + ".findings[" + index + "]";
    requireObject(finding, itemLabel);
    assertOnlyFields(finding, ["id", "statement", "basis", "evidence", "certainty", "reason"], itemLabel);
    const basis = requireText(finding.basis, itemLabel + ".basis");
    const certainty = requireText(finding.certainty, itemLabel + ".certainty");
    if (!["observation", "inference"].includes(basis)) throw new IntelligenceValidationError(itemLabel + ".basis is unsupported.");
    if (!["high", "medium", "low", "unknown"].includes(certainty)) throw new IntelligenceValidationError(itemLabel + ".certainty is unsupported.");
    return {
      id: requireId(finding.id, itemLabel + ".id"),
      statement: requireText(finding.statement, itemLabel + ".statement"),
      basis,
      evidence: evidencePointers(finding.evidence, itemLabel + ".evidence"),
      certainty,
      reason: requireText(finding.reason, itemLabel + ".reason")
    };
  });
  if (new Set(normalizedFindings.map((finding) => finding.id)).size !== normalizedFindings.length) {
    throw new IntelligenceValidationError(label + ".findings IDs must be unique.");
  }
  const usableRanges = data.usableRanges ?? [];
  if (!Array.isArray(usableRanges)) throw new IntelligenceValidationError(label + ".usableRanges must be an array.");
  return {
    ...sourceIdentity(data, label),
    purpose: requireText(data.purpose, label + ".purpose"),
    summary: requireText(data.summary, label + ".summary"),
    changeReason: requireText(data.changeReason, label + ".changeReason"),
    evidenceReviewed: reviewedEvidence(data.evidenceReviewed ?? [], label + ".evidenceReviewed"),
    findings: normalizedFindings,
    usableRanges: usableRanges.map((entry, index) => {
      const itemLabel = label + ".usableRanges[" + index + "]";
      requireObject(entry, itemLabel);
      assertOnlyFields(entry, ["startSeconds", "endSeconds", "intendedUse", "reason", "evidence"], itemLabel);
      return {
        ...normalizeTimeRange({ startSeconds: entry.startSeconds, endSeconds: entry.endSeconds }, itemLabel, { nullable: false }),
        intendedUse: requireText(entry.intendedUse, itemLabel + ".intendedUse"),
        reason: requireText(entry.reason, itemLabel + ".reason"),
        evidence: evidencePointers(entry.evidence, itemLabel + ".evidence")
      };
    }),
    limitations: normalizeStringList(data.limitations, label + ".limitations"),
    openQuestions: normalizeStringList(data.openQuestions, label + ".openQuestions"),
    reviewCoverage: normalizeCoverage(data.reviewCoverage),
    ...(data.referenceNotes === undefined ? {} : { referenceNotes: structuredClone(requireObject(data.referenceNotes, label + ".referenceNotes")) })
  };
}

function normalizeTranscriptEdit(data) {
  const label = "source.transcript-edit data";
  requireObject(data, label);
  assertOnlyFields(data, [
    "version", "source", "sourceKey", "sourceVersion", "baseResultIds",
    "corrections", "evidenceReviewed", "changeReason"
  ], label);
  const baseResultIds = normalizeStringList(data.baseResultIds, label + ".baseResultIds", { allowEmpty: false });
  if (!Array.isArray(data.corrections) || data.corrections.length === 0) {
    throw new IntelligenceValidationError(label + ".corrections must be a non-empty array.");
  }
  const corrections = data.corrections.map((entry, index) => {
    const itemLabel = label + ".corrections[" + index + "]";
    requireObject(entry, itemLabel);
    assertOnlyFields(entry, ["segmentId", "originalText", "correctedText", "reason", "timing", "evidence"], itemLabel);
    return {
      segmentId: requireId(entry.segmentId, itemLabel + ".segmentId"),
      originalText: requireText(entry.originalText, itemLabel + ".originalText"),
      correctedText: requireText(entry.correctedText, itemLabel + ".correctedText"),
      reason: requireText(entry.reason, itemLabel + ".reason"),
      ...(entry.timing === undefined ? {} : { timing: normalizeTimeRange(entry.timing, itemLabel + ".timing", { nullable: false }) }),
      evidence: evidencePointers(entry.evidence, itemLabel + ".evidence")
    };
  });
  if (new Set(corrections.map((entry) => entry.segmentId)).size !== corrections.length) {
    throw new IntelligenceValidationError(label + ".corrections must not repeat segmentId.");
  }
  return {
    ...sourceIdentity(data, label),
    baseResultIds,
    corrections,
    evidenceReviewed: reviewedEvidence(data.evidenceReviewed ?? [], label + ".evidenceReviewed"),
    changeReason: requireText(data.changeReason, label + ".changeReason")
  };
}

export function normalizeSourceArtifactData(type, data) {
  if (type === SOURCE_PROFILE_TYPE) return normalizeProfile(data);
  if (type === SOURCE_ASSESSMENT_TYPE) return normalizeAssessment(data);
  if (type === TRANSCRIPT_EDIT_TYPE) return normalizeTranscriptEdit(data);
  return null;
}

function allPointers(type, data) {
  if (type === SOURCE_PROFILE_TYPE) return [];
  if (type === SOURCE_ASSESSMENT_TYPE) {
    return [
      ...data.evidenceReviewed,
      ...data.findings.flatMap((entry) => entry.evidence),
      ...data.usableRanges.flatMap((entry) => entry.evidence)
    ];
  }
  return [
    ...data.evidenceReviewed,
    ...data.corrections.flatMap((entry) => entry.evidence)
  ];
}

function claimPointers(type, data) {
  if (type === SOURCE_PROFILE_TYPE) return [];
  if (type === SOURCE_ASSESSMENT_TYPE) {
    return [
      ...data.findings.flatMap((entry) => entry.evidence),
      ...data.usableRanges.flatMap((entry) => entry.evidence)
    ];
  }
  return data.corrections.flatMap((entry) => entry.evidence);
}

function reviewedCovers(pointer, reviewed) {
  if (pointer.resultId !== reviewed.resultId) return false;
  if (pointer.itemId) {
    return reviewed.itemId === pointer.itemId || Boolean(pointer.range && reviewed.range && rangeWithin(pointer.range, reviewed.range));
  }
  if (pointer.fileId) return reviewed.fileId === pointer.fileId;
  if (pointer.range) return Boolean(reviewed.range && rangeWithin(pointer.range, reviewed.range));
  return true;
}

function rangeWithin(inner, outer) {
  if (!inner || !outer || outer.startSeconds === undefined || outer.endSeconds === undefined) return true;
  return inner.startSeconds >= outer.startSeconds && inner.endSeconds <= outer.endSeconds;
}

async function datasetItems(projectStore, projectId, result, wantedIds) {
  const found = new Map();
  for (const dataset of result.data.datasets) {
    const file = await projectStore.resolveResultFile(projectId, result.id, dataset.fileId);
    if (file.sha256 && await sha256File(file.filePath) !== file.sha256) {
      throw new IntelligenceValidationError("Evidence dataset checksum does not match Result metadata.");
    }
    const lines = createInterface({ input: createReadStream(file.filePath, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { throw new IntelligenceValidationError("Evidence dataset contains invalid JSONL."); }
      if (wantedIds.has(row?.id)) found.set(row.id, row);
    }
  }
  return found;
}

export async function validateSourceArtifactAgainstProject({
  projectStore, projectId, type, data, references, status = "active"
}) {
  if (!SOURCE_ARTIFACT_TYPES.has(type) || status === "retired") return;
  const current = await resolveAnalysisSource({ store: projectStore, projectId, source: data.source });
  if (current.sourceKey !== data.sourceKey) throw new IntelligenceValidationError("Artifact sourceKey does not match its source reference.");
  if (type === SOURCE_PROFILE_TYPE && current.sourceVersion !== data.sourceVersion) {
    throw new IntelligenceValidationError("Source profile sourceVersion is stale.");
  }
  const requiredReferences = new Set([data.source.kind + ":" + data.source.id]);
  const results = new Map();
  const pointers = allPointers(type, data);
  for (const resultId of [...new Set([
    ...pointers.map((pointer) => pointer.resultId),
    ...(type === TRANSCRIPT_EDIT_TYPE ? data.baseResultIds : [])
  ])]) {
    const result = await projectStore.readResult(projectId, resultId);
    if (!result.data || result.data.sourceKey !== data.sourceKey || result.data.sourceVersion !== data.sourceVersion) {
      throw new IntelligenceValidationError("Evidence Result does not match the artifact source/version: " + resultId + ".");
    }
    results.set(resultId, result);
    requiredReferences.add("result:" + resultId);
  }
  const wantedByResult = new Map();
  for (const pointer of pointers) {
    if (!pointer.itemId) continue;
    const wanted = wantedByResult.get(pointer.resultId) ?? new Set();
    wanted.add(pointer.itemId);
    wantedByResult.set(pointer.resultId, wanted);
  }
  if (type === TRANSCRIPT_EDIT_TYPE) {
    for (const resultId of data.baseResultIds) {
      const wanted = wantedByResult.get(resultId) ?? new Set();
      for (const correction of data.corrections) wanted.add(correction.segmentId);
      wantedByResult.set(resultId, wanted);
    }
  }
  const itemCache = new Map();
  for (const [resultId, wanted] of wantedByResult) {
    itemCache.set(resultId, await datasetItems(projectStore, projectId, results.get(resultId), wanted));
  }
  for (const pointer of pointers) {
    const result = results.get(pointer.resultId);
    if (pointer.fileId && !result.files.some((file) => file.id === pointer.fileId)) {
      throw new IntelligenceValidationError("Evidence file does not exist: " + pointer.resultId + "/" + pointer.fileId + ".");
    }
    if (!rangeWithin(pointer.range, result.data.coverage)) {
      throw new IntelligenceValidationError("Evidence range is outside Result coverage: " + pointer.resultId + ".");
    }
    if (pointer.itemId) {
      const key = pointer.resultId + ":" + pointer.itemId;
      if (!itemCache.get(pointer.resultId)?.has(pointer.itemId)) {
        throw new IntelligenceValidationError("Evidence item does not exist: " + key + ".");
      }
    }
  }
  for (const pointer of claimPointers(type, data)) {
    if (!data.evidenceReviewed.some((reviewed) => reviewedCovers(pointer, reviewed))) {
      throw new IntelligenceValidationError("A finding, usable range, or correction cites evidence that was not reviewed.");
    }
  }
  if (type === TRANSCRIPT_EDIT_TYPE) {
    for (const resultId of data.baseResultIds) {
      if (results.get(resultId).type !== "source.transcript") {
        throw new IntelligenceValidationError("Transcript edit base Result must be source.transcript.");
      }
    }
    for (const correction of data.corrections) {
      let raw = null;
      let baseResultId = null;
      for (const resultId of data.baseResultIds) {
        raw = itemCache.get(resultId)?.get(correction.segmentId) ?? null;
        if (raw) {
          baseResultId = resultId;
          break;
        }
      }
      if (!raw) throw new IntelligenceValidationError("Correction targets an unknown transcript segment: " + correction.segmentId + ".");
      if (raw.text !== correction.originalText) throw new IntelligenceValidationError("Correction originalText does not match raw transcript.");
      if (correction.timing && !rangeWithin(correction.timing, results.get(baseResultId).data.coverage)) {
        throw new IntelligenceValidationError("Corrected timing must remain within source coverage.");
      }
      if (!correction.evidence.some((pointer) => pointer.resultId === baseResultId)) {
        throw new IntelligenceValidationError("Correction evidence must reference its base transcript Result.");
      }
      const listened = data.evidenceReviewed.some((entry) =>
        entry.action === "listened" && entry.resultId === baseResultId &&
        (!entry.itemId || entry.itemId === correction.segmentId)
      );
      if (!listened) {
        throw new IntelligenceValidationError("Each correction requires listened evidence for its base transcript segment.");
      }
    }
  }
  const supplied = new Set(references.map((reference) => reference.kind + ":" + reference.id));
  const missing = [...requiredReferences].filter((key) => !supplied.has(key));
  if (missing.length) throw new IntelligenceValidationError("Artifact top-level references are missing: " + missing.join(", ") + ".");
}
