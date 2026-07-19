import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import type {
  LayoutEditorManifest,
  LayoutOverridesDocument,
} from '../shared/layout.ts';
import {resolveLayoutEditorManifest} from './layoutEditorState.ts';

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
