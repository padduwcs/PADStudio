import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNewTopicCreationId,
  readNewTopicDraft,
  saveNewTopicDraft,
  type StorageLike,
} from './newTopicSession.ts';

function memoryStorage(): StorageLike & {entries: Map<string, string>} {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

test('nháp chủ đề mới được cô lập theo tab', () => {
  const firstTab = memoryStorage();
  const secondTab = memoryStorage();

  saveNewTopicDraft('{"topic":"Đệ quy"}', firstTab);
  saveNewTopicDraft('{"topic":"Dijkstra"}', secondTab);

  assert.equal(readNewTopicDraft(firstTab), '{"topic":"Đệ quy"}');
  assert.equal(readNewTopicDraft(secondTab), '{"topic":"Dijkstra"}');
});

test('nháp v1 dùng chung chỉ được chuyển một lần vào tab đang mở', () => {
  const session = memoryStorage();
  const sharedLegacy = memoryStorage();
  sharedLegacy.setItem('pad-studio:topic-form:v1', '{"topic":"Heap"}');

  assert.equal(readNewTopicDraft(session), null);
  assert.equal(sharedLegacy.getItem('pad-studio:topic-form:v1'), '{"topic":"Heap"}');
});

test('mỗi form mới nhận creation ID riêng nhưng caller có thể giữ ID để retry', () => {
  let sequence = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const firstFormId = createNewTopicCreationId(nextId);
  const secondFormId = createNewTopicCreationId(nextId);

  assert.notEqual(firstFormId, secondFormId);
  assert.equal(firstFormId, '00000000-0000-4000-8000-000000000001');
});
