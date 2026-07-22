import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRenderDiagnosticTracker,
  diagnosticMessage,
  normalizeRenderLog,
  rendererRangeFromFrames,
} from './diagnostics.js';

test('chuẩn hóa log Motion Canvas và không làm mất stack', () => {
  assert.deepEqual(
    normalizeRenderLog({
      level: 'error',
      message: 'Scene failed',
      remarks: 'while drawing',
      stack: 'Error: Scene failed\n at scene.tsx:10',
    }),
    {
      level: 'error',
      message: 'Scene failed',
      remarks: 'while drawing',
      stack: 'Error: Scene failed\n at scene.tsx:10',
    },
  );
});

test('diagnostic giữ đúng frame, scene và lỗi gần nhất', () => {
  const tracker = createRenderDiagnosticTracker(30);
  tracker.record({level: 'warn', message: 'warning'});
  tracker.markFrame(75, 15, 'scene-02');
  const diagnostic = tracker.build(new Error('Cannot draw node'));

  assert.equal(diagnostic.frame, 75);
  assert.equal(diagnostic.sceneFrame, 15);
  assert.equal(diagnostic.sceneName, 'scene-02');
  assert.equal(diagnostic.timeSeconds, 2.5);
  assert.equal(
    diagnosticMessage(diagnostic, 'fallback'),
    'Cannot draw node',
  );
  assert.match(diagnostic.logs.at(-1).stack, /Cannot draw node/);
});

test('diagnostic giới hạn lịch sử để payload không tăng vô hạn', () => {
  const tracker = createRenderDiagnosticTracker(30);
  for (let index = 0; index < 20; index += 1) {
    tracker.record({level: 'info', message: `log-${index}`});
  }
  const diagnostic = tracker.build(null);

  assert.equal(diagnostic.logs.length, 8);
  assert.equal(diagnostic.logs[0].message, 'log-12');
  assert.equal(diagnostic.logs.at(-1).message, 'log-19');
});

test('đổi segment frame sang range Motion Canvas không trùng hoặc hụt frame', () => {
  const first = rendererRangeFromFrames([0, 1_799], 30);
  const second = rendererRangeFromFrames([1_800, 3_599], 30);
  const toFrame = seconds => Math.ceil(seconds * 30);

  assert.deepEqual(first.map(toFrame), [0, 1_799]);
  assert.deepEqual(second.map(toFrame), [1_800, 3_599]);
  assert.equal(toFrame(second[0]) - toFrame(first[1]), 1);
  assert.throws(
    () => rendererRangeFromFrames([10, 9], 30),
    /không hợp lệ/,
  );
});
