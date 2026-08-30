import {randomUUID} from 'node:crypto';
import {DEFAULT_NARRATION_CALIBRATION, plannedBeatDurationSeconds} from '../shared/narrationTiming.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {normalizePronunciationBaseText} from '../shared/pronunciation.ts';
import {TeachingOutlineSchema, VoiceVisualPlanSchema, type NarrationDocument, type TeachingOutline, type TopicProject, type VisualIntent, type VoiceVisualBeat, type VoiceVisualPlan, type VoiceVisualPlanContent} from '../shared/topic.ts';
import {
  NARRATION_VISUAL_PLANNER_PROMPT_VERSION,
  splitPlannerScenesAtBeatLimit,
  validatePlannerCoversUnitsInOrder,
  type NarrationPlannerUnit,
  type NarrationVisualPlannerOutput,
  type NarrationVisualPlannerService,
} from './narrationVisualPlanner.ts';

export const NARRATION_STRUCTURE_VERSION = 'semantic-visual-plan-v6-visual-intent';

export const DEFAULT_TIMING_CALIBRATION: VoiceVisualPlanContent['timingCalibration'] = {
  source: 'default',
  ...DEFAULT_NARRATION_CALIBRATION,
  voiceId: null,
  modelId: null,
  voiceName: null,
  sampleCount: 0,
};

function compactWhitespace(text: string) { return text.trim().replace(/\s+/gu, ' '); }
function centralMessage(topic: string) {
  return `Nội dung cốt lõi của ${compactWhitespace(topic)}.`;
}
function narrationUnits(text: string) {
  const units = text.trim().split(/(?<=[.!?…])\s+|\n{2,}/u).map(compactWhitespace).filter(Boolean);
  return units.length ? units : [compactWhitespace(text)];
}

/** This only partitions reviewed words. It never authors or paraphrases narration. */
export function splitReviewedNarration(text: string) {
  const merged: string[] = [];
  for (const unit of narrationUnits(text)) {
    if (unit.length < 12 && merged.length) merged[merged.length - 1] += ` ${unit}`;
    else merged.push(unit);
  }
  if (merged.length > 1 && merged.at(-1)!.length < 12) merged[merged.length - 2] += ` ${merged.pop()}`;
  if (merged.some(unit => unit.length < 12)) throw new Error('Lời thoại quá ngắn để tạo audio và scene.');
  return merged;
}

/**
 * Voice keeps the approved step-2 wording, while visual semantics use the
 * corresponding step-1 sentence whenever sentence boundaries still align.
 * If a user structurally rewrote step 2, the spoken unit is the safe local
 * fallback and the planner still receives the complete original transcript.
 */
export function narrationPlannerUnits(narration: NarrationDocument) {
  const spokenUnits = splitReviewedNarration(narration.review!.normalizedText);
  let semanticUnits: string[] = [];
  try {
    semanticUnits = splitReviewedNarration(
      normalizePronunciationBaseText(narration.sourceText),
    );
  } catch {
    // Structural edits in step 2 may make the original impossible to divide
    // with the voice safety limits. Keep voice units valid and pass the full
    // original transcript separately to the AI planner.
  }
  const boundariesAlign = semanticUnits.length === spokenUnits.length;
  return spokenUnits.map((text, index): NarrationPlannerUnit => ({
    id: `unit-${index + 1}`,
    text,
    semanticText: boundariesAlign ? semanticUnits[index]! : text,
  }));
}

const sceneBoundary = /^(vì vậy|do đó|tiếp theo|bây giờ|cuối cùng|tóm lại|nhưng|ngược lại|ví dụ)/iu;
const stopWords = new Set(['và', 'là', 'của', 'các', 'một', 'những', 'cho', 'trong', 'với', 'được', 'khi', 'để', 'này', 'đó', 'thì', 'về']);
function keywords(text: string) {
  return text.toLocaleLowerCase('vi').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(word => word.length > 2 && !stopWords.has(word)).slice(0, 5);
}
function semanticTitle(topic: string, beats: string[], index: number) {
  const label = keywords(beats.join(' ')).slice(0, 3).join(' ');
  return label ? `${topic}: ${label}`.slice(0, 120) : `${topic}: ý chính ${index + 1}`;
}
function teachingGoal(beats: string[]) {
  const terms = keywords(beats.join(' '));
  return terms.length ? `Làm rõ mối liên hệ giữa ${terms.slice(0, 3).join(', ')}.` : 'Làm rõ ý nghĩa của phần lời thuyết minh này.';
}
function describeVisual(text: string, topic: string) {
  const focus = keywords(text).slice(0, 3).join(' · ') || topic;
  return `Đặt “${focus}” vào visual anchor; dùng thẻ nhãn và đường nối để cho thấy quan hệ được nói trong beat.`;
}

