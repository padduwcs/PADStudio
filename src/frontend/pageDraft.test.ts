import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPageDraft,
  readPageDraft,
  savePageDraft,
} from './pageDraft.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test('page drafts stay isolated by page and project', () => {
  const storage = memoryStorage();
  savePageDraft('content', {topic: 'Heap'}, undefined, storage);
  savePageDraft('content', {topic: 'Queue'}, 'project-1', storage);
  savePageDraft('narration', {source: 'O(n)'}, 'project-1', storage);

  assert.deepEqual(readPageDraft('content', undefined, storage), {topic: 'Heap'});
  assert.deepEqual(readPageDraft('content', 'project-1', storage), {topic: 'Queue'});
  assert.deepEqual(readPageDraft('narration', 'project-1', storage), {source: 'O(n)'});
});

test('malformed page drafts are ignored and can be cleared', () => {
  const storage = memoryStorage();
  storage.setItem('pad-studio:content:draft:v1:new', '{bad json');
  assert.equal(readPageDraft('content', undefined, storage), null);

  savePageDraft('content', {topic: 'Graph'}, undefined, storage);
  clearPageDraft('content', undefined, storage);
  assert.equal(readPageDraft('content', undefined, storage), null);
});
