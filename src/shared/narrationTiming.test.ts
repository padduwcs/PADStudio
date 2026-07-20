import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calibrationFromActualNarration,
  countNarrationCharacters,
  countNarrationWhitespaceTokens,
  estimateNarrationSeconds,
  narrationDurationTargets,
  plannedBeatDurationSeconds,
  resolveNarrationDurationTarget,
  targetNarrationTokenCount,
} from './narrationTiming.ts';

test('Bộ timing narration kết hợp đơn vị khoảng trắng và số ký tự', () => {
  const text =
    'Đệ quy giải một bài toán bằng cách quay lại chính bài toán nhỏ hơn.';
  assert.equal(countNarrationWhitespaceTokens(text), 15);
  assert.equal(countNarrationCharacters(text), Array.from(text).length);
  const seconds = estimateNarrationSeconds(text);
  assert.ok(seconds > 3);
  assert.ok(seconds < 8);
  assert.equal(
    plannedBeatDurationSeconds(text, 3),
    Math.max(4, Math.ceil(seconds) + 3),
  );
});

test('Thời lượng tùy chỉnh tạo target linh hoạt thay vì preset cứng', () => {
  assert.deepEqual(
    resolveNarrationDurationTarget({
      duration: 'custom',
      targetDurationMinutes: 20,
    }),
    {
      minimumSeconds: 1020,
      targetSeconds: 1200,
      maximumSeconds: 1380,
    },
  );
});

test('Word budget và calibration thực tế là hai khái niệm độc lập', () => {
  assert.equal(
    targetNarrationTokenCount(narrationDurationTargets.standard.targetSeconds),
    720,
  );
  const text = 'một hai ba bốn năm sáu';
  const calibration = calibrationFromActualNarration(text, 3);
  assert.ok(calibration);
  assert.equal(calibration?.whitespaceTokensPerMinute, 120);
  assert.equal(
    calibration?.charactersPerSecond,
    Array.from(text).length / 3,
  );
});