function semanticId(value: string, prefix: string, index: number) {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/giu, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 28);
  return `${prefix}-${slug || `item-${index + 1}`}`;
}

/**
 * Emergency planner fallback. It is intentionally semantic and topic-derived:
 * every visible item comes from the reviewed wording, never from a universal
 * "input / priority / output" diagram. The later semantic gate can therefore
 * distinguish simplified coverage from an unrelated placeholder.
 */
function fallbackVisualIntent(text: string, topic: string): VisualIntent {
  const terms = [...new Set(keywords(text))].slice(0, 4);
  if (terms.length === 0) terms.push(topic.trim().slice(0, 40) || 'topic');
  const entities = terms.map((term, index) => ({
    id: semanticId(term, 'concept', index),
    kind: 'lesson concept',
    label: term.slice(0, 32),
    role: index === 0 ? 'primary' as const : 'support' as const,
    appearance: `A distinct visual symbol representing ${term}.`,
    state: null,
    mustShow: true,
  }));
  const numberNames = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const relations = entities.slice(1).map((entity, index) => ({
    id: `relation-${numberNames[index] ?? 'later'}-meaning`,
    type: 'semantic relationship',
    from: entities[0]!.id,
    to: entity.id,
    description: `${entities[0]!.label} is visibly related to ${entity.label}.`,
    mustShow: true,
  }));
  return {
    message: `Show the central meaning of: ${text}`.slice(0, 500),
    viewerShouldInfer: `The viewer can infer how ${terms.join(', ')} belong to the lesson without reading narration.`.slice(0, 500),
    abstraction: 'schematic',
    entities,
    relations,
    actions: [],
  };
}
function fallbackBeatLifecycle() {
  return {
    primaryBlock: 'block-concept-card',
    visualLifecycle: {
      enter: ['block-concept-card', 'concept-label'],
      stay: ['block-concept-card', 'concept-label'],
      exit: ['block-concept-card', 'concept-label'],
    },
  };
}
/** Deterministic composition intent for the non-AI planning path. It matches
 * the geometry the deterministic fallback scene actually renders. */
function fallbackBeatComposition(): VoiceVisualBeat['compositionContract'] {
  return {
    visualFocus: 'Thẻ khái niệm trung tâm mang ý chính của beat, mọi thành phần khác chỉ hỗ trợ đọc hiểu.',
    hierarchy: ['block-concept-card', 'concept-label'],
    semanticRole: 'claim',
    layout: 'center-focus',
    density: 'balanced',
    spacingNotes: 'Chừa safe margin quanh thẻ trung tâm và giữ khoảng thở rõ ràng giữa tiêu đề, thẻ và thanh tiến trình.',
  };
}
function groupSemanticScenes(beats: NarrationPlannerUnit[]) {
  const groups: NarrationPlannerUnit[][] = []; let current: NarrationPlannerUnit[] = [];
  for (const beat of beats) {
    if (current.length >= pipelineSafetyLimits.preferredBeatsPerSection || (current.length >= 2 && sceneBoundary.test(beat.semanticText))) { groups.push(current); current = []; }
    current.push(beat);
  }
  if (current.length) groups.push(current);
  return groups;
}
function visualBible(background: string, topic: string) {
  return {
    palette: {background, surface: '#173B31', primary: '#51B68E', accent: '#F5C451', text: '#F7FBF8'}, typographyScale: {title: 88, label: 42, body: 34},
    shapeLanguage: 'Thẻ bo góc có chiều sâu nhẹ, nút tròn và đường nối nhất quán; tránh minh họa trang trí không mang nghĩa.',
    diagramLanguage: `Sơ đồ giải thích ${topic} bằng một anchor trung tâm, nhãn ngắn và các quan hệ lần lượt được mở ra.`,
    motionTempo: 'Nhịp vừa: mỗi beat có một biến đổi hình học có chủ đích, sau đó giữ hình để khán giả kịp đọc.',
    transitionConvention: 'Giữ anchor giữa các scene; scene kế tiếp kế thừa nó bằng fade ngắn và dịch chuyển tiêu điểm.',
    visualAnchor: `Khối trung tâm đại diện cho “${topic}”, được tái dùng như điểm quy chiếu xuyên suốt video.`,
  };
}

