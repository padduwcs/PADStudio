import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  OutlineAiPatch,
  OutlineCandidateRecord,
  OutlineEditScope,
} from '../shared/outlineHistory.ts';
import type {
  TeachingOutline,
  TeachingOutlineContent,
} from '../shared/topic.ts';
import {
  createFileOutlineHistoryStore,
  hashOutlineContent,
} from './outlineHistoryStore.ts';
import {
  applyOutlinePatch,
  constrainOutlinePatch,
  OutlineRevisionError,
} from './outlineRevisionService.ts';

const firstSectionId = '11111111-1111-4111-8111-111111111111';
const secondSectionId = '22222222-2222-4222-8222-222222222222';

function content(): TeachingOutlineContent {
  return {
    brief: {
      summary: 'Video giúp người mới hiểu trực giác tìm kiếm nhị phân.',
      assumptions: ['Mảng đầu vào đã được sắp xếp.'],
    },
    centralMessage: 'Mỗi lần so sánh sẽ loại bỏ một nửa vùng tìm kiếm.',
    sections: [
      {
        id: firstSectionId,
        title: 'Đặt vấn đề',
        goal: 'Nhận ra giới hạn của cách tìm tuần tự.',
        content: 'Bắt đầu từ nhu cầu tìm một số trong danh sách rất dài.',
        estimatedSeconds: 60,
      },
      {
        id: secondSectionId,
        title: 'Chia đôi',
        goal: 'Hiểu cách thu hẹp vùng tìm kiếm sau mỗi bước.',
        content: 'So sánh với phần tử giữa rồi chỉ giữ lại nửa phù hợp.',
        estimatedSeconds: 90,
      },
    ],
  };
}

function outline(): TeachingOutline {
  return {
    ...content(),
    status: 'draft',
    contentRevision: 1,
    sourceInput: {
      topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
      background: {mode: 'dark', color: '#10231D'},
      audience: 'beginner',
      duration: 'standard',
    },
    generation: {
      generationId: '33333333-3333-4333-8333-333333333333',
      provider: 'codex',
      model: 'test-model',
      promptVersion: 'outline-v3',
      generatedAt: '2026-07-21T00:00:00.000Z',
      usage: null,
    },
  };
}

const scope: OutlineEditScope = {
  globalFields: [],
  sections: [{sectionId: firstSectionId, fields: ['content']}],
};

function patch(overrides: Partial<OutlineAiPatch> = {}): OutlineAiPatch {
  return {
    editSummary: 'Làm ví dụ mở đầu trực quan hơn.',
    brief: {summary: null, assumptions: null},
    centralMessage: null,
    sections: [
      {
        sectionId: firstSectionId,
        title: null,
        goal: null,
        content:
          'Mở đầu bằng tình huống tìm một tên trong danh sách hàng nghìn mục để làm rõ chi phí tìm tuần tự.',
        estimatedSeconds: null,
      },
    ],
    ...overrides,
  };
}

test('applyOutlinePatch chỉ thay đổi trường được cấp quyền và giữ nguyên phần còn lại', () => {
  const base = content();
  const next = applyOutlinePatch(base, scope, patch());

  assert.notEqual(next.sections[0]?.content, base.sections[0]?.content);
  assert.deepEqual(next.sections[1], base.sections[1]);
  assert.equal(next.sections[0]?.id, firstSectionId);
  assert.equal(next.centralMessage, base.centralMessage);
  assert.deepEqual(base, content(), 'không được mutate snapshot nền');
});

test('applyOutlinePatch từ chối thay đổi ngoài phạm vi', () => {
  assert.throws(
    () =>
      applyOutlinePatch(
        content(),
        scope,
        patch({centralMessage: 'Thông điệp bị sửa ngoài phạm vi cho phép.'}),
      ),
    (error: unknown) =>
      error instanceof OutlineRevisionError &&
      error.code === 'OUTLINE_PATCH_OUT_OF_SCOPE',
  );
});

