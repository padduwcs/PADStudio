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
const ACTION_EFFECTS = new Set(["state-change", "focus-change", "presentation"]);
const CONTINUITY_MODES = new Set(["continuous-model", "chaptered-model"]);
const BEAT_CONTINUITY_MODES = new Set(["establish", "continue", "transform", "bridge", "reset"]);
const VISUAL_RELATIONSHIPS = new Set([
  "establish", "carry", "transform", "reframe", "contrast", "analogy", "cutaway", "reset",
]);
const LEGACY_NARRATION_MODES = new Set(["voice-led", "selective-captions", "full-transcript"]);
const NARRATION_MODES = new Set(["voice-led", "selective-captions", "kinetic-type", "full-transcript"]);
const COMMUNICATION_MODES = new Set(["visual-first", "type-led"]);
const TEXT_ROLES = new Set(["label", "value", "formula", "caption", "title", "quote"]);
const PRESENTATION_ONLY_VERBS = new Set(["introduce", "reveal", "highlight", "annotate", "hold"]);
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
  const version = value.version;
  if (!["1.0", "1.1", "1.2", "1.3"].includes(version)) fail("animation.choreography version must be 1.0, 1.1, 1.2 or 1.3.");
  assertOnlyFields(value, [
    "version", "changeReason", "purpose", "durationSeconds", "fps", "objects", "beats", "reviewCriteria",
    ...(version === "1.1" ? ["continuity", "presentation", "chapters"] : []),
    ...(["1.2", "1.3"].includes(version) ? ["direction", "presentation"] : []),
  ], "animation.choreography data");
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
  const persistentObjectIds = new Set(objects.filter((object) => object.continuity === "persistent").map((object) => object.id));
  let continuity = null;
  let presentation = null;
  let direction = null;
  let chapters = null;
  let chapterById = new Map();
  if (version === "1.1") {
    requireObject(value.continuity, "animation.choreography.continuity");
    assertOnlyFields(value.continuity, ["mode", "visualThesis", "heroObjectIds", "maxResets"], "animation.choreography.continuity");
    const heroObjectIds = idList(value.continuity.heroObjectIds, "animation.choreography.continuity.heroObjectIds", objectIds, { allowEmpty: false });
    const nonPersistentHeroes = heroObjectIds.filter((id) => !persistentObjectIds.has(id));
    if (nonPersistentHeroes.length) fail(`animation.choreography continuity heroes must be persistent objects: ${nonPersistentHeroes.join(", ")}.`);
    const maxResets = finite(value.continuity.maxResets, "animation.choreography.continuity.maxResets", 0, 10);
    if (!Number.isInteger(maxResets)) fail("animation.choreography.continuity.maxResets must be an integer.");
    continuity = {
      mode: choice(value.continuity.mode, CONTINUITY_MODES, "animation.choreography.continuity.mode"),
      visualThesis: requireText(value.continuity.visualThesis, "animation.choreography.continuity.visualThesis"),
      heroObjectIds,
      maxResets,
    };

    requireObject(value.presentation, "animation.choreography.presentation");
    assertOnlyFields(value.presentation, [
      "narrationMode", "stageDescription", "targetStageCoveragePercent", "maxTextAreaPercent",
    ], "animation.choreography.presentation");
    const targetStageCoveragePercent = finite(value.presentation.targetStageCoveragePercent,
      "animation.choreography.presentation.targetStageCoveragePercent", 40, 95);
    const maxTextAreaPercent = finite(value.presentation.maxTextAreaPercent,
      "animation.choreography.presentation.maxTextAreaPercent", 0, 35);
    if (targetStageCoveragePercent <= maxTextAreaPercent) {
      fail("animation.choreography presentation must give the primary stage more area than text.");
    }
    presentation = {
      narrationMode: choice(value.presentation.narrationMode, LEGACY_NARRATION_MODES, "animation.choreography.presentation.narrationMode"),
      stageDescription: requireText(value.presentation.stageDescription, "animation.choreography.presentation.stageDescription"),
      targetStageCoveragePercent,
      maxTextAreaPercent,
    };
    if (presentation.narrationMode === "full-transcript") {
      fail("animation.choreography 1.1 cannot use a full-transcript presentation panel; use voice-led visuals or selective captions.");
    }

    if (!Array.isArray(value.chapters) || value.chapters.length === 0 || value.chapters.length > 20) {
      fail("animation.choreography.chapters must contain between 1 and 20 chapters.");
    }
    chapters = value.chapters.map((entry, index) => {
      const label = `animation.choreography.chapters[${index}]`;
      requireObject(entry, label);
      assertOnlyFields(entry, ["id", "label", "goal", "heroObjectIds"], label);
      const heroIds = idList(entry.heroObjectIds, `${label}.heroObjectIds`, objectIds, { allowEmpty: false });
      if (!heroIds.some((id) => continuity.heroObjectIds.includes(id))) {
        fail(`${label}.heroObjectIds must retain at least one choreography hero object.`);
      }
      if (heroIds.some((id) => !persistentObjectIds.has(id))) {
        fail(`${label}.heroObjectIds must contain only persistent objects.`);
      }
      return {
        id: requireId(entry.id, `${label}.id`),
        label: requireText(entry.label, `${label}.label`),
        goal: requireText(entry.goal, `${label}.goal`),
        heroObjectIds: heroIds,
      };
    });
    chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    if (chapterById.size !== chapters.length) fail("animation.choreography chapter IDs must be unique.");
  } else if (["1.2", "1.3"].includes(version)) {
    requireObject(value.direction, "animation.choreography.direction");
    assertOnlyFields(value.direction, [
      "visualThesis", "continuityIntent", "variationIntent", "motionLanguage", "antiPatterns", "sampleIntent",
    ], "animation.choreography.direction");
    direction = {
      visualThesis: requireText(value.direction.visualThesis, "animation.choreography.direction.visualThesis"),
      continuityIntent: requireText(value.direction.continuityIntent, "animation.choreography.direction.continuityIntent"),
      variationIntent: requireText(value.direction.variationIntent, "animation.choreography.direction.variationIntent"),
      motionLanguage: normalizeStringList(value.direction.motionLanguage, "animation.choreography.direction.motionLanguage", { allowEmpty: false }),
      antiPatterns: normalizeStringList(value.direction.antiPatterns, "animation.choreography.direction.antiPatterns", { allowEmpty: false }),
      sampleIntent: requireText(value.direction.sampleIntent, "animation.choreography.direction.sampleIntent"),
    };

    requireObject(value.presentation, "animation.choreography.presentation");
    assertOnlyFields(value.presentation, [
      "narrationMode", "stageIntent", "textIntent", ...(version === "1.3" ? ["communicationMode"] : []),
    ], "animation.choreography.presentation");
    presentation = {
      narrationMode: choice(value.presentation.narrationMode, NARRATION_MODES, "animation.choreography.presentation.narrationMode"),
      stageIntent: requireText(value.presentation.stageIntent, "animation.choreography.presentation.stageIntent"),
      textIntent: requireText(value.presentation.textIntent, "animation.choreography.presentation.textIntent"),
      ...(version === "1.3" ? {
        communicationMode: choice(value.presentation.communicationMode, COMMUNICATION_MODES,
          "animation.choreography.presentation.communicationMode"),
      } : {}),
    };
    if (version === "1.3" && presentation.communicationMode === "visual-first"
      && presentation.narrationMode === "full-transcript") {
      fail("animation.choreography 1.3 visual-first work cannot use full-transcript presentation.");
    }
  }
  if (!Array.isArray(value.beats) || value.beats.length === 0 || value.beats.length > 240) {
    fail("animation.choreography.beats must contain between 1 and 240 beats.");
  }
  let previousBeatEnd = 0;
  let previousBeat = null;
  let previousChapterId = null;
  let resetCount = 0;
  const encounteredChapterIds = [];
  const completedChapterIds = new Set();
  const newInformationKeys = new Set();
  const knownBeatIds = new Set();
  const beats = value.beats.map((entry, index) => {
    const label = `animation.choreography.beats[${index}]`;
    requireObject(entry, label);
    assertOnlyFields(entry, [
      "id", "kind", "startSeconds", "endSeconds", "message", "narrationText", "visualPurpose",
      "primaryObjectId", "focusObjectIds", "stateBefore", "stateAfter", "actions", "holdAfterSeconds",
      "continuityFromBeatId", "reviewCriteria",
      ...(version === "1.1" ? [
        "chapterId", "continuityMode", "stateBeforeId", "stateAfterId", "carriedObjectIds",
        "newInformation", "resetReason",
      ] : []),
      ...(["1.2", "1.3"].includes(version) ? [
        "visualQuestion", "audienceInsight", "relationToPrevious", "continuityCue", "compositionIntent",
      ] : []),
      ...(version === "1.3" ? ["visualProof", "textElements"] : []),
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
        ...(["1.1", "1.2", "1.3"].includes(version) ? ["effect"] : []),
      ], actionLabel);
      const actionId = requireId(action.id, `${actionLabel}.id`);
      if (actionIds.has(actionId)) fail(`${label} action IDs must be unique.`);
      actionIds.add(actionId);
      const actionStart = frameAligned(finite(action.startSeconds, `${actionLabel}.startSeconds`, startSeconds, endSeconds), fps, `${actionLabel}.startSeconds`);
      const actionEnd = frameAligned(finite(action.endSeconds, `${actionLabel}.endSeconds`, actionStart, endSeconds), fps, `${actionLabel}.endSeconds`);
      if (actionEnd <= actionStart) fail(`${actionLabel} must have positive duration.`);
      if (actionStart < previousActionStart) fail(`${label}.actions must be ordered by startSeconds.`);
      previousActionStart = actionStart;
      const verb = choice(action.verb, ACTION_VERBS, `${actionLabel}.verb`);
      const effect = ["1.1", "1.2", "1.3"].includes(version)
        ? choice(action.effect, ACTION_EFFECTS, `${actionLabel}.effect`)
        : null;
      if (["1.1", "1.2", "1.3"].includes(version) && effect === "state-change" && PRESENTATION_ONLY_VERBS.has(verb)) {
        fail(`${actionLabel}.${verb} is presentation/focus motion and cannot count as a state change.`);
      }
      return {
        id: actionId,
        startSeconds: actionStart,
        endSeconds: actionEnd,
        verb,
        meaning: choice(action.meaning, ACTION_MEANINGS, `${actionLabel}.meaning`),
        ...(["1.1", "1.2", "1.3"].includes(version) ? { effect } : {}),
        subjectIds: idList(action.subjectIds, `${actionLabel}.subjectIds`, objectIds, { allowEmpty: false }),
        targetIds: idList(action.targetIds ?? [], `${actionLabel}.targetIds`, objectIds),
        description: requireText(action.description, `${actionLabel}.description`),
        resultingState: requireText(action.resultingState, `${actionLabel}.resultingState`),
      };
    });
    if (kind === "semantic" && !actions.some((action) => action.meaning === "semantic" && action.verb !== "hold")) {
      fail(`${label} is semantic and must include a non-hold semantic action.`);
    }
    if (["1.1", "1.2", "1.3"].includes(version) && kind === "semantic" && !actions.some((action) => action.meaning === "semantic" && action.effect === "state-change")) {
      fail(`${label} is semantic and must include a semantic state-change action; entrance, highlight and hold motion do not qualify.`);
    }
    if (["1.1", "1.2", "1.3"].includes(version) && kind === "semantic") {
      const finalStateChange = [...actions].reverse().find((action) => action.meaning === "semantic" && action.effect === "state-change");
      if (finalStateChange.resultingState !== entry.stateAfter) {
        fail(`${label}.stateAfter must equal the resultingState of its final semantic state-change action.`);
      }
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
    let continuityFields = {};
    if (version === "1.1") {
      const chapterId = requireId(entry.chapterId, `${label}.chapterId`);
      const chapter = chapterById.get(chapterId);
      if (!chapter) fail(`${label}.chapterId references an unknown chapter.`);
      const continuityMode = choice(entry.continuityMode, BEAT_CONTINUITY_MODES, `${label}.continuityMode`);
      const stateBeforeId = requireId(entry.stateBeforeId, `${label}.stateBeforeId`);
      const stateAfterId = requireId(entry.stateAfterId, `${label}.stateAfterId`);
      const carriedObjectIds = idList(entry.carriedObjectIds, `${label}.carriedObjectIds`, objectIds);
      const newInformation = requireText(entry.newInformation, `${label}.newInformation`);
      const newInformationKey = newInformation.trim().toLocaleLowerCase();
      if (newInformationKeys.has(newInformationKey)) fail(`${label}.newInformation repeats an earlier beat instead of advancing the explanation.`);
      newInformationKeys.add(newInformationKey);
      const resetReason = optionalText(entry.resetReason, `${label}.resetReason`);
      if (kind === "semantic" && !focusObjectIds.some((objectId) => chapter.heroObjectIds.includes(objectId))) {
        fail(`${label}.focusObjectIds must keep at least one chapter hero visible in a semantic beat.`);
      }
      if (previousBeat === null) {
        if (continuityMode !== "establish") fail(`${label} is the first beat and must establish the visual model.`);
        if (continuityFromBeatId !== null) fail(`${label}.continuityFromBeatId must be null for the first beat.`);
      } else {
        if (continuityMode === "establish") fail(`${label} cannot establish a second unrelated visual model.`);
        if (continuityFromBeatId !== previousBeat.id) {
          fail(`${label}.continuityFromBeatId must identify the immediately preceding beat.`);
        }
        if (continuityMode === "reset") {
          resetCount += 1;
          if (!resetReason) fail(`${label}.resetReason is required when continuityMode is reset.`);
        } else {
          if (resetReason) fail(`${label}.resetReason is only allowed when continuityMode is reset.`);
          if (stateBeforeId !== previousBeat.stateAfterId) {
            fail(`${label}.stateBeforeId must equal the preceding beat stateAfterId.`);
          }
          if (!carriedObjectIds.some((objectId) => continuity.heroObjectIds.includes(objectId))) {
            fail(`${label}.carriedObjectIds must preserve at least one choreography hero object.`);
          }
        }
        const chapterChanged = chapterId !== previousChapterId;
        if (chapterChanged && !["bridge", "reset"].includes(continuityMode)) {
          fail(`${label} starts a new chapter and must bridge from the prior model or declare a reset.`);
        }
        if (chapterChanged && continuityMode === "bridge") {
          const previousChapter = chapterById.get(previousChapterId);
          const sharedBridgeObject = carriedObjectIds.some((objectId) => previousChapter.heroObjectIds.includes(objectId)
            && chapter.heroObjectIds.includes(objectId));
          if (!sharedBridgeObject) {
            fail(`${label}.carriedObjectIds must include a hero shared by the previous and current chapters.`);
          }
        }
        if (!chapterChanged && continuityMode === "bridge") {
          fail(`${label}.continuityMode bridge is only valid at a chapter boundary.`);
        }
      }
      if (kind === "semantic" && stateBeforeId === stateAfterId) {
        fail(`${label} is semantic and must advance to a new observable state.`);
      }
      if (chapterId !== previousChapterId) {
        if (completedChapterIds.has(chapterId)) fail(`${label}.chapterId returns to a completed chapter; chapter beats must be contiguous.`);
        if (previousChapterId !== null) completedChapterIds.add(previousChapterId);
        encounteredChapterIds.push(chapterId);
      }
      previousChapterId = chapterId;
      continuityFields = {
        chapterId, continuityMode, stateBeforeId, stateAfterId, carriedObjectIds, newInformation, resetReason,
      };
    } else if (["1.2", "1.3"].includes(version)) {
      const relationToPrevious = choice(entry.relationToPrevious, VISUAL_RELATIONSHIPS, `${label}.relationToPrevious`);
      if (previousBeat === null && relationToPrevious !== "establish") {
        fail(`${label} is the first beat and must establish the visual argument.`);
      }
      if (previousBeat !== null && relationToPrevious === "establish") {
        fail(`${label} cannot establish the visual argument again; choose how it relates to earlier material.`);
      }
      continuityFields = {
        visualQuestion: requireText(entry.visualQuestion, `${label}.visualQuestion`),
        audienceInsight: requireText(entry.audienceInsight, `${label}.audienceInsight`),
        relationToPrevious,
        continuityCue: requireText(entry.continuityCue, `${label}.continuityCue`),
        compositionIntent: requireText(entry.compositionIntent, `${label}.compositionIntent`),
      };
      if (version === "1.3") {
        const visualProof = requireText(entry.visualProof, `${label}.visualProof`);
        if (!Array.isArray(entry.textElements) || entry.textElements.length > 100) {
          fail(`${label}.textElements must be an array with at most 100 items.`);
        }
        const textIds = new Set();
        const textElements = entry.textElements.map((item, textIndex) => {
          const textLabel = `${label}.textElements[${textIndex}]`;
          requireObject(item, textLabel);
          assertOnlyFields(item, ["id", "text", "role", "purpose"], textLabel);
          const textId = requireId(item.id, `${textLabel}.id`);
          if (textIds.has(textId)) fail(`${label}.textElements IDs must be unique.`);
          textIds.add(textId);
          const role = choice(item.role, TEXT_ROLES, `${textLabel}.role`);
          const displayText = requireText(item.text, `${textLabel}.text`);
          const maximumCharacters = presentation.communicationMode === "type-led" ? 2000
            : ["label", "value", "title"].includes(role) ? 80 : role === "formula" ? 160 : 240;
          if ([...displayText].length > maximumCharacters) {
            fail(`${textLabel}.text is too long for role ${role}; split or remove prose instead of creating a text panel.`);
          }
          return { id: textId, text: displayText, role, purpose: requireText(item.purpose, `${textLabel}.purpose`) };
        });
        if (presentation.communicationMode === "visual-first") {
          if (kind === "semantic" && objects.find((object) => object.id === primaryObjectId).role === "annotation") {
            fail(`${label}.primaryObjectId cannot be an annotation in visual-first semantic work.`);
          }
          const normalizedNarration = typeof entry.narrationText === "string"
            ? entry.narrationText.trim().replace(/\s+/gu, " ").toLocaleLowerCase()
            : null;
          const duplicatesNarration = normalizedNarration && textElements.some((item) =>
            ["caption", "title", "quote"].includes(item.role)
            && item.text.trim().replace(/\s+/gu, " ").toLocaleLowerCase() === normalizedNarration);
          if (duplicatesNarration) {
            fail(`${label}.textElements must not duplicate the full narration in visual-first work.`);
          }
        }
        continuityFields = { ...continuityFields, visualProof, textElements };
      }
    }
    knownBeatIds.add(id);
    previousBeatEnd = endSeconds;
    const normalizedBeat = {
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
      ...continuityFields,
    };
    previousBeat = normalizedBeat;
    return normalizedBeat;
  });
  if (version === "1.1") {
    if (resetCount > continuity.maxResets) {
      fail(`animation.choreography uses ${resetCount} resets, exceeding continuity.maxResets ${continuity.maxResets}.`);
    }
    const declaredChapterIds = chapters.map((chapter) => chapter.id);
    if (encounteredChapterIds.length !== declaredChapterIds.length
      || encounteredChapterIds.some((id, index) => id !== declaredChapterIds[index])) {
      fail("animation.choreography beats must use every declared chapter once and in declared order.");
    }
  }
  return {
    version,
    changeReason: requireText(value.changeReason, "animation.choreography.changeReason"),
    purpose: requireText(value.purpose, "animation.choreography.purpose"),
    durationSeconds,
    fps,
    objects,
    beats,
    reviewCriteria: normalizeStringList(value.reviewCriteria, "animation.choreography.reviewCriteria", { allowEmpty: false }),
    ...(version === "1.1" ? { continuity, presentation, chapters } : {}),
    ...(["1.2", "1.3"].includes(version) ? { direction, presentation } : {}),
  };
}