/** A composition contract only counts when it agrees with the lifecycle it
 * describes: the dominant entry is the primary block and every ranked key is
 * actually on screen for that beat. */
export function beatCompositionContractIsComplete(beat: VoiceVisualBeat) {
  const contract = beat.compositionContract;
  return Boolean(contract && beat.primaryBlock && beat.visualLifecycle && contract.hierarchy[0] === beat.primaryBlock && contract.hierarchy.every(key => beat.visualLifecycle!.stay.includes(key)));
}

export function narrationArtifactsAreCurrent(outline: TeachingOutline | null | undefined, plan: VoiceVisualPlan | null | undefined) { return Boolean(outline?.status === 'approved' && plan?.status === 'approved'); }
export function narrationArtifactsMatchReview(project: Pick<TopicProject, 'outline' | 'voiceVisualPlan' | 'narration'>) {
  // A v1 plan remains readable, but production preparation upgrades it to a
  // v2 semantic blueprint; it cannot silently masquerade as a reviewed v2 plan.
  return Boolean(project.narration?.review && project.narration.approvedSourceHash === project.narration.review.sourceHash && narrationArtifactsAreCurrent(project.outline, project.voiceVisualPlan) && project.voiceVisualPlan?.visualBible && project.voiceVisualPlan.sections.every(section => section.beats.length <= pipelineSafetyLimits.maximumBeatsPerSection && section.beats.every(beat => beat.primaryBlock && beat.visualLifecycle && beat.visualLifecycle.stay.includes(beat.primaryBlock) && beat.visualLifecycle.stay.filter(key => key.startsWith('block-')).length <= 2 && beatCompositionContractIsComplete(beat) && beat.visualIntent)) && narrationPlanMatchesReviewedNarration(project.narration, project.voiceVisualPlan));
}
/** Proof that the plan preserves all reviewed narration and its order. */
export function narrationPlanMatchesReviewedNarration(narration: NarrationDocument, plan: VoiceVisualPlan) {
  const spoken = plan.sections.flatMap(section => section.beats).map(beat => beat.spokenVoiceover ?? beat.voiceover).join(' ');
  return compactWhitespace(spoken) === compactWhitespace(narration.review?.normalizedText ?? '');
}

/** Diagnostics used at the planning boundary, before any scene-code call. */
export function validateSemanticVisualPlan(narration: NarrationDocument, outline: TeachingOutline, plan: VoiceVisualPlan) {
  const diagnostics: string[] = [];
  if (!plan.visualBible) diagnostics.push('visual bible is missing');
  if (outline.sections.some(section => /^Đoạn\s+\d+$/u.test(section.title))) diagnostics.push('scene titles are generic');
  if (outline.sections.some(section => section.goal === 'Trình bày đúng nội dung lời thoại đã duyệt.')) diagnostics.push('scene goals are generic');
  if (plan.sections.some(section => section.beats.length > pipelineSafetyLimits.maximumBeatsPerSection)) diagnostics.push('scene exceeds maximum beat count');
  if (plan.sections.some(section => section.beats.some(beat => (beat.visualLifecycle?.stay ?? []).filter(key => key.startsWith('block-')).length > 2))) diagnostics.push('beat exceeds maximum active block count');
  if (plan.sections.some(section => !section.stateHandoff || section.beats.some(beat => !beat.visualPurpose || !beat.visualDescription || !beat.animationDescription || !beat.primaryBlock || !beat.visualLifecycle || !beat.visualLifecycle.stay.includes(beat.primaryBlock)))) diagnostics.push('beat blueprint, lifecycle, or scene handoff is incomplete');
  if (plan.sections.some(section => section.beats.some(beat => !beatCompositionContractIsComplete(beat)))) diagnostics.push('beat composition contract is missing or inconsistent');
  if (plan.sections.some(section => section.beats.some(beat => !beat.visualIntent))) diagnostics.push('beat còn thiếu yêu cầu hình ảnh có cấu trúc');
  if (!narrationPlanMatchesReviewedNarration(narration, plan)) diagnostics.push('spoken narration was changed, omitted, or reordered');
  if (diagnostics.length) throw new Error(`Kế hoạch hình ảnh chưa hợp lệ: ${diagnostics.join('; ')}.`);
}

