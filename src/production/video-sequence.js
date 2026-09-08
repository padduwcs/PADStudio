import { createHash } from "node:crypto";
import { assertOnlyFields, requireObject, requireText, requireId, normalizeReferences, IntelligenceValidationError } from "../intelligence/contracts.js";

export const SEQUENCE_TYPE = "video.sequence";
function number(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new IntelligenceValidationError(label + " must be between " + min + " and " + max + ".");
  return value;
}
export function normalizeMediaReference(value, label) {
  requireObject(value, label);
  if (!["resource", "result"].includes(value.kind)) throw new IntelligenceValidationError(label + ".kind must be resource or result.");
  assertOnlyFields(value, value.kind === "resource" ? ["kind", "id", "itemPath"] : ["kind", "id", "file"], label);
  return { kind: value.kind, id: requireId(value.id, label + ".id"),
    ...(value.kind === "resource" ? { itemPath: value.itemPath == null ? null : requireText(value.itemPath, label + ".itemPath") } : { file: requireText(value.file ?? "primary", label + ".file") }) };
}
export function normalizeSequence(value) {
  requireObject(value, "sequence");
  assertOnlyFields(value, ["version", "changeReason", "format", "segments"], "sequence");
  if (value.version !== "1.0") throw new IntelligenceValidationError("Unsupported video.sequence version.");
  const format = requireObject(value.format, "sequence.format");
  assertOnlyFields(format, ["width", "height", "fps"], "sequence.format");
  for (const field of ["width", "height"]) {
    number(format[field], field, 64, 3840);
    if (!Number.isInteger(format[field]) || format[field] % 2) throw new IntelligenceValidationError(field + " must be an even integer.");
  }
  number(format.fps, "fps", 1, 60);
  if (!Number.isInteger(format.fps)) throw new IntelligenceValidationError("fps must be an integer.");
  if (!Array.isArray(value.segments) || !value.segments.length || value.segments.length > 100) throw new IntelligenceValidationError("sequence.segments must contain 1-100 segments.");
  const segments = value.segments.map((entry, index) => {
    const label = "segments[" + index + "]";
    requireObject(entry, label);
    assertOnlyFields(entry, ["id", "title", "intent", "durationSeconds", "visual", "narration", "captions", "references"], label);
    const durationSeconds = number(entry.durationSeconds, label + ".durationSeconds", 0.1, 600);
    if (Math.abs(durationSeconds * format.fps - Math.round(durationSeconds * format.fps)) > 1e-6) throw new IntelligenceValidationError(label + ".durationSeconds must align to an output frame.");
    let visual = null;
    if (entry.visual != null) {
      requireObject(entry.visual, label + ".visual");
      assertOnlyFields(entry.visual, ["source", "startSeconds", "volume"], label + ".visual");
      visual = { source: normalizeMediaReference(entry.visual.source, label + ".visual.source"),
        startSeconds: number(entry.visual.startSeconds ?? 0, "visual.startSeconds", 0, 86400),
        volume: number(entry.visual.volume ?? 1, "visual.volume", 0, 2) };
    }
    let narration = null;
    if (entry.narration != null) {
      requireObject(entry.narration, label + ".narration");
      assertOnlyFields(entry.narration, ["text", "source", "startSeconds", "volume"], label + ".narration");
      narration = { text: requireText(entry.narration.text, label + ".narration.text"),
        source: entry.narration.source == null ? null : normalizeMediaReference(entry.narration.source, label + ".narration.source"),
        startSeconds: number(entry.narration.startSeconds ?? 0, "narration.startSeconds", 0, 86400),
        volume: number(entry.narration.volume ?? 1, "narration.volume", 0, 2) };
    }
    const captions = entry.captions ?? [];
    if (!Array.isArray(captions) || captions.length > 1000) throw new IntelligenceValidationError(label + ".captions must be an array (max 1000).");
    let previousEnd = 0;
    const normalizedCaptions = captions.map((cue) => {
      requireObject(cue, "caption");
      assertOnlyFields(cue, ["text", "startSeconds", "endSeconds"], "caption");
      const text = requireText(cue.text, "caption.text");
      if (text.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new IntelligenceValidationError("Invalid caption text.");
      const startSeconds = number(cue.startSeconds, "caption.startSeconds", previousEnd, durationSeconds);
      const endSeconds = number(cue.endSeconds, "caption.endSeconds", startSeconds, durationSeconds);
      if (endSeconds <= startSeconds) throw new IntelligenceValidationError("Caption must have positive duration.");
      previousEnd = endSeconds;
      return { text, startSeconds, endSeconds };
    });
    return { id: requireId(entry.id, label + ".id"), title: requireText(entry.title, label + ".title"), intent: requireText(entry.intent, label + ".intent"),
      durationSeconds, visual, narration, captions: normalizedCaptions, references: normalizeReferences(entry.references) };
  });
  if (new Set(segments.map((s) => s.id)).size !== segments.length) throw new IntelligenceValidationError("Segment IDs must be unique.");
  if (segments.reduce((sum, s) => sum + s.durationSeconds, 0) > 3600) throw new IntelligenceValidationError("Sequence exceeds one hour.");
  return { version: "1.0", changeReason: requireText(value.changeReason, "sequence.changeReason"),
    format: { width: format.width, height: format.height, fps: format.fps }, segments };
}
export function sequenceReferences(sequence) {
  const refs = sequence.segments.flatMap((s) => [...s.references,
    ...[s.visual?.source, s.narration?.source].filter(Boolean).map(({ kind, id }) => ({ kind, id }))]);
  return [...new Map(refs.map((ref) => [ref.kind + ":" + ref.id, ref])).values()];
}
export function segmentFingerprint(segment, format) {
  // Creative meaning and evidence participate too: reuse is conservative.
  return createHash("sha256").update(JSON.stringify({ segment, format })).digest("hex");
}
export function compareSequences(before, after) {
  const old = new Map((before?.segments ?? []).map((s, index) => [s.id, { s, index }]));
  const current = new Set(after.segments.map((s) => s.id));
  return {
    formatChanged: Boolean(before && JSON.stringify(before.format) !== JSON.stringify(after.format)),
    segments: after.segments.map((segment, index) => {
      const previous = old.get(segment.id);
      return { id: segment.id, status: !previous ? "added" : segmentFingerprint(previous.s, before.format) !== segmentFingerprint(segment, after.format) ? "changed" : "unchanged",
        moved: Boolean(previous && previous.index !== index) };
    }),
    removed: [...old.keys()].filter((id) => !current.has(id)),
  };
}