export function choreographyContinuityMetrics(choreography) {
  const normalized = normalizeVisualChoreography(choreography);
  if (normalized.version === "1.0") {
    return { contractVersion: "1.0", chapterCount: null, heroObjectCount: null, resetCount: null,
      carriedBeatRatio: null, narrationMode: null, targetStageCoveragePercent: null, maxTextAreaPercent: null };
  }
  if (["1.2", "1.3"].includes(normalized.version)) {
    const relationshipCounts = Object.fromEntries([...VISUAL_RELATIONSHIPS]
      .map((relationship) => [relationship, normalized.beats.filter((beat) => beat.relationToPrevious === relationship).length])
      .filter(([, count]) => count > 0));
    return {
      contractVersion: normalized.version, continuityMode: null, chapterCount: null, heroObjectCount: null,
      resetCount: relationshipCounts.reset ?? 0, carriedBeatRatio: null,
      narrationMode: normalized.presentation.narrationMode,
      targetStageCoveragePercent: null, maxTextAreaPercent: null,
      relationshipCounts, motionLanguageCount: normalized.direction.motionLanguage.length,
    };
  }
  const followupBeats = normalized.beats.slice(1);
  const carriedBeats = followupBeats.filter((beat) => beat.continuityMode !== "reset"
    && beat.carriedObjectIds.some((id) => normalized.continuity.heroObjectIds.includes(id)));
  return {
    contractVersion: normalized.version,
    continuityMode: normalized.continuity.mode,
    chapterCount: normalized.chapters.length,
    heroObjectCount: normalized.continuity.heroObjectIds.length,
    resetCount: normalized.beats.filter((beat) => beat.continuityMode === "reset").length,
    carriedBeatRatio: followupBeats.length ? carriedBeats.length / followupBeats.length : 1,
    narrationMode: normalized.presentation.narrationMode,
    targetStageCoveragePercent: normalized.presentation.targetStageCoveragePercent,
    maxTextAreaPercent: normalized.presentation.maxTextAreaPercent,
  };
}