export interface PreservedNarrationTimeline {
  outline: TeachingOutline;
  voiceVisualPlan: VoiceVisualPlan;
}

/**
 * Replaces only visual planning fields while retaining the identity consumed
 * by an existing VoiceBundle: outline section ids, beat ids, narration
 * revision, spoken text, grouping, and planned durations. Actual audio files,
 * alignment, and timestamps live in VoiceBundle and are never rewritten here.
 */
function applyPreservedNarrationTimeline(
  artifacts: {outline: TeachingOutline; voiceVisualPlan: VoiceVisualPlan},
  preserved: PreservedNarrationTimeline | null | undefined,
) {
  if (!preserved) return artifacts;
  const incomingBeats = artifacts.voiceVisualPlan.sections.flatMap(section => section.beats);
  const existingBeats = preserved.voiceVisualPlan.sections.flatMap(section => section.beats);
  if (
    incomingBeats.length !== existingBeats.length ||
    incomingBeats.some((beat, index) =>
      compactWhitespace(beat.spokenVoiceover ?? beat.voiceover) !==
      compactWhitespace(existingBeats[index]!.spokenVoiceover ?? existingBeats[index]!.voiceover),
    )
  ) {
    throw new Error('Visual replan cannot change the approved voice timeline.');
  }

  let cursor = 0;
  const sections = preserved.voiceVisualPlan.sections.map(section => ({
    ...section,
    beats: section.beats.map(existing => {
      const visual = incomingBeats[cursor++]!;
      return {
        ...existing,
        visualPurpose: visual.visualPurpose,
        visualDescription: visual.visualDescription,
        animationDescription: visual.animationDescription,
        visualLifecycle: visual.visualLifecycle,
        primaryBlock: visual.primaryBlock,
        compositionContract: visual.compositionContract,
        visualIntent: visual.visualIntent,
      };
    }),
  }));
  const voiceVisualPlan: VoiceVisualPlan = {
    ...preserved.voiceVisualPlan,
    voiceDirection: artifacts.voiceVisualPlan.voiceDirection,
    visualDirection: artifacts.voiceVisualPlan.visualDirection,
    visualBible: artifacts.voiceVisualPlan.visualBible,
    sections,
    status: 'approved',
    contentRevision: preserved.voiceVisualPlan.contentRevision + 1,
    generation: artifacts.voiceVisualPlan.generation,
    timingCalibration: preserved.voiceVisualPlan.timingCalibration,
  };
  return {
    // The spoken structure remains immutable, while sourceInput must follow
    // visual-only settings (background/frame/direction) edited in step 1 so
    // the preserved outline is still current for the project.
    outline: {
      ...preserved.outline,
      sourceInput: artifacts.outline.sourceInput,
      status: 'approved' as const,
    },
    voiceVisualPlan,
  };
}

