import type {
  VoiceVisualCandidateRecord,
  VoiceVisualHistoryResponse,
} from '../shared/voiceVisualHistory.ts';

export function voiceVisualCandidateIsCurrent(
  candidate: VoiceVisualCandidateRecord | null,
  history: VoiceVisualHistoryResponse | null,
) {
  return Boolean(
    candidate?.decision === 'pending' &&
      history &&
      candidate.rootBaseContextHash === history.currentContextHash &&
      candidate.rootBaseContentHash === history.currentContentHash,
  );
}
