import assert from 'node:assert/strict';
import test from 'node:test';
import {ProjectOperationQueue} from './projectOperationQueue.ts';

test('ProjectOperationQueue chạy autosave và submit đúng thứ tự', async () => {
  const queue = new ProjectOperationQueue();
  const events: string[] = [];
  let finishAutosave!: () => void;
  const autosaveGate = new Promise<void>((resolve) => {
    finishAutosave = resolve;
  });

  const autosave = queue.enqueue(async () => {
    events.push('autosave:start');
    await autosaveGate;
    events.push('autosave:end');
  });
  const submit = queue.enqueue(async () => {
    events.push('submit');
  });

  await Promise.resolve();
  assert.deepEqual(events, ['autosave:start']);

  finishAutosave();
  await Promise.all([autosave, submit]);
  assert.deepEqual(events, ['autosave:start', 'autosave:end', 'submit']);
});

test('ProjectOperationQueue tiếp tục sau một request thất bại', async () => {
  const queue = new ProjectOperationQueue();
  const failed = queue.enqueue(async () => {
    throw new Error('network error');
  });
  const recovered = queue.enqueue(async () => 'saved');

  await assert.rejects(failed);
  assert.equal(await recovered, 'saved');
});
