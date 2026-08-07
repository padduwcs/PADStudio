import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  VoiceVisualCandidateRecord,
  VoiceVisualHistoryResponse,
} from '../shared/voiceVisualHistory.ts';
import {voiceVisualCandidateIsCurrent} from './voiceVisualWorkflowState.ts';

test('candidate chỉ còn thao tác được khi cả outline context và bản nền còn hiện hành', () => {
  const candidate = {
    decision: 'pending',
    rootBaseContextHash: 'context-a',
    rootBaseContentHash: 'content-a',
  } as VoiceVisualCandidateRecord;
  const history = {
    currentContextHash: 'context-a',
    currentContentHash: 'content-a',
  } as VoiceVisualHistoryResponse;

  assert.equal(voiceVisualCandidateIsCurrent(candidate, history), true);
  assert.equal(
    voiceVisualCandidateIsCurrent(candidate, {
      ...history,
      currentContentHash: 'content-b',
    }),
    false,
  );
  assert.equal(
    voiceVisualCandidateIsCurrent(candidate, {
      ...history,
      currentContextHash: 'context-b',
    }),
    false,
  );
});
