import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectRenderFrameTiming} from './finalRenderService.ts';

test('ước tính frame giữ quy ước endpoint của Motion Canvas', () => {
  const timing = inspectRenderFrameTiming(31, 1, 30);

  assert.equal(timing.estimatedFrameCount, 31);
  assert.equal(timing.encodedDurationSeconds, 31 / 30);
  assert.equal(timing.matches, true);
});

test('chấp nhận sai số kết thúc scene nhỏ hơn một phần frame', () => {
  const timing = inspectRenderFrameTiming(2_611, 87.04, 30);

  assert.equal(timing.estimatedFrameCount, 2_613);
  assert.ok(Math.abs(timing.differenceSeconds) < 1 / 30);
  assert.equal(timing.matches, true);
});

test('từ chối scene thực sự kết thúc sớm và frame count rỗng', () => {
  assert.equal(inspectRenderFrameTiming(2_580, 87.04, 30).matches, false);
  assert.equal(inspectRenderFrameTiming(0, 87.04, 30).matches, false);
});
