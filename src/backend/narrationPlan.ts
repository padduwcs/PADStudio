import {randomUUID} from 'node:crypto';
import {
  DEFAULT_NARRATION_CALIBRATION,
  plannedBeatDurationSeconds,
} from '../shared/narrationTiming.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import type {
  NarrationDocument,
  TeachingOutline,
  TopicProject,
  VoiceVisualPlan,
} from '../shared/topic.ts';

export const NARRATION_STRUCTURE_VERSION = 'narration-structure-v1';

const targetBeatCharacters = 520;
const beatsPerSection = 8;

function compactWhitespace(text: string) {
  return text.trim().replace(/\s+/gu, ' ');
}

/**
 * Keeps the reviewed words intact while making safe TTS/scene boundaries.
 * Boundaries only normalize whitespace between blocks; they never ask an AI
 * to author or paraphrase the user's narration.
 */
export function splitReviewedNarration(text: string) {
  const sentences = text
    .trim()
    .split(/(?<=[.!?…])\s+|\n{2,}/u)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  const source = sentences.length > 0 ? sentences : [text.trim()];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of source) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (current && candidate.length > targetBeatCharacters) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  // Scene artifacts require at least 12 characters per beat. Joining a
  // short lead-in to its successor preserves every reviewed word and avoids a
  // synthetic filler sentence.
  const merged: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length < 12 && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  if (merged.length > 1 && merged.at(-1)!.length < 12) {
    merged[merged.length - 2] = `${merged[merged.length - 2]} ${merged.pop()}`;
  }
  if (merged.some(chunk => chunk.length < 12)) {
    throw new Error('Lời thoại quá ngắn để tạo audio và scene.');
  }
  return merged;
}

export function narrationArtifactsAreCurrent(
  outline: TeachingOutline | null | undefined,
  plan: VoiceVisualPlan | null | undefined,
) {
  return Boolean(
    outline?.status === 'approved' && plan?.status === 'approved',
  );
}

export function narrationArtifactsMatchReview(
  project: Pick<TopicProject, 'outline' | 'voiceVisualPlan' | 'narration'>,
) {
  return Boolean(
      project.narration?.review &&
      project.narration.approvedSourceHash === project.narration.review.sourceHash &&
      narrationArtifactsAreCurrent(project.outline, project.voiceVisualPlan) &&
      project.voiceVisualPlan !== null &&
      narrationPlanMatchesReviewedNarration(project.narration, project.voiceVisualPlan),
  );
}

export function narrationPlanMatchesReviewedNarration(
  narration: NarrationDocument,
  plan: VoiceVisualPlan,
) {
  const planText = plan.sections
    .flatMap(section => section.beats)
    .map(beat => beat.spokenVoiceover ?? beat.voiceover)
    .join(' ');
  return compactWhitespace(planText) === compactWhitespace(narration.review?.normalizedText ?? '');
}

export function createNarrationArtifacts({
  topicInput,
  narration,
  generationId,
  now,
  previousPlan,
}: {
  topicInput: TopicProject['topicInput'];
  narration: NarrationDocument;
  generationId: string;
  now: string;
  previousPlan: VoiceVisualPlan | null | undefined;
}): {outline: TeachingOutline; voiceVisualPlan: VoiceVisualPlan} {
  const review = narration.review;
  if (!review || narration.approvedSourceHash !== review.sourceHash) {
    throw new Error('Bản cách đọc chưa được duyệt.');
  }
  const beats = splitReviewedNarration(review.normalizedText);
  if (beats.length > pipelineSafetyLimits.maximumTotalBeats) {
    throw new Error(
      `Lời thoại quá dài cho một lượt sinh scene (tối đa ${pipelineSafetyLimits.maximumTotalBeats} nhịp).`,
    );
  }
  const sections = Array.from(
    {length: Math.ceil(beats.length / beatsPerSection)},
    (_, sectionIndex) => {
      const sectionBeats = beats.slice(
        sectionIndex * beatsPerSection,
        (sectionIndex + 1) * beatsPerSection,
      );
      const outlineSectionId = randomUUID();
      return {
        outline: {
          id: outlineSectionId,
          title: `Đoạn ${sectionIndex + 1}`,
          goal: 'Trình bày đúng nội dung lời thoại đã duyệt.',
          content: sectionBeats.join(' '),
          estimatedSeconds: Math.max(
            pipelineSafetyLimits.minimumSectionDurationSeconds,
            sectionBeats.reduce(
              (total, beat) => total + plannedBeatDurationSeconds(beat),
              0,
            ),
          ),
        },
        plan: {
          outlineSectionId,
          beats: sectionBeats.map(text => ({
            id: randomUUID(),
            voiceover: text,
            spokenVoiceover: text,
            visualDescription:
              'Phân tích trực tiếp ý nghĩa lời thoại của nhịp này để tạo visual rõ ràng, dễ hiểu.',
            animationDescription:
              'Chuyển động tối giản, bám nhịp thuyết minh và làm rõ ý chính.',
            visualHoldSeconds: 0,
            durationSeconds: plannedBeatDurationSeconds(
              text,
              0,
              DEFAULT_NARRATION_CALIBRATION,
            ),
          })),
        },
      };
    },
  );
  if (sections.length > pipelineSafetyLimits.maximumSections) {
    throw new Error('Lời thoại cần được chia thành nhiều project ngắn hơn.');
  }
  const narrationRevision = (previousPlan?.narrationRevision ?? 0) + 1;
  const generation = {
    generationId,
    provider: 'local' as const,
    tool: 'narration-structure' as const,
    algorithmVersion: NARRATION_STRUCTURE_VERSION,
    generatedAt: now,
  };
  const outline: TeachingOutline = {
    brief: {
      summary: `Video về ${topicInput.topic} được dựng từ lời thoại do người dùng cung cấp.`,
      assumptions: ['Không viết lại hay bổ sung nội dung lời thoại đã duyệt.'],
    },
    centralMessage: `Nội dung chính: ${topicInput.topic}`,
    sections: sections.map(section => section.outline),
    status: 'approved',
    contentRevision: (previousPlan?.sourceOutlineContentRevision ?? 0) + 1,
    sourceInput: topicInput,
    sourceNarrationHash: review.sourceHash,
    sourceNarrationRevision: narrationRevision,
    generation,
  };
  return {
    outline,
    voiceVisualPlan: {
      voiceDirection: 'Đọc nguyên văn bản cách đọc đã được duyệt.',
      visualDirection: 'AI phân tích trực tiếp lời thoại để sinh scene.',
      timingCalibration: {
        source: 'default',
        ...DEFAULT_NARRATION_CALIBRATION,
        voiceId: null,
        modelId: null,
        voiceName: null,
        sampleCount: 0,
      },
      sections: sections.map(section => section.plan),
      status: 'approved',
      contentRevision: (previousPlan?.contentRevision ?? 0) + 1,
      narrationRevision,
      sourceOutlineContentRevision: outline.contentRevision,
      sourceNarrationHash: review.sourceHash,
      sourceNarrationRevision: narrationRevision,
      generation,
    },
  };
}