export function createNarrationArtifacts({topicInput, narration, generationId, now, previousPlan, preserveTimeline, timingCalibration = DEFAULT_TIMING_CALIBRATION}: {topicInput: TopicProject['topicInput']; narration: NarrationDocument; generationId: string; now: string; previousPlan: VoiceVisualPlan | null | undefined; preserveTimeline?: PreservedNarrationTimeline | null; timingCalibration?: VoiceVisualPlanContent['timingCalibration'];}): {outline: TeachingOutline; voiceVisualPlan: VoiceVisualPlan} {
  const review = narration.review;
  if (!review || narration.approvedSourceHash !== review.sourceHash) throw new Error('Bản cách đọc chưa được duyệt.');
  const beats = narrationPlannerUnits(narration);
  if (beats.length > pipelineSafetyLimits.maximumTotalBeats) throw new Error(`Lời thoại vượt giới hạn ${pipelineSafetyLimits.maximumTotalBeats} beat.`);
  const groups = groupSemanticScenes(beats);
  if (groups.length > pipelineSafetyLimits.maximumSections) throw new Error('Lời thoại cần được chia thành nhiều project ngắn hơn.');
  const narrationRevision = (previousPlan?.narrationRevision ?? 0) + 1;
  const generation = {generationId, provider: 'local' as const, tool: 'narration-structure' as const, algorithmVersion: NARRATION_STRUCTURE_VERSION, generatedAt: now};
  const ids = groups.map(() => randomUUID());
  const outline: TeachingOutline = {brief: {summary: `Video về ${topicInput.topic} được dựng từ nội dung gốc và canh thời gian theo bản đọc đã duyệt.`, assumptions: ['Semantic planner chỉ phân đoạn và mô tả visual; không viết lại lời thoại.']}, centralMessage: centralMessage(topicInput.topic), sections: groups.map((group, index) => {const semanticTexts = group.map(beat => beat.semanticText); return {id: ids[index]!, title: semanticTitle(topicInput.topic, semanticTexts, index), goal: teachingGoal(semanticTexts), content: semanticTexts.join(' '), estimatedSeconds: Math.max(pipelineSafetyLimits.minimumSectionDurationSeconds, group.reduce((total, beat) => total + plannedBeatDurationSeconds(beat.text, 0, timingCalibration), 0))};}), status: 'approved', contentRevision: (previousPlan?.sourceOutlineContentRevision ?? 0) + 1, sourceInput: topicInput, sourceNarrationHash: review.sourceHash, sourceNarrationRevision: narrationRevision, generation};
  const plan: VoiceVisualPlan = {voiceDirection: 'Đọc nguyên văn bản cách đọc đã được người dùng duyệt.', visualDirection: 'Hiểu ngữ nghĩa từ nội dung gốc bước 1; chỉ dùng bản cách đọc cho voice và timing.', visualBible: visualBible(topicInput.background.color, topicInput.topic), timingCalibration, sections: groups.map((group, index) => ({outlineSectionId: ids[index]!, stateHandoff: {incoming: index ? `Kế thừa ${topicInput.topic} visual anchor từ scene ${index}.` : null, outgoing: index < groups.length - 1 ? `Giữ ${topicInput.topic} visual anchor để scene ${index + 2} tiếp tục.` : null}, beats: group.map(unit => ({id: randomUUID(), voiceover: unit.semanticText, spokenVoiceover: unit.text, visualPurpose: `Biến ý “${keywords(unit.semanticText).slice(0, 3).join(' ') || topicInput.topic}” thành một quan hệ nhìn thấy được thay vì chỉ lặp caption.`, visualDescription: describeVisual(unit.semanticText, topicInput.topic), animationDescription: 'Đưa quan hệ chính vào focus, chuyển trạng thái một lần theo nhịp lời đọc, rồi giữ hình để đọc.', visualIntent: fallbackVisualIntent(unit.semanticText, topicInput.topic), visualHoldSeconds: 0, durationSeconds: plannedBeatDurationSeconds(unit.text, 0, timingCalibration)}))})), status: 'approved', contentRevision: (previousPlan?.contentRevision ?? 0) + 1, narrationRevision, sourceOutlineContentRevision: outline.contentRevision, sourceNarrationHash: review.sourceHash, sourceNarrationRevision: narrationRevision, generation};
  for (const section of plan.sections) {
    for (const beat of section.beats) Object.assign(beat, fallbackBeatLifecycle(), {compositionContract: fallbackBeatComposition()});
  }
  const preservedArtifacts = applyPreservedNarrationTimeline({outline, voiceVisualPlan: plan}, preserveTimeline);
  const validatedOutline = TeachingOutlineSchema.parse(preservedArtifacts.outline);
  const validatedPlan = VoiceVisualPlanSchema.parse(preservedArtifacts.voiceVisualPlan);
  validateSemanticVisualPlan(narration, validatedOutline, validatedPlan);
  return {outline: validatedOutline, voiceVisualPlan: validatedPlan};
}

