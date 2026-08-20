import {randomUUID} from 'node:crypto';
import {DEFAULT_NARRATION_CALIBRATION, plannedBeatDurationSeconds} from '../shared/narrationTiming.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {TeachingOutlineSchema, VoiceVisualPlanSchema, type NarrationDocument, type TeachingOutline, type TopicProject, type VoiceVisualBeat, type VoiceVisualPlan, type VoiceVisualPlanContent} from '../shared/topic.ts';
import {
  NARRATION_VISUAL_PLANNER_PROMPT_VERSION,
  splitPlannerScenesAtBeatLimit,
  validatePlannerCoversUnitsInOrder,
  type NarrationPlannerUnit,
  type NarrationVisualPlannerOutput,
  type NarrationVisualPlannerService,
} from './narrationVisualPlanner.ts';

export const NARRATION_STRUCTURE_VERSION = 'semantic-visual-plan-v4';

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
function fallbackBeatLifecycle() {
  return {
    primaryBlock: 'block-concept-card',
    visualLifecycle: {
      enter: ['block-concept-card', 'concept-label'],
      stay: ['block-concept-card', 'concept-label', 'progress-fill'],
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
function groupSemanticScenes(beats: string[]) {
  const groups: string[][] = []; let current: string[] = [];
  for (const beat of beats) {
    if (current.length >= pipelineSafetyLimits.preferredBeatsPerSection || (current.length >= 2 && sceneBoundary.test(beat))) { groups.push(current); current = []; }
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
  return Boolean(project.narration?.review && project.narration.approvedSourceHash === project.narration.review.sourceHash && narrationArtifactsAreCurrent(project.outline, project.voiceVisualPlan) && project.voiceVisualPlan?.visualBible && project.voiceVisualPlan.sections.every(section => section.beats.length <= pipelineSafetyLimits.maximumBeatsPerSection && section.beats.every(beat => beat.primaryBlock && beat.visualLifecycle && beat.visualLifecycle.stay.includes(beat.primaryBlock) && beat.visualLifecycle.stay.filter(key => key.startsWith('block-')).length <= 2 && beatCompositionContractIsComplete(beat))) && narrationPlanMatchesReviewedNarration(project.narration, project.voiceVisualPlan));
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
  if (!narrationPlanMatchesReviewedNarration(narration, plan)) diagnostics.push('spoken narration was changed, omitted, or reordered');
  if (diagnostics.length) throw new Error(`Semantic visual plan invalid: ${diagnostics.join('; ')}.`);
}

export function createNarrationArtifacts({topicInput, narration, generationId, now, previousPlan, timingCalibration = DEFAULT_TIMING_CALIBRATION}: {topicInput: TopicProject['topicInput']; narration: NarrationDocument; generationId: string; now: string; previousPlan: VoiceVisualPlan | null | undefined; timingCalibration?: VoiceVisualPlanContent['timingCalibration'];}): {outline: TeachingOutline; voiceVisualPlan: VoiceVisualPlan} {
  const review = narration.review;
  if (!review || narration.approvedSourceHash !== review.sourceHash) throw new Error('Bản cách đọc chưa được duyệt.');
  const beats = splitReviewedNarration(review.normalizedText);
  if (beats.length > pipelineSafetyLimits.maximumTotalBeats) throw new Error(`Lời thoại vượt giới hạn ${pipelineSafetyLimits.maximumTotalBeats} beat.`);
  const groups = groupSemanticScenes(beats);
  if (groups.length > pipelineSafetyLimits.maximumSections) throw new Error('Lời thoại cần được chia thành nhiều project ngắn hơn.');
  const narrationRevision = (previousPlan?.narrationRevision ?? 0) + 1;
  const generation = {generationId, provider: 'local' as const, tool: 'narration-structure' as const, algorithmVersion: NARRATION_STRUCTURE_VERSION, generatedAt: now};
  const ids = groups.map(() => randomUUID());
  const outline: TeachingOutline = {brief: {summary: `Video về ${topicInput.topic} được dựng từ lời thoại đã duyệt.`, assumptions: ['Semantic planner chỉ phân đoạn và mô tả visual; không viết lại lời thoại.']}, centralMessage: centralMessage(topicInput.topic), sections: groups.map((group, index) => ({id: ids[index]!, title: semanticTitle(topicInput.topic, group, index), goal: teachingGoal(group), content: group.join(' '), estimatedSeconds: Math.max(pipelineSafetyLimits.minimumSectionDurationSeconds, group.reduce((total, beat) => total + plannedBeatDurationSeconds(beat, 0, timingCalibration), 0))})), status: 'approved', contentRevision: (previousPlan?.sourceOutlineContentRevision ?? 0) + 1, sourceInput: topicInput, sourceNarrationHash: review.sourceHash, sourceNarrationRevision: narrationRevision, generation};
  const plan: VoiceVisualPlan = {voiceDirection: 'Đọc nguyên văn bản cách đọc đã được người dùng duyệt.', visualDirection: 'Chuyển semantic blueprint và visual bible thành Motion Canvas; không tự đổi phép ẩn dụ nền tảng.', visualBible: visualBible(topicInput.background.color, topicInput.topic), timingCalibration, sections: groups.map((group, index) => ({outlineSectionId: ids[index]!, stateHandoff: {incoming: index ? `Kế thừa ${topicInput.topic} visual anchor từ scene ${index}.` : null, outgoing: index < groups.length - 1 ? `Giữ ${topicInput.topic} visual anchor để scene ${index + 2} tiếp tục.` : null}, beats: group.map(text => ({id: randomUUID(), voiceover: text, spokenVoiceover: text, visualPurpose: `Biến ý “${keywords(text).slice(0, 3).join(' ') || topicInput.topic}” thành một quan hệ nhìn thấy được thay vì chỉ lặp caption.`, visualDescription: describeVisual(text, topicInput.topic), animationDescription: 'Đưa quan hệ chính vào focus, chuyển trạng thái một lần theo nhịp lời đọc, rồi giữ hình để đọc.', visualHoldSeconds: 0, durationSeconds: plannedBeatDurationSeconds(text, 0, timingCalibration)}))})), status: 'approved', contentRevision: (previousPlan?.contentRevision ?? 0) + 1, narrationRevision, sourceOutlineContentRevision: outline.contentRevision, sourceNarrationHash: review.sourceHash, sourceNarrationRevision: narrationRevision, generation};
  for (const section of plan.sections) {
    for (const beat of section.beats) Object.assign(beat, fallbackBeatLifecycle(), {compositionContract: fallbackBeatComposition()});
  }
  const validatedOutline = TeachingOutlineSchema.parse(outline);
  const validatedPlan = VoiceVisualPlanSchema.parse(plan);
  validateSemanticVisualPlan(narration, validatedOutline, validatedPlan);
  return {outline: validatedOutline, voiceVisualPlan: validatedPlan};
}

function boundedText(value: string, max: number) {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Turns validated AI planner output back into TeachingOutline/VoiceVisualPlan
 * using the original reviewed units verbatim. The AI never supplies narration
 * text; only unit order (already checked by validatePlannerCoversUnitsInOrder)
 * decides how units.map(text) is grouped into scenes. */
export function reconstructArtifactsFromPlannerOutput({topicInput, narration, units, output, generation, previousPlan, timingCalibration = DEFAULT_TIMING_CALIBRATION}: {topicInput: TopicProject['topicInput']; narration: NarrationDocument; units: NarrationPlannerUnit[]; output: NarrationVisualPlannerOutput; generation: Extract<TeachingOutline['generation'], {provider: 'codex'}>; previousPlan: VoiceVisualPlan | null | undefined; timingCalibration?: VoiceVisualPlanContent['timingCalibration'];}): {outline: TeachingOutline; voiceVisualPlan: VoiceVisualPlan} {
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

  const outline: TeachingOutline = {brief: {summary: `Video về ${topicInput.topic} được dựng từ lời thoại đã duyệt.`, assumptions: ['AI visual planner chỉ phân đoạn và mô tả visual; không viết lại lời thoại.']}, centralMessage: centralMessage(topicInput.topic), sections: output.scenes.map((scene, index) => ({id: sceneIds[index]!, title: scene.title, goal: scene.goal, content: sceneUnitSlices[index]!.map(unit => unit.text).join(' '), estimatedSeconds: Math.max(pipelineSafetyLimits.minimumSectionDurationSeconds, sceneUnitSlices[index]!.reduce((total, unit) => total + plannedBeatDurationSeconds(unit.text, 0, timingCalibration), 0))})), status: 'approved', contentRevision: (previousPlan?.sourceOutlineContentRevision ?? 0) + 1, sourceInput: topicInput, sourceNarrationHash: review.sourceHash, sourceNarrationRevision: narrationRevision, generation};

  const voiceVisualPlan: VoiceVisualPlan = {voiceDirection: 'Đọc nguyên văn bản cách đọc đã được người dùng duyệt.', visualDirection: 'Chuyển blueprint AI và visual bible thành Motion Canvas; không tự đổi phép ẩn dụ nền tảng.', visualBible: {...output.visualBible, palette: {...output.visualBible.palette, background: topicInput.background.color}}, timingCalibration, sections: output.scenes.map((scene, index) => ({outlineSectionId: sceneIds[index]!, stateHandoff: {incoming: scene.stateHandoffIncoming, outgoing: scene.stateHandoffOutgoing}, beats: sceneUnitSlices[index]!.map((unit, unitIndex) => {const blueprint = scene.units[unitIndex]!; return {id: randomUUID(), voiceover: unit.text, spokenVoiceover: unit.text, visualPurpose: blueprint.visualPurpose, visualDescription: blueprint.visualDescription, animationDescription: blueprint.animationDescription, visualHoldSeconds: 0, durationSeconds: plannedBeatDurationSeconds(unit.text, 0, timingCalibration)};})})), status: 'approved', contentRevision: (previousPlan?.contentRevision ?? 0) + 1, narrationRevision, sourceOutlineContentRevision: outline.contentRevision, sourceNarrationHash: review.sourceHash, sourceNarrationRevision: narrationRevision, generation};

  const blueprintBeats = output.scenes.flatMap(scene => scene.units);
  const plannedBeats = voiceVisualPlan.sections.flatMap(section => section.beats);
  plannedBeats.forEach((beat, index) => Object.assign(beat, {
    primaryBlock: blueprintBeats[index]!.primaryBlock,
    visualLifecycle: blueprintBeats[index]!.visualLifecycle,
    compositionContract: blueprintBeats[index]!.compositionContract,
  }));
  validateSemanticVisualPlan(narration, outline, voiceVisualPlan);
  return {outline, voiceVisualPlan};
}

/**
 * Boundary between the AI Visual Planner and production preparation. Splits
 * reviewed narration into atomic units once, asks the AI to plan (never
 * write) over those unit IDs, and reconstructs artifacts from the untouched
 * unit text. Any AI/schema/invariant failure falls back to the deterministic
 * semantic planner and records why in `plannerDiagnostics` — the fallback is
 * never disguised as a successful AI plan.
 */
export async function planNarrationArtifacts({planner, topicInput, narration, generationId, now, previousPlan, model, reasoningEffort, timingCalibration = DEFAULT_TIMING_CALIBRATION}: {planner: NarrationVisualPlannerService; topicInput: TopicProject['topicInput']; narration: NarrationDocument; generationId: string; now: string; previousPlan: VoiceVisualPlan | null | undefined; model?: string; reasoningEffort?: string; timingCalibration?: VoiceVisualPlanContent['timingCalibration'];}): Promise<{outline: TeachingOutline; voiceVisualPlan: VoiceVisualPlan}> {
  const review = narration.review;
  if (!review || narration.approvedSourceHash !== review.sourceHash) throw new Error('Bản cách đọc chưa được duyệt.');
  const units: NarrationPlannerUnit[] = splitReviewedNarration(review.normalizedText).map((text, index) => ({id: `unit-${index + 1}`, text}));
  if (units.length > pipelineSafetyLimits.maximumTotalBeats) throw new Error(`Lời thoại vượt giới hạn ${pipelineSafetyLimits.maximumTotalBeats} beat.`);

  try {
    const plannerResult = await planner.plan({topicInput, units, model, reasoningEffort});
    const generation = {generationId, provider: 'codex' as const, model: plannerResult.model, ...(model ? {requestedModel: model} : {}), ...(reasoningEffort ? {reasoningEffort} : {}), promptVersion: NARRATION_VISUAL_PLANNER_PROMPT_VERSION, generatedAt: now, usage: plannerResult.usage};
    const reconstructed = reconstructArtifactsFromPlannerOutput({topicInput, narration, units, output: plannerResult.output, generation, previousPlan, timingCalibration});
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
    const deterministic = createNarrationArtifacts({topicInput, narration, generationId, now, previousPlan, timingCalibration});
    const reason = boundedText(
      error instanceof Error ? error.message : 'AI visual planner thất bại.',
      2_000,
    );
    return {
      outline: deterministic.outline,
      voiceVisualPlan: {...deterministic.voiceVisualPlan, plannerDiagnostics: [{stage: 'fallback', model: model ?? null, reason, outcome: 'used_fallback'}]},
    };
  }
}
