import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  VoiceVisualCandidateRecord,
  VoiceVisualCoherenceReview,
} from '../shared/voiceVisualHistory.ts';
import type {VoiceVisualPlanContent} from '../shared/topic.ts';
import {prepareVoiceVisualReviewSuggestions} from './voiceVisualReviewSuggestions.ts';

const sectionId = '11111111-1111-4111-8111-111111111111';
const firstBeatId = '22222222-2222-4222-8222-222222222222';
const secondBeatId = '33333333-3333-4333-8333-333333333333';

const content: VoiceVisualPlanContent = {
  voiceDirection: 'Kể rõ ràng và gần gũi.',
  visualDirection: 'Giữ hệ màu nhất quán.',
  timingCalibration: {
    source: 'default',
    whitespaceTokensPerMinute: 135,
    charactersPerSecond: 12,
    voiceId: null,
    modelId: null,
    voiceName: null,
    sampleCount: 0,
  },
  sections: [
    {
      outlineSectionId: sectionId,
      beats: [
        {
          id: firstBeatId,
          voiceover: 'Ta bắt đầu với danh sách đã sắp xếp.',
          visualDescription: 'Phần tử giữa phát sáng.',
          animationDescription: 'Camera tiến gần phần tử giữa.',
          visualHoldSeconds: 0,
          durationSeconds: 8,
        },
        {
          id: secondBeatId,
          voiceover: 'Sau đó ta loại bỏ một nửa.',
          visualDescription: 'Một nửa danh sách mờ đi.',
          animationDescription: 'Vùng tìm kiếm co lại.',
          visualHoldSeconds: 0,
          durationSeconds: 8,
        },
      ],
    },
  ],
};

const candidate = {
  candidateId: '44444444-4444-4444-8444-444444444444',
  projectId: 'du-an-test',
  createdAt: '2026-07-22T00:00:00.000Z',
  status: 'scope_expansion_required',
  decision: 'pending',
  decidedAt: null,
  appliedVersionId: null,
  baseVersionId: '55555555-5555-4555-8555-555555555555',
  parentCandidateId: null,
  rootBaseContentHash: 'a'.repeat(64),
  baseContentHash: 'a'.repeat(64),
  rootBaseContextHash: 'b'.repeat(64),
  baseContextHash: 'b'.repeat(64),
  baseProjectRevision: 4,
  candidateContentHash: 'c'.repeat(64),
  requestFingerprint: 'd'.repeat(64),
  guidance: 'Làm visual beat đầu rõ hơn.',
  scope: {
    globalFields: [],
    beats: [{beatId: firstBeatId, fields: ['visualDescription']}],
  },
  patch: {
    editSummary: 'Làm visual beat đầu rõ hơn.',
    voiceDirection: null,
    visualDirection: null,
    beats: [
      {
        beatId: firstBeatId,
        voiceover: null,
        visualDescription: 'Phần tử giữa phát sáng rõ hơn.',
        animationDescription: null,
        visualHoldSeconds: null,
      },
    ],
  },
  content,
  coherence: {
    verdict: 'needs_scope_expansion',
    summary: 'Nên nối ngôn ngữ hình ảnh sang beat sau.',
    issues: [],
  },
  generation: {
    provider: 'codex',
    model: 'test-model',
    requestedModel: null,
    reasoningEffort: null,
    promptVersion: 'voice-visual-edit-v1',
    generatedAt: '2026-07-22T00:00:00.000Z',
    editorUsage: null,
    reviewerUsage: null,
  },
} satisfies VoiceVisualCandidateRecord;

test('gợi ý review tạo delta scope và khóa field candidate vừa thay đổi', () => {
  const coherence: VoiceVisualCoherenceReview = {
    verdict: 'warning',
    summary: 'Hai beat cần dùng visual và animation nhất quán hơn.',
    issues: [
      {
        severity: 'warning',
        category: 'visual_consistency',
        message: 'Cần nối ngôn ngữ hình ảnh giữa hai beat.',
        suggestedFix: 'Chỉnh animation beat đầu và visual beat sau.',
        affectedBeatIds: [firstBeatId, secondBeatId],
        requiresScopeExpansion: true,
      },
    ],
  };
  const prepared = prepareVoiceVisualReviewSuggestions({
    coherence,
    content,
    sourceCandidate: candidate,
  });

  assert.deepEqual(prepared.selectedBeatFields[firstBeatId], [
    'animationDescription',
  ]);
  assert.deepEqual(prepared.selectedBeatFields[secondBeatId], [
    'visualDescription',
    'animationDescription',
  ]);
  assert.equal(prepared.protectedFieldCount, 1);
  assert.match(prepared.guidance, /giữ nguyên mọi phần đã tốt/);
});

test('mở rộng phạm vi không tự mang scope cũ sang candidate con', () => {
  const coherence: VoiceVisualCoherenceReview = {
    verdict: 'needs_scope_expansion',
    summary: 'Chỉ beat sau cần được bổ sung.',
    issues: [
      {
        severity: 'warning',
        category: 'visual_consistency',
        message: 'Visual beat sau cần nối tiếp visual mở đầu.',
        suggestedFix: 'Chỉnh visual và animation của beat sau.',
        affectedBeatIds: [secondBeatId],
        requiresScopeExpansion: true,
      },
    ],
  };
  const prepared = prepareVoiceVisualReviewSuggestions({
    coherence,
    content,
    sourceCandidate: candidate,
    onlyScopeExpansion: true,
  });

  assert.equal(prepared.selectedBeatFields[firstBeatId], undefined);
  assert.deepEqual(prepared.selectedBeatFields[secondBeatId], [
    'visualDescription',
    'animationDescription',
  ]);
});
