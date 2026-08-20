import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import type {
  LayoutEditorManifest,
  LayoutOverridesDocument,
} from '../shared/layout.ts';
import {
  layoutEditorProtocolGenerationId,
  parseRuntimeNodeVisibility,
  resolveLayoutEditorManifest,
  runtimeManifestRequiresSave,
  timelineVisibleEditorNodes,
} from './layoutEditorState.ts';

test('Layout editor dùng preview generation cho protocol sau khi autosave', () => {
  const sourceSyncGenerationId = randomUUID();
  const savedLayoutGenerationId = randomUUID();

  assert.equal(
    layoutEditorProtocolGenerationId(
      savedLayoutGenerationId,
      sourceSyncGenerationId,
    ),
    savedLayoutGenerationId,
  );
  assert.equal(
    layoutEditorProtocolGenerationId('', sourceSyncGenerationId),
    sourceSyncGenerationId,
  );
});

function sourceFixture(sourceHash = 'a'.repeat(64)) {
  const generationId = randomUUID();
  const document: LayoutOverridesDocument = {
    version: 1,
    sourceAnimationSyncGenerationId: generationId,
    sourceAnimationSyncContentRevision: 1,
    sourceAnimationSyncSourceHash: sourceHash,
    overrides: [],
  };
  const manifest: LayoutEditorManifest = {
    version: 1,
    sourceAnimationSyncGenerationId: generationId,
    sourceAnimationSyncContentRevision: 1,
    sourceAnimationSyncSourceHash: sourceHash,
    scenes: [],
  };
  return {document, manifest};
}

test('Layout giữ node manifest runtime khi autosave đầu tiên chưa trả manifest', () => {
  const fixture = sourceFixture();
  assert.equal(
    resolveLayoutEditorManifest(null, fixture.manifest, fixture.document),
    fixture.manifest,
  );
});

test('Layout ưu tiên manifest đã lưu và xóa manifest của Sync source cũ', () => {
  const current = sourceFixture();
  const next = sourceFixture('b'.repeat(64));
  assert.equal(
    resolveLayoutEditorManifest(
      next.manifest,
      current.manifest,
      next.document,
    ),
    next.manifest,
  );
  assert.equal(
    resolveLayoutEditorManifest(null, current.manifest, next.document),
    null,
  );
});

test('Layout chỉ hiện node có opacity timeline lớn hơn 0 ở scene hiện tại', () => {
  const nodes = [{key: 'title'}, {key: 'card'}, {key: 'accent'}];
  const visibility = parseRuntimeNodeVisibility({
    sceneId: 'scene-01',
    visibleNodeKeys: ['title', 'accent'],
    hiddenNodeCount: 1,
  });
  assert.deepEqual(
    timelineVisibleEditorNodes(nodes, 'scene-01', visibility),
    [{key: 'title'}, {key: 'accent'}],
  );
  assert.equal(
    timelineVisibleEditorNodes(nodes, 'scene-02', visibility),
    nodes,
  );
});

test('Layout từ chối visibility runtime sai cấu trúc', () => {
  assert.equal(
    parseRuntimeNodeVisibility({
      sceneId: '',
      visibleNodeKeys: ['title'],
      hiddenNodeCount: 0,
    }),
    null,
  );
  assert.equal(
    parseRuntimeNodeVisibility({
      sceneId: 'scene-01',
      visibleNodeKeys: ['title', 2],
      hiddenNodeCount: 1,
    }),
    null,
  );
});

test('mở Layout đã duyệt không tự lưu manifest và làm mất bản render', () => {
  assert.equal(
    runtimeManifestRequiresSave('null', '{"version":1}', 'approved'),
    false,
  );
  assert.equal(
    runtimeManifestRequiresSave('null', '{"version":1}', 'draft'),
    true,
  );
  assert.equal(
    runtimeManifestRequiresSave('{"version":1}', '{"version":1}', 'draft'),
    false,
  );
});
