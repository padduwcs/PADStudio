/*
 * Evidence about whether a rendered animation behaves the way its narration cue map planned it.
 *
 * Everything here is deliberately mechanical and explainable. It measures *when pixels change* and, when
 * a transcript is supplied, *when words are spoken*. It cannot know what moved or whether the motion means
 * the right thing, so it never produces a creative verdict: only per-cue observations and the thresholds used.
 */

export const SYNC_ANALYSIS_VERSION = "1.0";
export const DEFAULT_TOLERANCE_SECONDS = 0.35;
export const MOTION_FLOOR = 0.03;

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Parse `signalstats` + `metadata=print:key=lavfi.signalstats.YDIF` output into a per-frame series.
 * YDIF is the mean absolute luma difference from the previous frame (0 for the first frame).
 */
export function parseMotionSeries(output) {
  const series = [];
  const pattern = /frame:(\d+)\s+pts:-?\d+\s+pts_time:(-?[\d.]+(?:e-?\d+)?)\s*\r?\n\s*lavfi\.signalstats\.YDIF=([\d.]+(?:e-?\d+)?)/gi;
  for (const match of String(output ?? "").matchAll(pattern)) {
    const seconds = Number(match[2]);
    const value = Number(match[3]);
    if (Number.isFinite(seconds) && Number.isFinite(value)) series.push({ frame: Number(match[1]), seconds, value });
  }
  return series;
}

/** Motion level above which a frame counts as "something changed": a multiple of the video's own noise floor. */
export function motionThreshold(series) {
  const noiseFloor = median(series.slice(1).map((point) => point.value));
  return { noiseFloor: round(noiseFloor, 5), threshold: round(Math.max(MOTION_FLOOR, noiseFloor * 4), 5) };
}

function firstActive(series, from, to, threshold) {
  return series.find((point) => point.seconds >= from - 1e-9 && point.seconds <= to + 1e-9 && point.value >= threshold) ?? null;
}

function observeAction({ cue, action, series, threshold, tolerance, durationSeconds }) {
  const planned = action.startSeconds;
  const searchStart = Math.max(0, planned - tolerance);
  const lateLimit = Math.min(durationSeconds, Math.max(cue.endSeconds, planned + tolerance));
  const inWindow = series.filter((point) => point.seconds >= searchStart - 1e-9 && point.seconds <= lateLimit + 1e-9);
  const peak = inWindow.reduce((best, point) => (point.value > (best?.value ?? -1) ? point : best), null);
  const onset = firstActive(series, searchStart, lateLimit, threshold);
  const before = series.filter((point) => point.seconds < searchStart - 1e-9).at(-1) ?? null;
  const base = {
    plannedActionStartSeconds: round(planned),
    peakMotion: peak ? round(peak.value, 4) : null,
    peakSeconds: peak ? round(peak.seconds) : null
  };
  if (!onset) return { ...base, status: "no_visible_change", onsetSeconds: null, offsetSeconds: null };
  // Motion that was already running when the window opened cannot be attributed to this action.
  if (before && before.value >= threshold && onset === inWindow[0]) {
    return { ...base, status: "ambiguous_ongoing_motion", onsetSeconds: round(onset.seconds), offsetSeconds: null };
  }
  const offset = onset.seconds - planned;
  return {
    ...base,
    status: offset > tolerance ? "late" : "aligned",
    onsetSeconds: round(onset.seconds),
    offsetSeconds: round(offset)
  };
}

function observeHold({ cue, series, threshold }) {
  const frames = series.filter((point) => point.seconds >= cue.startSeconds - 1e-9 && point.seconds < cue.endSeconds - 1e-9);
  if (!frames.length) return { status: "not_measured", activeShare: null, medianMotion: null };
  const active = frames.filter((point) => point.value >= threshold).length / frames.length;
  return {
    status: active <= 0.2 ? "held" : "moving_during_hold",
    activeShare: round(active, 3),
    medianMotion: round(median(frames.map((point) => point.value)), 4)
  };
}

