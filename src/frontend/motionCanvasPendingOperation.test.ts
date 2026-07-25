import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {
  clearPendingMotionCanvasCandidateOperation,
  readPendingMotionCanvasCandidateOperation,
  shouldRetainPendingMotionCanvasCandidateOperation,
  writePendingMotionCanvasCandidateOperation,
  type PendingMotionCanvasCandidateOperation,
} from './motionCanvasPendingOperation.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    values,
  };
}

function operation(
  projectId: string,
  savedAt: number,
): PendingMotionCanvasCandidateOperation {
  return {
    version: 1,
    projectId,
    expectedRevision: 12,
    request: {
      generationId: randomUUID(),
      guidance: 'Làm rõ phép so sánh ở scene đã chọn.',
      scope: {sceneIds: [randomUUID()]},
      model: 'gpt-test',
      reasoningEffort: 'high',
    },
    reviewerRepairGenerationId: randomUUID(),
    savedAt,
  };
}

test('pending Motion candidate sống qua reload trong cùng session', () => {
  const storage = memoryStorage();
  const projectId = 'binary-search';
  const pending = operation(projectId, 10_000);

  writePendingMotionCanvasCandidateOperation(pending, storage);

  assert.deepEqual(
    readPendingMotionCanvasCandidateOperation(projectId, {
      storage,
      now: 11_000,
    }),
    pending,
  );
});

test('pending Motion candidate cũ hoặc hỏng không tự gọi lại Codex', () => {
  const storage = memoryStorage();
  const projectId = 'binary-search';
  writePendingMotionCanvasCandidateOperation(
    operation(projectId, 10_000),
    storage,
  );

  assert.equal(
    readPendingMotionCanvasCandidateOperation(projectId, {
      storage,
      now: 10_000 + 24 * 60 * 60 * 1_000 + 1,
    }),
    null,
  );
  assert.equal(storage.values.size, 0);

  storage.setItem(
    'pad-studio:motion-canvas-candidate:binary-search',
    '{"version":1,"projectId":"binary-search","request":{}}',
  );
  assert.equal(
    readPendingMotionCanvasCandidateOperation(projectId, {storage}),
    null,
  );
  assert.equal(storage.values.size, 0);
});

test('chỉ completion đúng generation mới được xóa pending operation', () => {
  const storage = memoryStorage();
  const projectId = 'binary-search';
  const pending = operation(projectId, Date.now());
  writePendingMotionCanvasCandidateOperation(pending, storage);

  clearPendingMotionCanvasCandidateOperation(
    projectId,
    randomUUID(),
    storage,
  );
  assert.ok(
    readPendingMotionCanvasCandidateOperation(projectId, {storage}),
  );

  clearPendingMotionCanvasCandidateOperation(
    projectId,
    pending.request.generationId,
    storage,
  );
  assert.equal(
    readPendingMotionCanvasCandidateOperation(projectId, {storage}),
    null,
  );
});

test('chỉ giữ pending operation khi kết quả request còn mơ hồ', () => {
  assert.equal(
    shouldRetainPendingMotionCanvasCandidateOperation({status: 0}),
    true,
  );
  assert.equal(
    shouldRetainPendingMotionCanvasCandidateOperation(new TypeError('fetch failed')),
    true,
  );
  assert.equal(
    shouldRetainPendingMotionCanvasCandidateOperation({status: 409}),
    false,
  );
});