function boundedText(value: string, max: number) {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Turns validated AI planner output back into TeachingOutline/VoiceVisualPlan.
 * Step-1 wording is preserved for visual semantics and the approved step-2
 * wording is preserved verbatim for voice. The AI supplies neither text. */
export function reconstructArtifactsFromPlannerOutput({topicInput, narration, units, output, generation, previousPlan, preserveTimeline, timingCalibration = DEFAULT_TIMING_CALIBRATION}: {topicInput: TopicProject['topicInput']; narration: NarrationDocument; units: NarrationPlannerUnit[]; output: NarrationVisualPlannerOutput; generation: Extract<TeachingOutline['generation'], {provider: 'codex'}>; previousPlan: VoiceVisualPlan | null | undefined; preserveTimeline?: PreservedNarrationTimeline | null; timingCalibration?: VoiceVisualPlanContent['timingCalibration'];}): {outline: TeachingOutline; voiceVisualPlan: VoiceVisualPlan} {
  output = {...output, scenes: splitPlannerScenesAtBeatLimit(output.scenes)};
  validatePlannerCoversUnitsInOrder(units, output.scenes);
  const review = narration.review!;
  const narrationRevision = (previousPlan?.narrationRevision ?? 0) + 1;
  const sceneIds = output.scenes.map(() => randomUUID());
  const sceneUnitSlices: NarrationPlannerUnit[][] = [];
  let cursor = 0;
  for (const scene of output.scenes) {
    sceneUnitSlices.push(units.slice(cursor, cursor + scene.units.length));
    cursor += scene.units.length;
  }

  const outline: TeachingOutline = {brief: {summary: `Video về ${topicInput.topic} được dựng từ nội dung gốc và canh thời gian theo bản đọc đã duyệt.`, assumptions: ['AI lập kế hoạch hình ảnh chỉ phân đoạn và mô tả hình ảnh; không viết lại lời thoại.']}, centralMessage: centralMessage(topicInput.topic), sections: output.scenes.map((scene, index) => ({id: sceneIds[index]!, title: scene.title, goal: scene.goal, content: sceneUnitSlices[index]!.map(unit => unit.semanticText).join(' '), estimatedSeconds: Math.max(pipelineSafetyLimits.minimumSectionDurationSeconds, sceneUnitSlices[index]!.reduce((total, unit) => total + plannedBeatDurationSeconds(unit.text, 0, timingCalibration), 0))})), status: 'approved', contentRevision: (previousPlan?.sourceOutlineContentRevision ?? 0) + 1, sourceInput: topicInput, sourceNarrationHash: review.sourceHash, sourceNarrationRevision: narrationRevision, generation};

  const voiceVisualPlan: VoiceVisualPlan = {voiceDirection: 'Đọc nguyên văn bản cách đọc đã được người dùng duyệt.', visualDirection: 'Hiểu ngữ nghĩa từ nội dung gốc bước 1; chỉ dùng bản cách đọc cho voice và timing.', visualBible: {...output.visualBible, palette: {...output.visualBible.palette, background: topicInput.background.color}}, timingCalibration, sections: output.scenes.map((scene, index) => ({outlineSectionId: sceneIds[index]!, stateHandoff: {incoming: scene.stateHandoffIncoming, outgoing: scene.stateHandoffOutgoing}, beats: sceneUnitSlices[index]!.map((unit, unitIndex) => {const blueprint = scene.units[unitIndex]!; return {id: randomUUID(), voiceover: unit.semanticText, spokenVoiceover: unit.text, visualPurpose: blueprint.visualPurpose, visualDescription: blueprint.visualDescription, animationDescription: blueprint.animationDescription, visualHoldSeconds: 0, durationSeconds: plannedBeatDurationSeconds(unit.text, 0, timingCalibration)};})})), status: 'approved', contentRevision: (previousPlan?.contentRevision ?? 0) + 1, narrationRevision, sourceOutlineContentRevision: outline.contentRevision, sourceNarrationHash: review.sourceHash, sourceNarrationRevision: narrationRevision, generation};

  const blueprintBeats = output.scenes.flatMap(scene => scene.units);
  const plannedBeats = voiceVisualPlan.sections.flatMap(section => section.beats);
  plannedBeats.forEach((beat, index) => Object.assign(beat, {
    primaryBlock: blueprintBeats[index]!.primaryBlock,
    visualLifecycle: blueprintBeats[index]!.visualLifecycle,
    compositionContract: blueprintBeats[index]!.compositionContract,
    visualIntent: blueprintBeats[index]!.visualIntent ?? fallbackVisualIntent(beat.voiceover, topicInput.topic),
  }));
  const preservedArtifacts = applyPreservedNarrationTimeline({outline, voiceVisualPlan}, preserveTimeline);
  validateSemanticVisualPlan(narration, preservedArtifacts.outline, preservedArtifacts.voiceVisualPlan);
  return preservedArtifacts;
}

/**
 * Boundary between the AI Visual Planner and production preparation. Pairs
 * original semantic wording with approved spoken units, asks the AI to plan
 * (never write) over stable IDs, then reconstructs both text channels without
 * model-authored narration. Any AI/schema/invariant failure falls back to the
 * deterministic semantic planner and records why in `plannerDiagnostics`.
 */
export async function planNarrationArtifacts({planner, topicInput, narration, generationId, now, previousPlan, preserveTimeline, model, reasoningEffort, timingCalibration = DEFAULT_TIMING_CALIBRATION}: {planner: NarrationVisualPlannerService; topicInput: TopicProject['topicInput']; narration: NarrationDocument; generationId: string; now: string; previousPlan: VoiceVisualPlan | null | undefined; preserveTimeline?: PreservedNarrationTimeline | null; model?: string; reasoningEffort?: string; timingCalibration?: VoiceVisualPlanContent['timingCalibration'];}): Promise<{outline: TeachingOutline; voiceVisualPlan: VoiceVisualPlan}> {
  const review = narration.review;
  if (!review || narration.approvedSourceHash !== review.sourceHash) throw new Error('Bản cách đọc chưa được duyệt.');
  const units = narrationPlannerUnits(narration);
  if (units.length > pipelineSafetyLimits.maximumTotalBeats) throw new Error(`Lời thoại vượt giới hạn ${pipelineSafetyLimits.maximumTotalBeats} beat.`);

  try {
    const plannerResult = await planner.plan({
      topicInput,
      semanticSourceText: normalizePronunciationBaseText(narration.sourceText),
      units,
      model,
      reasoningEffort,
    });
    const generation = {generationId, provider: 'codex' as const, model: plannerResult.model, ...(model ? {requestedModel: model} : {}), ...(reasoningEffort ? {reasoningEffort} : {}), promptVersion: NARRATION_VISUAL_PLANNER_PROMPT_VERSION, generatedAt: now, usage: plannerResult.usage};
    const reconstructed = reconstructArtifactsFromPlannerOutput({topicInput, narration, units, output: plannerResult.output, generation, previousPlan, preserveTimeline, timingCalibration});
    // Belt-and-suspenders: the AI-facing schema is hand-matched to the
    // downstream artifact schemas, but a full re-parse is what actually
    // guarantees a broken/edge-case reconstruction falls back instead of
    // persisting an artifact the repository can no longer read back.
    const validatedOutline = TeachingOutlineSchema.parse(reconstructed.outline);
    const validatedPlan = VoiceVisualPlanSchema.parse(reconstructed.voiceVisualPlan);
    validateSemanticVisualPlan(narration, validatedOutline, validatedPlan);
    return {
      outline: validatedOutline,
      voiceVisualPlan: {...validatedPlan, plannerDiagnostics: [{stage: 'ai-plan', model: plannerResult.model, reason: null, outcome: 'used_ai'}]},
    };
  } catch (error) {
    const deterministic = createNarrationArtifacts({topicInput, narration, generationId, now, previousPlan, preserveTimeline, timingCalibration});
    const reason = boundedText(
      error instanceof Error ? error.message : 'AI lập kế hoạch hình ảnh thất bại.',
      2_000,
    );
    return {
      outline: deterministic.outline,
      voiceVisualPlan: {...deterministic.voiceVisualPlan, plannerDiagnostics: [{stage: 'fallback', model: model ?? null, reason, outcome: 'used_fallback'}]},
    };
  }
}
