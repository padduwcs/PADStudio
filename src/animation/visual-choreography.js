import {
  IntelligenceValidationError,
  assertOnlyFields,
  normalizeStringList,
  requireId,
  requireObject,
  requireText,
} from "../intelligence/contracts.js";

export const ANIMATION_CHOREOGRAPHY_TYPE = "animation.choreography";

const OBJECT_ROLES = new Set(["subject", "context", "evidence", "annotation"]);
const CONTINUITIES = new Set(["persistent", "beat-local"]);
const BEAT_KINDS = new Set(["semantic", "support", "transition"]);
const ACTION_MEANINGS = new Set(["semantic", "support", "transition"]);
const ACTION_VERBS = new Set([
  "introduce", "reveal", "highlight", "select", "traverse", "accumulate", "transform",
  "compare", "connect", "move", "calculate", "substitute", "annotate", "clear", "hold", "other",
]);

function fail(message) {
  throw new IntelligenceValidationError(message);
}

function finite(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function choice(value, allowed, label) {
  if (!allowed.has(value)) fail(`${label} is not supported: ${value}.`);
  return value;
}

function optionalText(value, label) {
  return value == null ? null : requireText(value, label);
}

function idList(value, label, knownIds, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 100) {
    fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array with at most 100 items.`);
  }
  const result = value.map((entry, index) => requireId(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates.`);
  const unknown = result.filter((id) => !knownIds.has(id));
  if (unknown.length) fail(`${label} references unknown objects: ${unknown.join(", ")}.`);
  return result;
}

function frameAligned(value, fps, label) {
  if (Math.abs(value * fps - Math.round(value * fps)) > 1e-6) {
    fail(`${label} must align to the choreography frame rate.`);
  }
  return value;
}

export function normalizeVisualChoreography(value) {
  requireObject(value, "animation.choreography data");
  assertOnlyFields(value, [
    "version", "changeReason", "purpose", "durationSeconds", "fps", "objects", "beats", "reviewCriteria",
  ], "animation.choreography data");
  if (value.version !== "1.0") fail("animation.choreography version must be 1.0.");
  const fps = finite(value.fps, "animation.choreography.fps", 1, 60);
  if (!Number.isInteger(fps)) fail("animation.choreography.fps must be an integer.");
  const durationSeconds = frameAligned(
    finite(value.durationSeconds, "animation.choreography.durationSeconds", 0.1, 600),
    fps,
    "animation.choreography.durationSeconds",
  );
  if (!Array.isArray(value.objects) || value.objects.length === 0 || value.objects.length > 100) {
    fail("animation.choreography.objects must contain between 1 and 100 objects.");
  }
  const objects = value.objects.map((entry, index) => {
    const label = `animation.choreography.objects[${index}]`;
    requireObject(entry, label);
    assertOnlyFields(entry, ["id", "label", "role", "continuity", "initialState"], label);
    return {
      id: requireId(entry.id, `${label}.id`),
      label: requireText(entry.label, `${label}.label`),
      role: choice(entry.role, OBJECT_ROLES, `${label}.role`),
      continuity: choice(entry.continuity, CONTINUITIES, `${label}.continuity`),
      initialState: requireText(entry.initialState, `${label}.initialState`),
    };
  });
  const objectIds = new Set(objects.map((object) => object.id));
  if (objectIds.size !== objects.length) fail("animation.choreography object IDs must be unique.");
  if (!Array.isArray(value.beats) || value.beats.length === 0 || value.beats.length > 240) {
    fail("animation.choreography.beats must contain between 1 and 240 beats.");
  }
  let previousBeatEnd = 0;
  const knownBeatIds = new Set();
  const beats = value.beats.map((entry, index) => {
    const label = `animation.choreography.beats[${index}]`;
    requireObject(entry, label);
    assertOnlyFields(entry, [
      "id", "kind", "startSeconds", "endSeconds", "message", "narrationText", "visualPurpose",
      "primaryObjectId", "focusObjectIds", "stateBefore", "stateAfter", "actions", "holdAfterSeconds",
      "continuityFromBeatId", "reviewCriteria",
    ], label);
    const id = requireId(entry.id, `${label}.id`);
    if (knownBeatIds.has(id)) fail("animation.choreography beat IDs must be unique.");
    const startSeconds = frameAligned(finite(entry.startSeconds, `${label}.startSeconds`, previousBeatEnd, durationSeconds), fps, `${label}.startSeconds`);
    const endSeconds = frameAligned(finite(entry.endSeconds, `${label}.endSeconds`, startSeconds, durationSeconds), fps, `${label}.endSeconds`);
    if (endSeconds <= startSeconds) fail(`${label} must have positive duration.`);
    const kind = choice(entry.kind, BEAT_KINDS, `${label}.kind`);
    const primaryObjectId = requireId(entry.primaryObjectId, `${label}.primaryObjectId`);
    if (!objectIds.has(primaryObjectId)) fail(`${label}.primaryObjectId references an unknown object.`);
    const focusObjectIds = idList(entry.focusObjectIds, `${label}.focusObjectIds`, objectIds, { allowEmpty: false });
    if (!focusObjectIds.includes(primaryObjectId)) fail(`${label}.focusObjectIds must include primaryObjectId.`);
    if (!Array.isArray(entry.actions) || entry.actions.length === 0 || entry.actions.length > 40) {
      fail(`${label}.actions must contain between 1 and 40 actions.`);
    }
    const actionIds = new Set();
    let previousActionStart = startSeconds;
    const actions = entry.actions.map((action, actionIndex) => {
      const actionLabel = `${label}.actions[${actionIndex}]`;
      requireObject(action, actionLabel);
      assertOnlyFields(action, [
        "id", "startSeconds", "endSeconds", "verb", "meaning", "subjectIds", "targetIds", "description", "resultingState",
      ], actionLabel);
      const actionId = requireId(action.id, `${actionLabel}.id`);
      if (actionIds.has(actionId)) fail(`${label} action IDs must be unique.`);
      actionIds.add(actionId);
      const actionStart = frameAligned(finite(action.startSeconds, `${actionLabel}.startSeconds`, startSeconds, endSeconds), fps, `${actionLabel}.startSeconds`);
      const actionEnd = frameAligned(finite(action.endSeconds, `${actionLabel}.endSeconds`, actionStart, endSeconds), fps, `${actionLabel}.endSeconds`);
      if (actionEnd <= actionStart) fail(`${actionLabel} must have positive duration.`);
      if (actionStart < previousActionStart) fail(`${label}.actions must be ordered by startSeconds.`);
      previousActionStart = actionStart;
      return {
        id: actionId,
        startSeconds: actionStart,
        endSeconds: actionEnd,
        verb: choice(action.verb, ACTION_VERBS, `${actionLabel}.verb`),
        meaning: choice(action.meaning, ACTION_MEANINGS, `${actionLabel}.meaning`),
        subjectIds: idList(action.subjectIds, `${actionLabel}.subjectIds`, objectIds, { allowEmpty: false }),
        targetIds: idList(action.targetIds ?? [], `${actionLabel}.targetIds`, objectIds),
        description: requireText(action.description, `${actionLabel}.description`),
        resultingState: requireText(action.resultingState, `${actionLabel}.resultingState`),
      };
    });
    if (kind === "semantic" && !actions.some((action) => action.meaning === "semantic" && action.verb !== "hold")) {
      fail(`${label} is semantic and must include a non-hold semantic action.`);
    }
    const holdAfterSeconds = frameAligned(finite(entry.holdAfterSeconds ?? 0, `${label}.holdAfterSeconds`, 0, endSeconds - startSeconds), fps, `${label}.holdAfterSeconds`);
    const lastActionEnd = Math.max(...actions.map((action) => action.endSeconds));
    if (lastActionEnd + holdAfterSeconds > endSeconds + 1e-6) {
      fail(`${label}.holdAfterSeconds must fit after the final action and inside the beat.`);
    }
    const continuityFromBeatId = optionalText(entry.continuityFromBeatId, `${label}.continuityFromBeatId`);
    if (continuityFromBeatId !== null && !knownBeatIds.has(continuityFromBeatId)) {
      fail(`${label}.continuityFromBeatId must identify an earlier beat.`);
    }
    knownBeatIds.add(id);
    previousBeatEnd = endSeconds;
    return {
      id,
      kind,
      startSeconds,
      endSeconds,
      message: requireText(entry.message, `${label}.message`),
      narrationText: optionalText(entry.narrationText, `${label}.narrationText`),
      visualPurpose: requireText(entry.visualPurpose, `${label}.visualPurpose`),
      primaryObjectId,
      focusObjectIds,
      stateBefore: requireText(entry.stateBefore, `${label}.stateBefore`),
      stateAfter: requireText(entry.stateAfter, `${label}.stateAfter`),
      actions,
      holdAfterSeconds,
      continuityFromBeatId,
      reviewCriteria: normalizeStringList(entry.reviewCriteria, `${label}.reviewCriteria`, { allowEmpty: false }),
    };
  });
  return {
    version: "1.0",
    changeReason: requireText(value.changeReason, "animation.choreography.changeReason"),
    purpose: requireText(value.purpose, "animation.choreography.purpose"),
    durationSeconds,
    fps,
    objects,
    beats,
    reviewCriteria: normalizeStringList(value.reviewCriteria, "animation.choreography.reviewCriteria", { allowEmpty: false }),
  };
}

