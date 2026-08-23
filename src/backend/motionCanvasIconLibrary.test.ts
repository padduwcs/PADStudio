import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isKnownMotionCanvasIconId,
  resolveMotionCanvasIcon,
  suggestMotionCanvasIconIds,
} from './motionCanvasIconLibrary.ts';

test('resolveMotionCanvasIcon trả về path data thật cho icon mdi hợp lệ', () => {
  const icon = resolveMotionCanvasIcon('mdi:leaf');
  assert.ok(icon);
  assert.match(icon!.d, /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/u);
  assert.equal(icon!.viewBoxWidth, 24);
  assert.equal(icon!.viewBoxHeight, 24);
});

test('resolveMotionCanvasIcon trả về path data thật cho icon phosphor hợp lệ', () => {
  const icon = resolveMotionCanvasIcon('ph:tree');
  assert.ok(icon);
  assert.equal(icon!.viewBoxWidth, 256);
  assert.equal(icon!.viewBoxHeight, 256);
});

test('resolveMotionCanvasIcon từ chối prefix không được hỗ trợ', () => {
  assert.equal(resolveMotionCanvasIcon('fa:leaf'), null);
});

test('resolveMotionCanvasIcon từ chối icon không tồn tại', () => {
  assert.equal(resolveMotionCanvasIcon('mdi:this-icon-does-not-exist'), null);
});

test('isKnownMotionCanvasIconId khớp với resolveMotionCanvasIcon', () => {
  assert.equal(isKnownMotionCanvasIconId('mdi:white-balance-sunny'), true);
  assert.equal(isKnownMotionCanvasIconId('mdi:not-a-real-icon-xyz'), false);
});

test('suggestMotionCanvasIconIds gợi ý icon gần đúng theo từ khoá', () => {
  const suggestions = suggestMotionCanvasIconIds('leaf', 5);
  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.every(id => /^(mdi|ph):/u.test(id)));
  assert.ok(suggestions.some(id => id.includes('leaf')));
});

test('suggestMotionCanvasIconIds trả về mảng rỗng với từ khoá rỗng', () => {
  assert.deepEqual(suggestMotionCanvasIconIds(''), []);
});
