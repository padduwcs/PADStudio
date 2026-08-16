import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createPronunciationRuleStore} from './pronunciationRuleStore.ts';

test('pronunciation library persists only reusable rules atomically', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pad-pronunciation-'));
  try {
    const store = createPronunciationRuleStore(root);
    const rule = await store.save({
      source: 'O(log n)', spoken: 'ô lô-ga-rít nờ', origin: 'user', caseSensitive: false,
    });
    assert.equal(rule.scope, 'library');
    assert.deepEqual((await store.list()).map(item => item.source), ['O(log n)']);
    assert.equal(await store.remove(rule.id), true);
    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