export function choreographyReviewPoints(choreography) {
  const normalized = normalizeVisualChoreography(choreography);
  const points = [];
  for (const beat of normalized.beats) {
    points.push({ frame: Math.round(beat.startSeconds * normalized.fps), seconds: beat.startSeconds, beatId: beat.id, kind: "beat-start" });
    for (const action of beat.actions.filter((action) => action.meaning === "semantic")) {
      const seconds = Math.min(beat.endSeconds - 1 / normalized.fps, action.endSeconds);
      points.push({ frame: Math.round(seconds * normalized.fps), seconds, beatId: beat.id, actionId: action.id, kind: "semantic-result" });
    }
    if (beat.holdAfterSeconds > 0) {
      const seconds = beat.endSeconds - 1 / normalized.fps;
      points.push({ frame: Math.round(seconds * normalized.fps), seconds, beatId: beat.id, kind: "hold" });
    }
  }
  const maximumFrame = Math.round(normalized.durationSeconds * normalized.fps) - 1;
  const unique = new Map();
  for (const point of points) {
    const frame = Math.max(0, Math.min(maximumFrame, point.frame));
    if (!unique.has(frame)) unique.set(frame, { ...point, frame, seconds: frame / normalized.fps });
  }
  return [...unique.values()].sort((left, right) => left.frame - right.frame);
}

export function selectChoreographyPreviewFrames(choreography, maximum = 12) {
  const points = choreographyReviewPoints(choreography);
  if (points.length <= maximum) return points.map((point) => point.frame);
  const selected = [];
  for (let index = 0; index < maximum; index++) {
    const pointIndex = Math.round(index * (points.length - 1) / (maximum - 1));
    selected.push(points[pointIndex].frame);
  }
  return [...new Set(selected)];
}
