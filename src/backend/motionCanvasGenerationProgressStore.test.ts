import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createFileMotionCanvasGenerationProgressStore} from './motionCanvasGenerationProgressStore.ts';

test('trạng thái sinh scene được lưu, cập nhật và hoàn tất', async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pad-scene-progress-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  let clock = '2026-08-23T10:00:00.000Z';
  const store = createFileMotionCanvasGenerationProgressStore(root, {
    now: () => clock,
    serverInstanceId: randomUUID(),
  });
  const generationId = randomUUID();

  await store.start({projectId: 'short-demo', generationId, totalScenes: 3});
  clock = '2026-08-23T10:00:01.000Z';
  await store.update('short-demo', generationId, {
    stage: 'generating-scenes',
    message: 'Đã xử lý 2/3 scene.',
    completedScenes: 2,
  });
  const running = await store.get('short-demo');
  assert.equal(running?.state, 'running');
  assert.equal(running?.completedScenes, 2);

  clock = '2026-08-23T10:00:02.000Z';
  await store.complete('short-demo', generationId);
  const completed = await store.get('short-demo');
  assert.equal(completed?.state, 'completed');
  assert.equal(completed?.finishedAt, clock);
});

test('phiên máy chủ mới nhận diện generation cũ bị gián đoạn', async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pad-scene-interrupted-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const generationId = randomUUID();
  const first = createFileMotionCanvasGenerationProgressStore(root, {
    serverInstanceId: randomUUID(),
  });
  await first.start({projectId: 'short-demo', generationId, totalScenes: 1});

  const restarted = createFileMotionCanvasGenerationProgressStore(root, {
    serverInstanceId: randomUUID(),
  });
  const progress = await restarted.get('short-demo');
  assert.equal(progress?.state, 'interrupted');
  assert.match(progress?.error ?? '', /gián đoạn/i);
});