test('constrainOutlinePatch tự loại bỏ thay đổi AI viết ngoài phạm vi', () => {
  const base = content();
  const constrained = constrainOutlinePatch(
    base,
    scope,
    patch({
      brief: {
        summary: base.brief.summary,
        assumptions: ['Giả định bị AI tự ý thay đổi.'],
      },
      centralMessage: 'Thông điệp bị AI tự ý thay đổi ngoài phạm vi.',
    }),
  );

  assert.deepEqual(constrained.brief, {summary: null, assumptions: null});
  assert.equal(constrained.centralMessage, null);
  const next = applyOutlinePatch(base, scope, constrained);
  assert.notEqual(next.sections[0]?.content, base.sections[0]?.content);
  assert.deepEqual(next.brief, base.brief);
  assert.equal(next.centralMessage, base.centralMessage);
});

test('outline history lưu snapshot bất biến, chống trùng baseline và giữ candidate riêng', async context => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-outline-history-'),
  );
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const store = createFileOutlineHistoryStore(projectsDirectory);
  const projectId = 'du-an-test';
  const artifact = outline();

  const first = await store.ensureVersion({
    projectId,
    origin: 'baseline',
    label: 'Bản hiện tại',
    parentVersionId: null,
    restoredFromVersionId: null,
    candidateId: null,
    projectRevision: 2,
    contentHash: hashOutlineContent(artifact),
    artifact,
  });
  const duplicate = await store.ensureVersion({
    projectId,
    origin: 'baseline',
    label: 'Tên khác không tạo bản trùng',
    parentVersionId: null,
    restoredFromVersionId: null,
    candidateId: null,
    projectRevision: 2,
    contentHash: hashOutlineContent(artifact),
    artifact,
  });
  assert.equal(duplicate.versionId, first.versionId);
  assert.equal((await store.listVersions(projectId)).length, 1);

  const candidateContent = applyOutlinePatch(content(), scope, patch());
  const candidate: OutlineCandidateRecord = {
    candidateId: randomUUID(),
    projectId,
    createdAt: '2026-07-21T01:00:00.000Z',
    status: 'ready',
    decision: 'pending',
    decidedAt: null,
    appliedVersionId: null,
    baseVersionId: first.versionId,
    parentCandidateId: null,
    rootBaseContentHash: first.contentHash,
    baseContentHash: first.contentHash,
    rootBaseContextHash: 'b'.repeat(64),
    baseContextHash: 'b'.repeat(64),
    baseProjectRevision: 2,
    candidateContentHash: hashOutlineContent(candidateContent),
    requestFingerprint: 'a'.repeat(64),
    guidance: 'Làm ví dụ mở đầu trực quan hơn.',
    scope,
    patch: patch(),
    content: candidateContent,
    coherence: {
      verdict: 'coherent',
      summary: 'Bản ghép giữ được logic và chuyển tiếp của toàn bài.',
      issues: [],
    },
    generation: {
      provider: 'codex',
      model: 'test-model',
      requestedModel: null,
      reasoningEffort: null,
      promptVersion: 'outline-edit-v1',
      generatedAt: '2026-07-21T01:00:00.000Z',
      editorUsage: null,
      reviewerUsage: null,
    },
  };
  await store.saveCandidate(candidate);

  const storedCandidate = await store.getCandidate(
    projectId,
    candidate.candidateId,
  );
  assert.deepEqual(storedCandidate, candidate);
  const rejected = await store.setCandidateDecision(
    projectId,
    candidate.candidateId,
    'rejected',
  );
  assert.equal(rejected.decision, 'rejected');
  assert.ok(rejected.decidedAt);
  assert.equal(rejected.appliedVersionId, null);
  assert.equal((await store.listVersions(projectId)).length, 1);
  assert.equal((await store.listCandidates(projectId)).length, 1);

  const orphanCandidateId = randomUUID();
  const orphanDirectory = path.join(
    projectsDirectory,
    projectId,
    'history',
    'outline',
    'candidates',
    orphanCandidateId,
  );
  await mkdir(orphanDirectory, {recursive: true});
  await writeFile(
    path.join(orphanDirectory, 'artifact.json'),
    JSON.stringify(content()),
    'utf8',
  );
  await assert.rejects(
    store.saveCandidate({
      ...candidate,
      candidateId: orphanCandidateId,
      decision: 'pending',
      decidedAt: null,
      requestFingerprint: 'c'.repeat(64),
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'OUTLINE_HISTORY_IMMUTABLE_CONFLICT',
  );
});