export function choreographyCommunicationMetrics(choreography) {
  const normalized = normalizeVisualChoreography(choreography);
  if (normalized.version !== "1.3") {
    return { contractVersion: normalized.version, communicationMode: null, totalTextElementCount: null,
      textlessBeatCount: null, roleCounts: null, longestTextCharacters: null,
      narrationDuplicateCount: null, semanticVisualProofCount: null };
  }
  const textElements = normalized.beats.flatMap((beat) => beat.textElements);
  const roleCounts = Object.fromEntries([...TEXT_ROLES]
    .map((role) => [role, textElements.filter((item) => item.role === role).length])
    .filter(([, count]) => count > 0));
  const narrationDuplicateCount = normalized.beats.filter((beat) => {
    const narration = beat.narrationText?.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
    return narration && beat.textElements.some((item) =>
      ["caption", "title", "quote"].includes(item.role)
      && item.text.trim().replace(/\s+/gu, " ").toLocaleLowerCase() === narration);
  }).length;
  return {
    contractVersion: "1.3",
    communicationMode: normalized.presentation.communicationMode,
    totalTextElementCount: textElements.length,
    textlessBeatCount: normalized.beats.filter((beat) => beat.textElements.length === 0).length,
    roleCounts,
    longestTextCharacters: textElements.reduce((longest, item) => Math.max(longest, [...item.text].length), 0),
    narrationDuplicateCount,
    semanticVisualProofCount: normalized.beats.filter((beat) => beat.kind === "semantic" && beat.visualProof).length,
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