function observeSpeech({ cue, words, tolerance }) {
  if (!words) return { status: "not_measured", wordCount: null, onsetSeconds: null, offsetSeconds: null };
  const overlapping = words.filter((word) => word.endSeconds > cue.startSeconds && word.startSeconds < cue.endSeconds);
  if (!overlapping.length) return { status: "absent", wordCount: 0, onsetSeconds: null, offsetSeconds: null };
  const onset = Math.min(...overlapping.map((word) => word.startSeconds));
  const offset = onset - cue.startSeconds;
  return {
    status: Math.abs(offset) <= tolerance ? "on_cue" : offset > 0 ? "late_voice" : "early_voice",
    wordCount: overlapping.length,
    onsetSeconds: round(onset),
    offsetSeconds: round(offset)
  };
}

/**
 * Compare a normalized choreography's narration cue map with a motion series (and optionally transcript words).
 * `choreography` must be the output of normalizeVisualChoreography and contain a narrationCueMap.
 */
export function analyzeNarrationSync({
  choreography, series, words = null, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS, durationSeconds
}) {
  const map = choreography?.narrationCueMap;
  if (!map) throw new Error("The choreography has no narrationCueMap to verify.");
  if (!Array.isArray(series) || series.length < 2) throw new Error("A motion series with at least two frames is required.");
  const fps = choreography.fps;
  const tolerance = Math.max(toleranceSeconds, 2 / fps);
  const noise = motionThreshold(series);
  const beatById = new Map(choreography.beats.map((beat) => [beat.id, beat]));

  const cues = map.cues.map((cue) => {
    const beat = beatById.get(cue.beatId);
    const action = cue.actionId ? beat?.actions.find((candidate) => candidate.id === cue.actionId) : null;
    const visual = cue.actionId
      ? observeAction({ cue, action, series, threshold: noise.threshold, tolerance, durationSeconds })
      : { kind: "hold", reason: cue.holdReason, ...observeHold({ cue, series, threshold: noise.threshold }) };
    return {
      id: cue.id,
      beatId: cue.beatId,
      actionId: cue.actionId,
      cueStartSeconds: cue.startSeconds,
      cueEndSeconds: cue.endSeconds,
      kind: cue.actionId ? "action" : "hold",
      visual,
      speech: observeSpeech({ cue, words, tolerance })
    };
  });

  const count = (predicate) => cues.filter(predicate).length;
  return {
    version: SYNC_ANALYSIS_VERSION,
    toleranceSeconds: round(tolerance),
    motion: { ...noise, frames: series.length, metric: "mean absolute luma difference from the previous frame (signalstats YDIF, 160 px wide)" },
    transcriptSupplied: Boolean(words),
    summary: {
      cues: cues.length,
      actionCues: count((cue) => cue.kind === "action"),
      holdCues: count((cue) => cue.kind === "hold"),
      aligned: count((cue) => cue.visual.status === "aligned"),
      late: count((cue) => cue.visual.status === "late"),
      noVisibleChange: count((cue) => cue.visual.status === "no_visible_change"),
      ambiguousOngoingMotion: count((cue) => cue.visual.status === "ambiguous_ongoing_motion"),
      held: count((cue) => cue.visual.status === "held"),
      movingDuringHold: count((cue) => cue.visual.status === "moving_during_hold"),
      speechOnCue: count((cue) => cue.speech.status === "on_cue"),
      speechOffCue: count((cue) => ["late_voice", "early_voice", "absent"].includes(cue.speech.status))
    },
    cues,
    limits: [
      "Measures when pixels change, not what changed or whether it explains the narration.",
      "A visual response is 'aligned' when the first frame above the motion threshold falls within the tolerance of the planned action start.",
      "Subtle or slow changes (a small highlight, a gentle fade) can stay below the motion threshold, so a cue reported as late or no_visible_change must be checked in a preview before it is treated as a defect; peakMotion shows how much changed in the window.",
      "Speech timing needs a supplied transcript; without one speech is reported as not_measured.",
      "This is evidence for review, not a creative verdict; watch and listen to the exact render."
    ]
  };
}
