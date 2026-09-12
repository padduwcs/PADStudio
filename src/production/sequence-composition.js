import { assertOnlyFields, requireObject, requireText, IntelligenceValidationError } from "../intelligence/contracts.js";

const fail = (message) => { throw new IntelligenceValidationError(message); };
const n = (value, label, min, max) => {
  if (!Number.isFinite(value) || value < min || value > max) fail(`${label} must be between ${min} and ${max}.`);
  return value;
};
function choice(value, allowed, label) {
  if (!allowed.includes(value)) fail(`Unsupported ${label}.`);
  return value;
}
function object(value, keys, label) {
  requireObject(value, label); assertOnlyFields(value, keys, label); return value;
}
export function normalizeAnimation(value, duration) {
  if (value == null) return null;
  object(value, ["enter", "exit", "durationSeconds"], "animation");
  return { enter: choice(value.enter ?? "none", ["none", "fade", "slideLeft", "slideUp"], "animation.enter"),
    exit: choice(value.exit ?? "none", ["none", "fade"], "animation.exit"),
    durationSeconds: n(value.durationSeconds ?? 0.3, "animation duration", 0.01, duration / 2) };
}
export function normalizeTextStyle(value = {}) {
  object(value, ["font", "fontSize", "bold", "color", "background", "outline", "position", "margin", "lineSpacing"], "text style");
  const color = (v) => { if (!/^#[0-9a-f]{6}$/i.test(v)) fail("Style color must be #RRGGBB."); return v; };
  if (value.bold !== undefined && typeof value.bold !== "boolean") fail("style.bold must be boolean.");
  return { font: choice(value.font ?? "Arial", ["Arial", "Segoe UI", "Tahoma", "Verdana"], "font"),
    fontSize: n(value.fontSize ?? 48, "fontSize", 12, 240), bold: value.bold ?? false,
    color: color(value.color ?? "#FFFFFF"), background: value.background == null ? null : color(value.background),
    outline: n(value.outline ?? 2, "outline", 0, 10),
    position: choice(value.position ?? "bottom", ["top", "center", "bottom"], "text position"),
    margin: n(value.margin ?? 0.06, "safe margin", 0.02, 0.25),
    lineSpacing: n(value.lineSpacing ?? 1.2, "lineSpacing", 1, 2) };
}
export function normalizeSegmentComposition(raw, segment, reference, defaultStyle) {
  const d = segment.durationSeconds;
  if (segment.visual) {
    segment.visual.fit = choice(raw.visual.fit ?? "pad", ["pad", "crop"], "visual.fit");
    segment.visual.motion = choice(raw.visual.motion ?? "none", ["none", "zoomIn", "zoomOut", "panLeft", "panRight"], "visual.motion");
    segment.visual.fadeInSeconds = n(raw.visual.fadeInSeconds ?? 0, "source fade in", 0, d / 2);
    segment.visual.fadeOutSeconds = n(raw.visual.fadeOutSeconds ?? 0, "source fade out", 0, d / 2);
    const ranges = raw.visual.volumeRanges ?? [];
    if (!Array.isArray(ranges) || ranges.length > 100) fail("volumeRanges must contain at most 100 ranges.");
    let end = 0;
    segment.visual.volumeRanges = ranges.map((v) => {
      object(v, ["startSeconds", "endSeconds", "volume"], "volume range");
      const startSeconds = n(v.startSeconds, "volume range start", end, d);
      end = n(v.endSeconds, "volume range end", startSeconds, d);
      if (end <= startSeconds) fail("Empty volume range.");
      return { startSeconds, endSeconds: end, volume: n(v.volume, "volume", 0, 2) };
    });
  }
  if (segment.narration) {
    const r = raw.narration;
    const offset = n(r.offsetSeconds ?? 0, "narration offset", 0, d);
    const duration = r.durationSeconds == null ? null : n(r.durationSeconds, "narration duration", 0.01, d - offset);
    segment.narration = { ...segment.narration, offsetSeconds: offset, durationSeconds: duration,
      fadeInSeconds: n(r.fadeInSeconds ?? 0, "narration fade in", 0, (duration ?? (d - offset)) / 2),
      fadeOutSeconds: n(r.fadeOutSeconds ?? 0, "narration fade out", 0, (duration ?? (d - offset)) / 2) };
    if (offset >= d) fail("Narration starts outside segment.");
  }
  segment.captions = segment.captions.map((c, i) => ({ ...c,
    style: normalizeTextStyle({ ...defaultStyle, ...(raw.captions[i].style ?? {}) }),
    animation: normalizeAnimation(raw.captions[i].animation, c.endSeconds - c.startSeconds) }));
  const overlays = raw.overlays ?? [];
  if (!Array.isArray(overlays) || overlays.length > 8) fail("At most eight overlays per segment.");
  segment.overlays = overlays.map((o) => {
    object(o, ["id", "source", "sourceStartSeconds", "startSeconds", "endSeconds", "x", "y", "width", "height", "fit", "animation"], "overlay");
    const start = n(o.startSeconds, "overlay start", 0, d);
    const end = n(o.endSeconds, "overlay end", start, d);
    if (end <= start) fail("Empty overlay.");
    const width = n(o.width, "overlay width", 0.02, 1), height = n(o.height, "overlay height", 0.02, 1);
    return { id: requireText(o.id, "overlay.id"), source: reference(o.source, "overlay.source"),
      sourceStartSeconds: n(o.sourceStartSeconds ?? 0, "overlay source start", 0, 86400),
      startSeconds: start, endSeconds: end, width, height,
      x: n(o.x, "overlay x", 0, 1 - width), y: n(o.y, "overlay y", 0, 1 - height),
      fit: choice(o.fit ?? "pad", ["pad", "crop"], "overlay fit"), animation: normalizeAnimation(o.animation, end - start) };
  });
  if (new Set(segment.overlays.map((o) => o.id)).size !== segment.overlays.length) fail("Overlay IDs must be unique.");
  const transition = raw.transition ?? { type: "cut" };
  object(transition, ["type", "durationSeconds"], "transition");
  const type = choice(transition.type, ["cut", "crossfade", "fadeBlack"], "transition");
  segment.transition = { type, durationSeconds: type === "cut" ? n(transition.durationSeconds ?? 0, "cut duration", 0, 0) : n(transition.durationSeconds, "transition duration", 0.05, d / 2) };
  return segment;
}
export function normalizeSequenceComposition(raw, sequence, reference) {
  for (let i = 0; i < sequence.segments.length; i++) {
    const t = sequence.segments[i].transition;
    if (i === sequence.segments.length - 1 && t.type !== "cut") fail("Last segment cannot have outgoing transition.");
    if (t.durationSeconds && (t.durationSeconds > sequence.segments[i + 1].durationSeconds / 2 ||
      Math.abs(t.durationSeconds * sequence.format.fps - Math.round(t.durationSeconds * sequence.format.fps)) > 1e-6)) fail("Transition must fit adjacent segments and align to frames.");
  }
  const duration = sequenceDuration(sequence);
  const music = raw.music ?? [];
  if (!Array.isArray(music) || music.length > 4) fail("At most four music tracks.");
  sequence.music = music.map((m) => {
    object(m, ["id", "source", "sourceStartSeconds", "startSeconds", "durationSeconds", "volume", "fadeInSeconds", "fadeOutSeconds", "loop", "ducking"], "music");
    const start = n(m.startSeconds ?? 0, "music start", 0, duration);
    const length = n(m.durationSeconds ?? duration - start, "music duration", 0.01, duration - start);
    for (const key of ["loop", "ducking"]) if (m[key] !== undefined && typeof m[key] !== "boolean") fail(`music.${key} must be boolean.`);
    return { id: requireText(m.id, "music.id"), source: reference(m.source, "music.source"),
      sourceStartSeconds: n(m.sourceStartSeconds ?? 0, "music source start", 0, 86400), startSeconds: start, durationSeconds: length,
      volume: n(m.volume ?? 0.2, "music volume", 0, 2), fadeInSeconds: n(m.fadeInSeconds ?? 0, "music fade in", 0, length / 2),
      fadeOutSeconds: n(m.fadeOutSeconds ?? 0, "music fade out", 0, length / 2), loop: m.loop ?? false, ducking: m.ducking ?? false };
  });
  if (new Set(sequence.music.map((m) => m.id)).size !== sequence.music.length) fail("Music IDs must be unique.");
  object(raw.audio ?? {}, ["loudnessTargetLufs"], "audio");
  sequence.audio = { loudnessTargetLufs: raw.audio?.loudnessTargetLufs == null ? null : n(raw.audio.loudnessTargetLufs, "loudness target", -30, -10) };
  sequence.captionStyle = normalizeTextStyle(raw.captionStyle ?? {});
  return sequence;
}
export function segmentMediaSources(segment) {
  return [segment.visual?.source, segment.narration?.source, ...(segment.overlays ?? []).map((o) => o.source)].filter(Boolean);
}
export function sequenceDuration(sequence) {
  return sequence.segments.reduce((sum, s) => sum + s.durationSeconds - (s.transition?.durationSeconds ?? 0), 0);
}
export function compositionTimeline(sequence) {
  const rows = [];
  let start = 0;
  for (const s of sequence.segments) {
    rows.push({ track: "Hình", label: s.title, startSeconds: start, endSeconds: start + s.durationSeconds, segmentId: s.id });
    if (s.narration) rows.push({ track: "Lời đọc", label: s.narration.text, startSeconds: start + (s.narration.offsetSeconds ?? 0), endSeconds: start + (s.narration.offsetSeconds ?? 0) + (s.narration.durationSeconds ?? (s.durationSeconds - (s.narration.offsetSeconds ?? 0))), estimatedEnd: s.narration.durationSeconds == null });
    for (const c of s.captions) rows.push({ track: "Chữ", label: c.text, startSeconds: start + c.startSeconds, endSeconds: start + c.endSeconds });
    for (const o of s.overlays ?? []) rows.push({ track: "Lớp phủ " + o.id, label: o.id, startSeconds: start + o.startSeconds, endSeconds: start + o.endSeconds });
    for (const r of s.visual?.volumeRanges ?? []) rows.push({ track: "Tiếng gốc", label: "Volume " + r.volume, startSeconds: start + r.startSeconds, endSeconds: start + r.endSeconds });
    if (s.transition?.durationSeconds) rows.push({ track: "Chuyển cảnh", label: s.transition.type, startSeconds: start + s.durationSeconds - s.transition.durationSeconds, endSeconds: start + s.durationSeconds });
    start += s.durationSeconds - (s.transition?.durationSeconds ?? 0);
  }
  for (const m of sequence.music ?? []) rows.push({ track: "Nhạc " + m.id, label: m.ducking ? "Nhạc · ducking" : "Nhạc", startSeconds: m.startSeconds, endSeconds: m.startSeconds + m.durationSeconds });
  return rows;
}
