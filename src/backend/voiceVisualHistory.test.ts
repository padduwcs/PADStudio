import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  VoiceVisualAiPatch,
  VoiceVisualCandidateRecord,
  VoiceVisualEditScope,
} from '../shared/voiceVisualHistory.ts';
import type {
  VoiceVisualPlan,
  VoiceVisualPlanContent,
} from '../shared/topic.ts';
import {
  createFileVoiceVisualHistoryStore,
  hashVoiceVisualContent,
} from './voiceVisualHistoryStore.ts';
import {
  applyVoiceVisualPatch,
  VoiceVisualRevisionError,
} from './voiceVisualRevisionService.ts';

const sectionId = '11111111-1111-4111-8111-111111111111';
const firstBeatId = '22222222-2222-4222-8222-222222222222';
const secondBeatId = '33333333-3333-4333-8333-333333333333';

function content(): VoiceVisualPlanContent {
  return {
    voiceDirection: 'Kể gần gũi, rõ ràng và đi thẳng vào trực giác.',
    visualDirection: 'Dùng danh sách và vùng tô sáng nhất quán.',
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
            voiceover: 'Hãy bắt đầu với một danh sách dài đã được sắp xếp.',
            visualDescription: 'Một danh sách số nằm ngang trên nền sáng.',
            animationDescription: 'Camera lướt nhẹ từ đầu tới cuối danh sách.',
            visualHoldSeconds: 0,
            durationSeconds: 8,
          },
          {
            id: secondBeatId,
            voiceover: 'Ta so sánh với phần tử giữa để bỏ đi một nửa.',
            visualDescription: 'Phần tử giữa sáng lên, nửa trái mờ dần.',
            animationDescription: 'Vùng tìm kiếm co lại quanh nửa còn phù hợp.',
            visualHoldSeconds: 1,
            durationSeconds: 9,
          },
        ],
      },
    ],
  };
}

function plan(): VoiceVisualPlan {
  return {
    ...content(),
    status: 'draft',
    contentRevision: 1,
    narrationRevision: 1,
    sourceOutlineContentRevision: 1,
    generation: {
      generationId: '44444444-4444-4444-8444-444444444444',
      provider: 'codex',
      model: 'test-model',
      promptVersion: 'voice-visual-v3',
      generatedAt: '2026-07-21T00:00:00.000Z',
      usage: null,
    },
  };
}

const scope: VoiceVisualEditScope = {
  globalFields: [],
  beats: [{beatId: firstBeatId, fields: ['visualDescription']}],
};

function patch(): VoiceVisualAiPatch {
  return {
    editSummary: 'Làm visual mở đầu trực quan hơn.',
    voiceDirection: null,
    visualDirection: null,
    beats: [
      {
        beatId: firstBeatId,
        voiceover: null,
        visualDescription:
          'Một danh sách hàng nghìn mục thu nhỏ thành dải dài trên nền sáng.',
        animationDescription: null,
        visualHoldSeconds: null,
      },
    ],
  };
}

test('patch voice–visual giữ nguyên ID, narration, timing và beat ngoài phạm vi', () => {
  const base = content();
  const next = applyVoiceVisualPatch(base, scope, patch());
  assert.notEqual(
    next.sections[0]?.beats[0]?.visualDescription,
    base.sections[0]?.beats[0]?.visualDescription,
  );
  assert.equal(next.sections[0]?.beats[0]?.id, firstBeatId);
  assert.equal(
    next.sections[0]?.beats[0]?.voiceover,
    base.sections[0]?.beats[0]?.voiceover,
  );
  assert.equal(
    next.sections[0]?.beats[0]?.durationSeconds,
    base.sections[0]?.beats[0]?.durationSeconds,
  );
  assert.deepEqual(next.sections[0]?.beats[1], base.sections[0]?.beats[1]);
  assert.deepEqual(base, content(), 'không được mutate snapshot nền');
});

test('patch voice–visual từ chối thay đổi ngoài phạm vi', () => {
  assert.throws(
    () =>
      applyVoiceVisualPatch(baseContent(), scope, {
        ...patch(),
        voiceDirection: 'Đổi giọng kể ngoài phạm vi đã cấp.',
      }),
    (error: unknown) =>
      error instanceof VoiceVisualRevisionError &&
      error.code === 'VOICE_VISUAL_PATCH_OUT_OF_SCOPE',
  );
});

function baseContent() {
  return content();
}

test('history voice–visual lưu version/candidate riêng và quyết định bất biến', async context => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-voice-visual-history-'),
  );
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const store = createFileVoiceVisualHistoryStore(projectsDirectory);
  const projectId = 'du-an-test';
  const artifact = plan();
  const version = await store.ensureVersion({
    projectId,
    origin: 'baseline',
    label: 'Bản hiện tại',
    parentVersionId: null,
    restoredFromVersionId: null,
    candidateId: null,
    projectRevision: 3,
    contentHash: hashVoiceVisualContent(artifact),
    artifact,
  });
  const candidateContent = applyVoiceVisualPatch(content(), scope, patch());
  const candidate: VoiceVisualCandidateRecord = {
    candidateId: randomUUID(),
    projectId,
    createdAt: '2026-07-21T01:00:00.000Z',
    status: 'ready',
    decision: 'pending',
    decidedAt: null,
    appliedVersionId: null,
    baseVersionId: version.versionId,
    parentCandidateId: null,
    rootBaseContentHash: version.contentHash,
    baseContentHash: version.contentHash,
    rootBaseContextHash: 'a'.repeat(64),
    baseContextHash: 'a'.repeat(64),
    baseProjectRevision: 3,
    candidateContentHash: hashVoiceVisualContent(candidateContent),
    requestFingerprint: 'b'.repeat(64),
    guidance: 'Làm visual mở đầu trực quan hơn.',
    scope,
    patch: patch(),
    content: candidateContent,
    coherence: {
      verdict: 'coherent',
      summary: 'Visual mới vẫn khớp lời kể và mạch hình ảnh toàn bài.',
      issues: [],
    },
    generation: {
      provider: 'codex',
      model: 'test-model',
      requestedModel: null,
      reasoningEffort: null,
      promptVersion: 'voice-visual-edit-v1',
      generatedAt: '2026-07-21T01:00:00.000Z',
      editorUsage: null,
      reviewerUsage: null,
    },
  };
  await store.saveCandidate(candidate);
  assert.deepEqual(
    await store.getCandidate(projectId, candidate.candidateId),
    candidate,
  );
  const accepted = await store.setCandidateDecision(
    projectId,
    candidate.candidateId,
    'accepted',
    version.versionId,
  );
  assert.equal(accepted.decision, 'accepted');
  assert.equal(accepted.appliedVersionId, version.versionId);
  await assert.rejects(
    store.setCandidateDecision(projectId, candidate.candidateId, 'rejected'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'VOICE_VISUAL_CANDIDATE_ALREADY_DECIDED',
  );
});
