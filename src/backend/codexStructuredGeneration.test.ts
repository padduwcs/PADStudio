import assert from 'node:assert/strict';
import test from 'node:test';
import {
  codexGenerationTimeoutMs,
  DEFAULT_CODEX_GENERATION_TIMEOUT_MS,
} from './codexStructuredGeneration.ts';

test('timeout Codex tăng theo mức reasoning cao', {
  skip: Boolean(process.env.PAD_CODEX_GENERATION_TIMEOUT_MS?.trim()),
}, () => {
  const low = codexGenerationTimeoutMs('low');
  const medium = codexGenerationTimeoutMs('medium');
  const high = codexGenerationTimeoutMs('high');
  const ultra = codexGenerationTimeoutMs('ultra');
  const futureEffort = codexGenerationTimeoutMs('future-level');

  assert.ok(low >= DEFAULT_CODEX_GENERATION_TIMEOUT_MS);
  assert.ok(medium >= low);
  assert.ok(high > medium);
  assert.ok(ultra > high);
  assert.ok(futureEffort >= high);
  assert.ok(ultra <= 120 * 60 * 1000);
});
