import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInMemoryGenerationRegistry,
  GenerationIdReuseError,
} from './generationRegistry.ts';

test('generation registry joins an identical in-flight request', async () => {
  const registry = createInMemoryGenerationRegistry<number>();
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation = async () => {
    calls += 1;
    await pending;
    return 42;
  };

  const first = registry.run('job-1', 'input-a', operation);
  const second = registry.run('job-1', 'input-a', operation);
  assert.strictEqual(first, second);
  release();
  assert.equal((await first).result, 42);
  assert.equal(calls, 1);
});

test('generation registry rejects a reused id with another fingerprint', () => {
  const registry = createInMemoryGenerationRegistry<number>();
  void registry.run('job-1', 'input-a', async () => 1);
  assert.throws(
    () => registry.run('job-1', 'input-b', async () => 2),
    GenerationIdReuseError,
  );
});

test('generation registry removes only matching transient entries', async () => {
  const registry = createInMemoryGenerationRegistry<number>();
  await registry.run('parent:chunk:1', 'a', async () => 1);
  await registry.run('other:chunk:1', 'b', async () => 2);
  registry.clearMatching((key) => key.startsWith('parent:'));

  assert.doesNotThrow(() =>
    registry.run('parent:chunk:1', 'different', async () => 3),
  );
  assert.throws(
    () => registry.run('other:chunk:1', 'different', async () => 3),
    GenerationIdReuseError,
  );
});
