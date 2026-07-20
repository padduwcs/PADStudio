import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateCodexWait,
  recordCodexWaitSample,
} from './codexWaitEstimate.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test('ước tính Codex tăng theo reasoning và số batch Motion', () => {
  const low = estimateCodexWait(
    {model: 'model', reasoningEffort: 'low', task: 'motionCanvas', workUnits: 2},
    null,
  );
  const high = estimateCodexWait(
    {model: 'model', reasoningEffort: 'high', task: 'motionCanvas', workUnits: 6},
    null,
  );

  assert.ok(high.minimumMs > low.minimumMs);
  assert.ok(high.maximumMs > low.maximumMs);
  assert.equal(high.basis, 'baseline');
});

test('ước tính Codex tự hiệu chỉnh bằng mẫu thành công cục bộ', () => {
  const storage = memoryStorage();
  const selection = {
    model: 'model',
    reasoningEffort: 'high',
    task: 'outline' as const,
  };
  recordCodexWaitSample({...selection, elapsedMs: 100_000}, storage);
  recordCodexWaitSample({...selection, elapsedMs: 120_000}, storage);

  const estimate = estimateCodexWait(selection, storage);
  assert.equal(estimate.basis, 'observed');
  assert.equal(estimate.sampleCount, 2);
  assert.equal(estimate.minimumMs, 71_500);
  assert.equal(estimate.maximumMs, 198_000);
});
