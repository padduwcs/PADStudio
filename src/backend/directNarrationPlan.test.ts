import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {
  createDirectNarrationArtifacts,
  directNarrationMatchesSource,
  directPlanMatchesNarration,
} from './directNarrationPlan.ts';
import type {NarrationDocument} from '../shared/topic.ts';

const sourceHash = createHash('sha256').update('review').digest('hex');

test('direct narration artifacts preserve the reviewed words without an authored outline', () => {
  const narration: NarrationDocument = {
    sourceText: 'Bản gốc.',
    projectRules: [],
    review: {
      sourceText: 'Bản gốc.',
      normalizedText: 'O en mở ngoặc n đóng ngoặc. Logarithm đọc là lô-ga-rít.',
      rules: [],
      aiPatches: [],
      sourceHash,
      rulesHash: sourceHash,
      reviewedAt: '2026-01-01T00:00:00.000Z',
    },
    approvedSourceHash: sourceHash,
    approvedAt: '2026-01-01T00:00:00.000Z',
  };
  const {outline, voiceVisualPlan} = createDirectNarrationArtifacts({
    topicInput: {
      topic: 'Độ phức tạp thuật toán',
      background: {mode: 'dark', color: '#10231D'},
      audience: 'beginner',
      duration: 'standard',
    },
    narration,
    generationId: '10000000-0000-4000-8000-000000000001',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
  });

  assert.equal(outline.status, 'approved');
  assert.equal(voiceVisualPlan.status, 'approved');
  assert.equal(
    voiceVisualPlan.sections.flatMap(section => section.beats)
      .map(beat => beat.spokenVoiceover).join(' '),
    narration.review!.normalizedText,
  );
  assert.equal(directNarrationMatchesSource(narration, voiceVisualPlan), true);
  assert.equal(directPlanMatchesNarration({
    outline,
    voiceVisualPlan,
    narration,
  }), true);
});
