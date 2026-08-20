import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {
  createNarrationArtifacts,
  narrationPlanMatchesReviewedNarration,
  narrationArtifactsMatchReview,
  planNarrationArtifacts,
  validateSemanticVisualPlan,
} from './narrationPlan.ts';
import type {VoiceVisualPlanContent} from '../shared/topic.ts';
import type {NarrationVisualPlannerService} from './narrationVisualPlanner.ts';
import {TeachingOutlineSchema, VoiceVisualPlanSchema, type NarrationDocument} from '../shared/topic.ts';

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

test('semantic plan rejects three active block containers before Motion Canvas generation', () => {
  const narration = plannerNarration();
  const {outline, voiceVisualPlan} = createNarrationArtifacts({topicInput: plannerTopicInput, narration, generationId: '10000000-0000-4000-8000-000000000099', now: '2026-01-01T00:00:00.000Z', previousPlan: null});
  const beat = voiceVisualPlan.sections[0]!.beats[0]!;
  beat.visualLifecycle = {...beat.visualLifecycle!, stay: ['block-one', 'block-two', 'block-three']};
  assert.throws(() => validateSemanticVisualPlan(narration, outline, voiceVisualPlan), /maximum active block/i);
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
    sourceText: 'Độ phức tạp là O(n). Logarithm đọc là logarithm.',
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
        primaryBlock: 'block-concept-card' as const,
        visualLifecycle: {enter: ['block-concept-card'], stay: ['block-concept-card', 'concept-label'], exit: ['block-concept-card']},
        compositionContract: {
          visualFocus: 'Khối khái niệm trung tâm giữ toàn bộ sự chú ý của beat này.',
          hierarchy: ['block-concept-card', 'concept-label'],
          semanticRole: 'claim' as const,
          layout: 'center-focus' as const,
          density: 'balanced' as const,
          spacingNotes: 'Giữ khoảng thở rộng quanh khối trung tâm và giữa các nhãn.',
        },
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
  let plannerSemanticSource = '';
  let plannerUnits: Array<{text: string; semanticText: string}> = [];
  const planner: NarrationVisualPlannerService = {
    async plan(request) {
      plannerSemanticSource = request.semanticSourceText;
      plannerUnits = request.units;
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
  assert.equal(plannerSemanticSource, narration.sourceText);
  assert.deepEqual(plannerUnits.map(unit => unit.semanticText), [
    'Độ phức tạp là O(n).',
    'Logarithm đọc là logarithm.',
  ]);
  assert.deepEqual(
    voiceVisualPlan.sections.flatMap(section => section.beats).map(beat => beat.voiceover),
    plannerUnits.map(unit => unit.semanticText),
  );
  assert.deepEqual(
    voiceVisualPlan.sections.flatMap(section => section.beats).map(beat => beat.spokenVoiceover),
    plannerUnits.map(unit => unit.text),
  );
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

const historicalCalibration: VoiceVisualPlanContent['timingCalibration'] = {
  source: 'voice-history',
  whitespaceTokensPerMinute: 260,
  charactersPerSecond: 19,
  voiceId: 'voice-a',
  modelId: 'model-a',
  voiceName: 'Voice A',
  sampleCount: 3,
};

test('createNarrationArtifacts dùng historical calibration khi được truyền vào thay vì default', () => {
  const narration = plannerNarration();
  const withDefault = createNarrationArtifacts({
    topicInput: plannerTopicInput,
    narration,
    generationId: '10000000-0000-4000-8000-000000000006',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
  });
  const withHistory = createNarrationArtifacts({
    topicInput: plannerTopicInput,
    narration,
    generationId: '10000000-0000-4000-8000-000000000007',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
    timingCalibration: historicalCalibration,
  });

  assert.deepEqual(withHistory.voiceVisualPlan.timingCalibration, historicalCalibration);
  assert.equal(withDefault.voiceVisualPlan.timingCalibration.source, 'default');
  // Historical calibration reads faster (higher tokens/characters per
  // second), so the same narration must plan to a shorter beat duration.
  const defaultDuration = withDefault.voiceVisualPlan.sections[0]!.beats[0]!.durationSeconds;
  const historyDuration = withHistory.voiceVisualPlan.sections[0]!.beats[0]!.durationSeconds;
  assert.ok(historyDuration <= defaultDuration);
  assert.notDeepEqual(withHistory.voiceVisualPlan.timingCalibration, withDefault.voiceVisualPlan.timingCalibration);
});

test('planNarrationArtifacts giữ nguyên historical calibration ở cả nhánh AI và fallback', async () => {
  const narration = plannerNarration();
  const failingPlanner: NarrationVisualPlannerService = {
    async plan() { throw new Error('planner unavailable'); },
  };
  const fallback = await planNarrationArtifacts({
    planner: failingPlanner,
    topicInput: plannerTopicInput,
    narration,
    generationId: '10000000-0000-4000-8000-000000000008',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
    timingCalibration: historicalCalibration,
  });
  assert.deepEqual(fallback.voiceVisualPlan.timingCalibration, historicalCalibration);

  const workingPlanner: NarrationVisualPlannerService = {
    async plan(request) {
      return {
        output: validPlannerOutput(request.units.map(unit => unit.id)),
        model: 'fake-planner-model',
        usage: null,
      };
    },
  };
  const aiPlanned = await planNarrationArtifacts({
    planner: workingPlanner,
    topicInput: plannerTopicInput,
    narration,
    generationId: '10000000-0000-4000-8000-000000000009',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
    timingCalibration: historicalCalibration,
  });
  assert.deepEqual(aiPlanned.voiceVisualPlan.timingCalibration, historicalCalibration);
});

test('composition contract is planned, ranked against the lifecycle, and required by the gate', () => {
  const narration = plannerNarration();
  const {outline, voiceVisualPlan} = createNarrationArtifacts({topicInput: plannerTopicInput, narration, generationId: '10000000-0000-4000-8000-000000000101', now: '2026-01-01T00:00:00.000Z', previousPlan: null});
  const beat = voiceVisualPlan.sections[0]!.beats[0]!;
  const contract = beat.compositionContract!;
  assert.equal(contract.hierarchy[0], beat.primaryBlock);
  assert.ok(contract.hierarchy.every(key => beat.visualLifecycle!.stay.includes(key)));
  assert.equal(contract.layout, 'center-focus');
  assert.equal(contract.density, 'balanced');
  assert.equal(narrationArtifactsMatchReview({outline, voiceVisualPlan, narration}), true);

  const missing = structuredClone(voiceVisualPlan);
  delete missing.sections[0]!.beats[0]!.compositionContract;
  assert.throws(() => validateSemanticVisualPlan(narration, outline, missing), /composition contract/i);
  assert.equal(narrationArtifactsMatchReview({outline, voiceVisualPlan: missing, narration}), false);

  const misranked = structuredClone(voiceVisualPlan);
  misranked.sections[0]!.beats[0]!.compositionContract!.hierarchy = ['concept-label', 'block-concept-card'];
  assert.throws(() => validateSemanticVisualPlan(narration, outline, misranked), /composition contract/i);
});

test('Visual Plan cũ vẫn hợp lệ và có thể tiếp tục sinh scene sau khi planner được nâng cấp', async () => {
  const narration = plannerNarration();
  const planner: NarrationVisualPlannerService = {
    async plan(request) {
      return {
        output: validPlannerOutput(request.units.map(unit => unit.id)),
        model: 'legacy-planner-model',
        usage: null,
      };
    },
  };
  const {outline, voiceVisualPlan} = await planNarrationArtifacts({
    planner,
    topicInput: plannerTopicInput,
    narration,
    generationId: '10000000-0000-4000-8000-000000000102',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
  });
  const legacyPlan = structuredClone(voiceVisualPlan);
  if (legacyPlan.generation.provider === 'codex') {
    legacyPlan.generation.promptVersion = 'narration-visual-planner-v3';
  }
  for (const beat of legacyPlan.sections.flatMap(section => section.beats)) {
    beat.voiceover = beat.spokenVoiceover ?? beat.voiceover;
  }

  assert.equal(narrationPlanMatchesReviewedNarration(narration, legacyPlan), true);
  assert.equal(narrationArtifactsMatchReview({outline, voiceVisualPlan: legacyPlan, narration}), true);
});

test('semantic plan keeps short topic names valid for persisted outlines', () => {
  const narration = plannerNarration();
  const {outline} = createNarrationArtifacts({
    topicInput: {...plannerTopicInput, topic: 'Recursion'},
    narration,
    generationId: '10000000-0000-4000-8000-000000000010',
    now: '2026-01-01T00:00:00.000Z',
    previousPlan: null,
  });

  assert.equal(TeachingOutlineSchema.safeParse(outline).success, true);
  assert.equal(outline.centralMessage, 'Nội dung cốt lõi của Recursion.');
});

test('beat schema rejects a hierarchy that contradicts primaryBlock or the lifecycle', () => {
  const narration = plannerNarration();
  const {voiceVisualPlan} = createNarrationArtifacts({topicInput: plannerTopicInput, narration, generationId: '10000000-0000-4000-8000-000000000102', now: '2026-01-01T00:00:00.000Z', previousPlan: null});
  assert.doesNotThrow(() => VoiceVisualPlanSchema.parse(voiceVisualPlan));

  const wrongDominant = structuredClone(voiceVisualPlan);
  wrongDominant.sections[0]!.beats[0]!.compositionContract!.hierarchy = ['concept-label', 'block-concept-card'];
  assert.throws(() => VoiceVisualPlanSchema.parse(wrongDominant), /hierarchy phải chính là primaryBlock/);

  const offstage = structuredClone(voiceVisualPlan);
  offstage.sections[0]!.beats[0]!.compositionContract!.hierarchy = ['block-concept-card', 'block-not-on-stage'];
  assert.throws(() => VoiceVisualPlanSchema.parse(offstage), /visualLifecycle\.stay/);

  const tooShort = structuredClone(voiceVisualPlan);
  tooShort.sections[0]!.beats[0]!.compositionContract!.hierarchy = ['block-concept-card'];
  assert.throws(() => VoiceVisualPlanSchema.parse(tooShort));

  const badRole = structuredClone(voiceVisualPlan) as unknown as {sections: Array<{beats: Array<{compositionContract: {semanticRole: string}}>}>};
  badRole.sections[0]!.beats[0]!.compositionContract.semanticRole = 'vibes';
  assert.throws(() => VoiceVisualPlanSchema.parse(badRole));
});
