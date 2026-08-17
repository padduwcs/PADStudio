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

/** Metadata marker for the slim, narration-first production path. */
export const DIRECT_NARRATION_PROMPT_VERSION = 'direct-narration-v1';

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

  // Legacy scene artifacts require at least 12 characters per beat. Joining a
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

export function isDirectNarrationPlan(
  outline: TeachingOutline | null | undefined,
  plan: VoiceVisualPlan | null | undefined,
) {
  return Boolean(
    outline?.generation.promptVersion === DIRECT_NARRATION_PROMPT_VERSION &&
      plan?.generation.promptVersion === DIRECT_NARRATION_PROMPT_VERSION,
  );
}

export function directPlanMatchesNarration(
  project: Pick<TopicProject, 'outline' | 'voiceVisualPlan' | 'narration'>,
) {
  return Boolean(
    project.narration?.review &&
      project.narration.approvedSourceHash === project.narration.review.sourceHash &&
      isDirectNarrationPlan(project.outline, project.voiceVisualPlan) &&
      project.outline?.generation.requestedModel === project.narration.approvedSourceHash &&
      project.voiceVisualPlan?.generation.requestedModel === project.narration.approvedSourceHash,
  );
}

export function directNarrationMatchesSource(
  narration: NarrationDocument,
  plan: VoiceVisualPlan,
) {
  const planText = plan.sections
    .flatMap(section => section.beats)
    .map(beat => beat.spokenVoiceover ?? beat.voiceover)
    .join(' ');
  return compactWhitespace(planText) === compactWhitespace(narration.review?.normalizedText ?? '');
}

export function createDirectNarrationArtifacts({
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
    provider: 'codex' as const,
    model: 'internal-narration-structure',
    requestedModel: review.sourceHash,
    promptVersion: DIRECT_NARRATION_PROMPT_VERSION,
    generatedAt: now,
    usage: null,
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
      generation,
    },
  };
}
