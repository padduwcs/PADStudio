import {randomUUID} from 'node:crypto';
import {DEFAULT_NARRATION_CALIBRATION, plannedBeatDurationSeconds} from '../shared/narrationTiming.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import type {NarrationDocument, TeachingOutline, TopicProject, VoiceVisualPlan} from '../shared/topic.ts';

export const NARRATION_STRUCTURE_VERSION = 'semantic-visual-plan-v2';

function compactWhitespace(text: string) { return text.trim().replace(/\s+/gu, ' '); }
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
function groupSemanticScenes(beats: string[]) {
  const groups: string[][] = []; let current: string[] = [];
  for (const beat of beats) {
    if (current.length >= 6 || (current.length >= 2 && sceneBoundary.test(beat))) { groups.push(current); current = []; }
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

export function narrationArtifactsAreCurrent(outline: TeachingOutline | null | undefined, plan: VoiceVisualPlan | null | undefined) { return Boolean(outline?.status === 'approved' && plan?.status === 'approved'); }
export function narrationArtifactsMatchReview(project: Pick<TopicProject, 'outline' | 'voiceVisualPlan' | 'narration'>) {
  // A v1 plan remains readable, but production preparation upgrades it to a
  // v2 semantic blueprint; it cannot silently masquerade as a reviewed v2 plan.
  return Boolean(project.narration?.review && project.narration.approvedSourceHash === project.narration.review.sourceHash && narrationArtifactsAreCurrent(project.outline, project.voiceVisualPlan) && project.voiceVisualPlan?.visualBible && narrationPlanMatchesReviewedNarration(project.narration, project.voiceVisualPlan));
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
  if (plan.sections.some(section => !section.stateHandoff || section.beats.some(beat => !beat.visualPurpose || !beat.visualDescription || !beat.animationDescription))) diagnostics.push('beat blueprint or scene handoff is incomplete');
  if (!narrationPlanMatchesReviewedNarration(narration, plan)) diagnostics.push('spoken narration was changed, omitted, or reordered');
  if (diagnostics.length) throw new Error(`Semantic visual plan invalid: ${diagnostics.join('; ')}.`);
}

export function createNarrationArtifacts({topicInput, narration, generationId, now, previousPlan}: {topicInput: TopicProject['topicInput']; narration: NarrationDocument; generationId: string; now: string; previousPlan: VoiceVisualPlan | null | undefined;}): {outline: TeachingOutline; voiceVisualPlan: VoiceVisualPlan} {
  const review = narration.review;
  if (!review || narration.approvedSourceHash !== review.sourceHash) throw new Error('Bản cách đọc chưa được duyệt.');
  const beats = splitReviewedNarration(review.normalizedText);
  if (beats.length > pipelineSafetyLimits.maximumTotalBeats) throw new Error(`Lời thoại vượt giới hạn ${pipelineSafetyLimits.maximumTotalBeats} beat.`);
  const groups = groupSemanticScenes(beats);
  if (groups.length > pipelineSafetyLimits.maximumSections) throw new Error('Lời thoại cần được chia thành nhiều project ngắn hơn.');
  const narrationRevision = (previousPlan?.narrationRevision ?? 0) + 1;
  const generation = {generationId, provider: 'local' as const, tool: 'narration-structure' as const, algorithmVersion: NARRATION_STRUCTURE_VERSION, generatedAt: now};
  const ids = groups.map(() => randomUUID());
  const outline: TeachingOutline = {brief: {summary: `Video về ${topicInput.topic} được dựng từ lời thoại đã duyệt.`, assumptions: ['Semantic planner chỉ phân đoạn và mô tả visual; không viết lại lời thoại.']}, centralMessage: topicInput.topic, sections: groups.map((group, index) => ({id: ids[index]!, title: semanticTitle(topicInput.topic, group, index), goal: teachingGoal(group), content: group.join(' '), estimatedSeconds: Math.max(pipelineSafetyLimits.minimumSectionDurationSeconds, group.reduce((total, beat) => total + plannedBeatDurationSeconds(beat), 0))})), status: 'approved', contentRevision: (previousPlan?.sourceOutlineContentRevision ?? 0) + 1, sourceInput: topicInput, sourceNarrationHash: review.sourceHash, sourceNarrationRevision: narrationRevision, generation};
  const plan: VoiceVisualPlan = {voiceDirection: 'Đọc nguyên văn bản cách đọc đã được người dùng duyệt.', visualDirection: 'Chuyển semantic blueprint và visual bible thành Motion Canvas; không tự đổi phép ẩn dụ nền tảng.', visualBible: visualBible(topicInput.background.color, topicInput.topic), timingCalibration: {source: 'default', ...DEFAULT_NARRATION_CALIBRATION, voiceId: null, modelId: null, voiceName: null, sampleCount: 0}, sections: groups.map((group, index) => ({outlineSectionId: ids[index]!, stateHandoff: {incoming: index ? `Kế thừa ${topicInput.topic} visual anchor từ scene ${index}.` : null, outgoing: index < groups.length - 1 ? `Giữ ${topicInput.topic} visual anchor để scene ${index + 2} tiếp tục.` : null}, beats: group.map(text => ({id: randomUUID(), voiceover: text, spokenVoiceover: text, visualPurpose: `Biến ý “${keywords(text).slice(0, 3).join(' ') || topicInput.topic}” thành một quan hệ nhìn thấy được thay vì chỉ lặp caption.`, visualDescription: describeVisual(text, topicInput.topic), animationDescription: 'Đưa quan hệ chính vào focus, chuyển trạng thái một lần theo nhịp lời đọc, rồi giữ hình để đọc.', visualHoldSeconds: 0, durationSeconds: plannedBeatDurationSeconds(text, 0, DEFAULT_NARRATION_CALIBRATION)}))})), status: 'approved', contentRevision: (previousPlan?.contentRevision ?? 0) + 1, narrationRevision, sourceOutlineContentRevision: outline.contentRevision, sourceNarrationHash: review.sourceHash, sourceNarrationRevision: narrationRevision, generation};
  validateSemanticVisualPlan(narration, outline, plan);
  return {outline, voiceVisualPlan: plan};
}
