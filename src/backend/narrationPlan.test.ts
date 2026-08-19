import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {
  createNarrationArtifacts,
  narrationPlanMatchesReviewedNarration,
  narrationArtifactsMatchReview,
  planNarrationArtifacts,
} from './narrationPlan.ts';
import type {NarrationVisualPlannerService} from './narrationVisualPlanner.ts';
import {VoiceVisualPlanSchema, type NarrationDocument} from '../shared/topic.ts';

const sourceHash = createHash('sha256').update('review').digest('hex');

test('semantic plan preserves reviewed words while adding meaningful visual blueprint', () => {
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
  const {outline, voiceVisualPlan} = createNarrationArtifacts({
    topicInput: {
      topic: 'Độ phức tạp thuật toán',
      background: {mode: 'dark', color: '#10231D'},
      videoFrame: {aspectRatio: 'portrait', width: 1080, height: 1920, fps: 30},
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
  assert.equal(narrationPlanMatchesReviewedNarration(narration, voiceVisualPlan), true);
  assert.ok(outline.sections.every(section => !/^Đoạn\s+\d+$/u.test(section.title)));
  assert.ok(outline.sections.every(section => !section.goal.includes('đúng nội dung')));
  assert.ok(voiceVisualPlan.visualBible?.visualAnchor.includes('Độ phức tạp'));
  assert.ok(voiceVisualPlan.sections.every(section => section.beats.every(beat =>
    Boolean(beat.visualPurpose && beat.visualDescription && beat.animationDescription),
  )));
  assert.equal(narrationArtifactsMatchReview({
    outline,
    voiceVisualPlan,
    narration,
  }), true);
});

const plannerTopicInput = {
  topic: 'Độ phức tạp thuật toán',
  background: {mode: 'dark' as const, color: '#10231D'},
  videoFrame: {aspectRatio: 'portrait' as const, width: 1080, height: 1920, fps: 30 as const},
  audience: 'beginner' as const,
  duration: 'standard' as const,
};

function plannerNarration(): NarrationDocument {
  return {
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
}

function validPlannerOutput(unitIds: string[]) {
  return {
    scenes: [{
      title: 'AI scene title',
      goal: 'AI teaching goal cụ thể cho scene này.',
      stateHandoffIncoming: null,
      stateHandoffOutgoing: null,
      units: unitIds.map(unitId => ({
        unitId,
        visualPurpose: 'Biến ý chính của câu thành một quan hệ nhìn thấy được.',
        visualDescription: 'Một sơ đồ trung tâm minh họa quan hệ được nhắc tới.',
        animationDescription: 'Phần tử chính di chuyển vào vị trí rồi giữ hình.',
      })),
    }],
    visualBible: {
      palette: {surface: '#173B31', primary: '#51B68E', accent: '#F5C451', text: '#F7FBF8'},
      typographyScale: {title: 88, label: 42, body: 34},
      shapeLanguage: 'Thẻ bo góc nhất quán do AI chọn cho chủ đề này.',
      diagramLanguage: 'Sơ đồ trung tâm với nhãn ngắn do AI chọn.',
      motionTempo: 'Nhịp vừa, mỗi beat một chuyển động có chủ đích.',
      transitionConvention: 'Giữ anchor giữa các scene bằng fade ngắn.',
      visualAnchor: 'AI visual anchor xuyên suốt video này.',
    },
  };
}

test('planNarrationArtifacts dùng blueprint AI khi planner thành công', async () => {
  const narration = plannerNarration();
  const planner: NarrationVisualPlannerService = {
    async plan(request) {
      return {
        output: validPlannerOutput(request.units.map(unit => unit.id)),
        model: 'fake-planner-model',
        usage: null,
      };
    },
  };

  const {outline, voiceVisualPlan} = await planNarrationArtifacts({
    planner,
    topicInput: plannerTopicInput,
    narration,
    generationId: '10000000-0000-4000-8000-000000000002',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
  });

  assert.equal(outline.sections[0]?.title, 'AI scene title');
  assert.equal(outline.sections[0]?.goal, 'AI teaching goal cụ thể cho scene này.');
  assert.equal(voiceVisualPlan.visualBible?.visualAnchor, 'AI visual anchor xuyên suốt video này.');
  assert.equal(voiceVisualPlan.visualBible?.palette.background, plannerTopicInput.background.color);
  assert.deepEqual(voiceVisualPlan.sections[0]?.stateHandoff, {incoming: null, outgoing: null});
  assert.equal(voiceVisualPlan.generation.provider, 'codex');
  assert.deepEqual(voiceVisualPlan.plannerDiagnostics, [{stage: 'ai-plan', model: 'fake-planner-model', reason: null, outcome: 'used_ai'}]);
  assert.equal(narrationPlanMatchesReviewedNarration(narration, voiceVisualPlan), true);
});

test('planNarrationArtifacts fallback về deterministic planner khi AI lỗi', async () => {
  const narration = plannerNarration();
  const planner: NarrationVisualPlannerService = {
    async plan() {
      throw new Error('Codex service unavailable trong test.');
    },
  };

  const {outline, voiceVisualPlan} = await planNarrationArtifacts({
    planner,
    topicInput: plannerTopicInput,
    narration,
    generationId: '10000000-0000-4000-8000-000000000003',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
    model: 'requested-model',
  });

  assert.equal(voiceVisualPlan.generation.provider, 'local');
  assert.equal(outline.status, 'approved');
  assert.equal(voiceVisualPlan.plannerDiagnostics?.[0]?.stage, 'fallback');
  assert.equal(voiceVisualPlan.plannerDiagnostics?.[0]?.outcome, 'used_fallback');
  assert.equal(voiceVisualPlan.plannerDiagnostics?.[0]?.model, 'requested-model');
  assert.match(voiceVisualPlan.plannerDiagnostics?.[0]?.reason ?? '', /Codex service unavailable/);
  assert.equal(narrationPlanMatchesReviewedNarration(narration, voiceVisualPlan), true);
});

test('planNarrationArtifacts fallback khi AI bỏ sót một unit dù JSON hợp lệ', async () => {
  const narration = plannerNarration();
  const planner: NarrationVisualPlannerService = {
    async plan(request) {
      return {
        output: validPlannerOutput([request.units[0]!.id]),
        model: 'fake-planner-model',
        usage: null,
      };
    },
  };

  const {voiceVisualPlan} = await planNarrationArtifacts({
    planner,
    topicInput: plannerTopicInput,
    narration,
    generationId: '10000000-0000-4000-8000-000000000004',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
  });

  assert.equal(voiceVisualPlan.generation.provider, 'local');
  assert.equal(voiceVisualPlan.plannerDiagnostics?.[0]?.outcome, 'used_fallback');
  assert.equal(narrationPlanMatchesReviewedNarration(narration, voiceVisualPlan), true);
});

test('legacy VoiceVisualPlan thiếu plannerDiagnostics vẫn parse được', () => {
  const narration = plannerNarration();
  const {voiceVisualPlan} = createNarrationArtifacts({
    topicInput: plannerTopicInput,
    narration,
    generationId: '10000000-0000-4000-8000-000000000005',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
  });

  assert.equal('plannerDiagnostics' in voiceVisualPlan, false);
  const parsed = VoiceVisualPlanSchema.safeParse(voiceVisualPlan);
  assert.equal(parsed.success, true);
});
