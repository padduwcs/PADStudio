import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeEditorNodes,
  isGeneratedEditorNodeKey,
  mergeEditorNodePolicy,
  migrateInternalNodeOverrides,
  resolveCanonicalEditorNodeKey,
  resolveLiveEditorNodeTarget,
} from './editor-targets.js';

const text = {
  key: 'title',
  fingerprint: 'semantic-fingerprint',
  label: 'Txt: Tiêu đề',
  nodeType: 'Txt',
  parentKey: 'scene-root',
  identity: 'semantic',
  editableProperties: ['x', 'y', 'hidden'],
  lockedProperties: [],
  lockReason: null,
};
const leaf = {
  ...text,
  key: 'scene/TxtLeaf[1]',
  fingerprint: 'leaf-fingerprint',
  label: 'TxtLeaf: Tiêu đề',
  nodeType: 'TxtLeaf',
  parentKey: 'title',
  identity: 'legacy',
};

test('canonical target đưa TxtLeaf nội bộ về node semantic cha', () => {
  assert.equal(isGeneratedEditorNodeKey(leaf.key), true);
  assert.equal(
    resolveCanonicalEditorNodeKey([leaf, text], leaf.key),
    text.key,
  );
  const canonical = canonicalizeEditorNodes([leaf, text]);
  assert.deepEqual(canonical.nodes, [text]);
  assert.equal(canonical.aliases.get(leaf.key), text.key);
});

test('canvas hit-test đưa node runtime nội bộ về semantic parent', () => {
  const semanticNode = {key: text.key, parent: () => null};
  const internalNode = {key: leaf.key, parent: () => semanticNode};
  assert.equal(resolveLiveEditorNodeTarget(internalNode), semanticNode);
  assert.equal(resolveLiveEditorNodeTarget(semanticNode), semanticNode);
});

test('canonical target giữ legacy node khi không có semantic ancestor', () => {
  const standalone = {...leaf, parentKey: null};
  const canonical = canonicalizeEditorNodes([standalone]);
  assert.deepEqual(canonical.nodes, [standalone]);
  assert.equal(canonical.aliases.size, 0);
});

test('canonical target nối lại parent của semantic child qua internal node', () => {
  const child = {
    ...text,
    key: 'title-decoration',
    parentKey: leaf.key,
  };
  const canonical = canonicalizeEditorNodes([leaf, text, child]);
  assert.equal(
    canonical.nodes.find(node => node.key === child.key)?.parentKey,
    text.key,
  );
});

test('manifest cũ nhận capability mới nhưng vẫn giữ policy khóa', () => {
  const previous = {
    key: 'scene/title',
    editableProperties: ['x', 'fill'],
    lockedProperties: ['fill'],
    lockReason: 'Giữ màu theo nhận diện thương hiệu.',
  };
  const discovered = {
    key: 'scene/title',
    editableProperties: ['x', 'fill', 'text', 'fontFamily'],
    lockedProperties: [],
    lockReason: null,
  };

  assert.deepEqual(mergeEditorNodePolicy(discovered, previous), {
    ...discovered,
    editableProperties: ['x', 'fill', 'text', 'fontFamily'],
    lockedProperties: ['fill'],
    lockReason: 'Giữ màu theo nhận diện thương hiệu.',
  });
});

test('migration chuyển và gộp modifier internal vào semantic node', () => {
  const document = {
    version: 1,
    overrides: [
      {
        sceneId: 'scene-1',
        nodeKey: text.key,
        nodeFingerprint: text.fingerprint,
        patch: {fill: '#ffffff', x: 5},
      },
      {
        sceneId: 'scene-1',
        nodeKey: leaf.key,
        nodeFingerprint: leaf.fingerprint,
        patch: {x: 20, hidden: true},
      },
    ],
  };
  const migrated = migrateInternalNodeOverrides(
    document,
    'scene-1',
    new Map([[leaf.key, text.key]]),
    [text],
  );
  assert.deepEqual(migrated.overrides, [
    {
      sceneId: 'scene-1',
      nodeKey: text.key,
      nodeFingerprint: text.fingerprint,
      patch: {fill: '#ffffff', x: 20, hidden: true},
    },
  ]);
});

test('migration loại thuộc tính internal mà semantic target không hỗ trợ', () => {
  const target = {
    ...text,
    editableProperties: ['x', 'y', 'hidden'],
    lockedProperties: ['y'],
  };
  const document = {
    version: 1,
    overrides: [
      {
        sceneId: 'scene-1',
        nodeKey: leaf.key,
        nodeFingerprint: leaf.fingerprint,
        patch: {x: 10, y: 20, fill: '#ffffff', editorLocked: true},
      },
    ],
  };
  const migrated = migrateInternalNodeOverrides(
    document,
    'scene-1',
    new Map([[leaf.key, target.key]]),
    [target],
  );
  assert.deepEqual(migrated.overrides[0].patch, {
    x: 10,
    editorLocked: true,
  });
});
