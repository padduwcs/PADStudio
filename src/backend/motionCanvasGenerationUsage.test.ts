import assert from 'node:assert/strict';
import test from 'node:test';
import {mergeMotionCanvasGenerationUsage} from './motionCanvasGenerator.ts';

test('quality retry usage is accumulated and becomes unknown if either call is unknown', () => {
  const initial = {inputTokens: 10, cachedInputTokens: 2, outputTokens: 4, reasoningOutputTokens: 1, totalTokens: 15};
  const retry = {inputTokens: 7, cachedInputTokens: 1, outputTokens: 3, reasoningOutputTokens: 2, totalTokens: 12};
  assert.deepEqual(mergeMotionCanvasGenerationUsage(initial, retry), {
    inputTokens: 17,
    cachedInputTokens: 3,
    outputTokens: 7,
    reasoningOutputTokens: 3,
    totalTokens: 27,
  });
  assert.equal(mergeMotionCanvasGenerationUsage(initial, null), null);
  assert.equal(mergeMotionCanvasGenerationUsage(null, retry), null);
});
