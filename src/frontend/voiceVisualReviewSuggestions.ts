import type {
  VoiceVisualBeatField,
  VoiceVisualCandidateRecord,
  VoiceVisualCoherenceReview,
} from '../shared/voiceVisualHistory.ts';
import type {VoiceVisualPlanContent} from '../shared/topic.ts';

export interface VoiceVisualReviewSuggestionPreparation {
  selectedBeatFields: Record<string, VoiceVisualBeatField[]>;
  guidance: string;
  protectedFieldCount: number;
}

function fieldsForIssue(
  category: VoiceVisualCoherenceReview['issues'][number]['category'],
): VoiceVisualBeatField[] {
  if (category === 'visual_consistency') {
    return ['visualDescription', 'animationDescription'];
  }
  if (category === 'voice_visual_alignment') {
    return ['voiceover', 'spokenVoiceover', 'visualDescription'];
  }
  if (category === 'timing') {
    return ['voiceover', 'spokenVoiceover', 'visualHoldSeconds'];
  }
  if (category === 'scope') {
    return [
      'voiceover',
      'spokenVoiceover',
      'visualDescription',
      'animationDescription',
    ];
  }
  return ['voiceover', 'spokenVoiceover'];
}

export function prepareVoiceVisualReviewSuggestions({
  coherence,
  content,
  sourceCandidate,
  onlyScopeExpansion = false,
}: {
  coherence: VoiceVisualCoherenceReview;
  content: VoiceVisualPlanContent;
  sourceCandidate: VoiceVisualCandidateRecord | null;
  onlyScopeExpansion?: boolean;
}): VoiceVisualReviewSuggestionPreparation {
  const beats = content.sections.flatMap(section => section.beats);
  const validBeatIds = new Set(beats.map(beat => beat.id));
  const protectedBeatFields = new Map<string, Set<VoiceVisualBeatField>>();
  if (sourceCandidate) {
    for (const beatPatch of sourceCandidate.patch.beats) {
      const fields = new Set<VoiceVisualBeatField>();
      for (const field of [
        'voiceover',
        'spokenVoiceover',
        'visualDescription',
        'animationDescription',
        'visualHoldSeconds',
      ] as const) {
        if (beatPatch[field] != null) fields.add(field);
      }
      protectedBeatFields.set(beatPatch.beatId, fields);
    }
  }

  const selectedBeatFields: Record<string, VoiceVisualBeatField[]> = {};
  const issues = coherence.issues.filter(
    issue => !onlyScopeExpansion || issue.requiresScopeExpansion,
  );
  const protectedFields = new Set<string>();
  for (const issue of issues) {
    const fields = fieldsForIssue(issue.category);
    for (const beatId of issue.affectedBeatIds) {
      if (!validBeatIds.has(beatId)) continue;
      const allowedFields = fields.filter(field => {
        const protectedField =
          protectedBeatFields.get(beatId)?.has(field) ?? false;
        if (protectedField) protectedFields.add(`${beatId}:${field}`);
        return !protectedField;
      });
      if (allowedFields.length === 0) continue;
      selectedBeatFields[beatId] = [
        ...new Set([
          ...(selectedBeatFields[beatId] ?? []),
          ...allowedFields,
        ]),
      ];
    }
  }

  if (
    onlyScopeExpansion &&
    Object.keys(selectedBeatFields).length === 0 &&
    sourceCandidate
  ) {
    const selectedIds = new Set(
      sourceCandidate.scope.beats.map(beat => beat.beatId),
    );
    const selectedIndexes = beats
      .map((beat, index) => selectedIds.has(beat.id) ? index : -1)
      .filter(index => index >= 0);
    for (const index of selectedIndexes) {
      const previous = beats[index - 1];
      const next = beats[index + 1];
      if (
        previous &&
        !protectedBeatFields.get(previous.id)?.has('voiceover')
      ) {
        selectedBeatFields[previous.id] = [
          'voiceover',
          'spokenVoiceover',
        ];
      }
      if (next && !protectedBeatFields.get(next.id)?.has('voiceover')) {
        selectedBeatFields[next.id] = [
          'voiceover',
          'spokenVoiceover',
        ];
      }
    }
  }

  const fixes = issues
    .map(issue => issue.suggestedFix.trim())
    .filter(Boolean);
  return {
    selectedBeatFields,
    protectedFieldCount: protectedFields.size,
    guidance: [
      sourceCandidate
        ? 'Tiếp tục từ candidate hiện tại, giữ nguyên mọi phần đã tốt và chỉ xử lý các field mới mà reviewer nêu.'
        : 'Chỉ xử lý các điểm reviewer nêu trên bản hiện tại, không viết lại phần đang tốt.',
      ...new Set(fixes),
    ]
      .join(' '),
  };
}
