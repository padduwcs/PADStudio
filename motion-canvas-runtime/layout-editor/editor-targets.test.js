import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeEditorNodes,
  chooseEditorNodeHitTarget,
  editorGeometryContainsPoint,
  isEditorNodeTimelineVisible,
  isGeneratedEditorNodeKey,
  isInternalEditorNode,
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

test('canvas hit-test dừng ở Txt legacy thay vì leo lên container', () => {
  const container = {
    key: 'scene/Rect[1]',
    constructor: {name: 'Rect'},
    parent: () => null,
  };
  const legacyText = {
    key: 'scene/Txt[1]',
    constructor: {name: 'Txt'},
    parent: () => container,
  };
  const internalLeaf = {
    key: 'scene/TxtLeaf[1]',
    constructor: {name: 'TxtLeaf'},
    parent: () => legacyText,
  };

  assert.equal(isGeneratedEditorNodeKey(legacyText.key), true);
  assert.equal(isInternalEditorNode(legacyText), false);
  assert.equal(isInternalEditorNode(internalLeaf), true);
  assert.equal(resolveLiveEditorNodeTarget(internalLeaf), legacyText);
});

test('timeline chỉ cho tương tác node đã bắt đầu hiện', () => {
  assert.equal(
    isEditorNodeTimelineVisible({absoluteOpacity: () => 0}),
    false,
  );
  assert.equal(
    isEditorNodeTimelineVisible({absoluteOpacity: () => 0.00001}),
    false,
  );
  assert.equal(
    isEditorNodeTimelineVisible({absoluteOpacity: () => 0.02}),
    true,
  );
  assert.equal(
    isEditorNodeTimelineVisible({opacity: () => 0}),
    false,
  );
  assert.equal(
    isEditorNodeTimelineVisible({opacity: () => 1}),
    true,
  );
});

test('node opacity tùy biến lỗi vẫn được giữ để tránh khóa nhầm', () => {
  assert.equal(
    isEditorNodeTimelineVisible({
      absoluteOpacity: () => {
        throw new Error('signal unavailable');
      },
    }),
    true,
  );
  assert.equal(isEditorNodeTimelineVisible({}), true);
});

test('khung đang chọn nhận thao tác kéo khi con trỏ nằm bên trong', () => {
  const geometry = {
    corners: [
      {x: 10, y: 10},
      {x: 90, y: 10},
      {x: 90, y: 50},
      {x: 10, y: 50},
    ],
  };
  assert.equal(editorGeometryContainsPoint(geometry, {x: 50, y: 30}), true);
  assert.equal(editorGeometryContainsPoint(geometry, {x: 5, y: 30}), false);
});

test('canvas ưu tiên text và node nhỏ thay vì container phủ bên ngoài', () => {
  const geometry = (left, top, right, bottom) => ({
    corners: [
      {x: left, y: top},
      {x: right, y: top},
      {x: right, y: bottom},
      {x: left, y: bottom},
    ],
  });
  const container = {
    key: 'comparison-stage',
    nodeType: 'Layout',
    geometry: geometry(0, 0, 500, 900),
  };
  const card = {
    key: 'secret-card',
    nodeType: 'Rect',
    geometry: geometry(100, 100, 400, 500),
  };
  const text = {
    key: 'secret-symbol',
    nodeType: 'Txt',
    geometry: geometry(220, 250, 300, 320),
  };
  assert.equal(
    chooseEditorNodeHitTarget([container, text, card], {x: 260, y: 280}),
    text,
  );
  assert.equal(
    chooseEditorNodeHitTarget([container, card], {x: 150, y: 150}),
    card,
  );
  assert.equal(
    chooseEditorNodeHitTarget([container, card], {x: 700, y: 700}),
    null,
  );
});

test('manifest gộp TxtLeaf vào Txt legacy có thể chỉnh', () => {
  const legacyText = {
    ...text,
    key: 'scene/Txt[1]',
    nodeType: 'Txt',
    parentKey: 'scene/Rect[1]',
    identity: 'legacy',
  };
  const internalLeaf = {
    ...leaf,
    parentKey: legacyText.key,
  };
  const canonical = canonicalizeEditorNodes([internalLeaf, legacyText]);

  assert.deepEqual(canonical.nodes, [legacyText]);
  assert.equal(canonical.aliases.get(internalLeaf.key), legacyText.key);
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
