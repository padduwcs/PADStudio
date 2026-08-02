import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyOverride,
  buildModifierIndex,
  getOverride,
  normalizeDocument,
  patchDocument,
  patchPropertyKeyframeDocument,
  removePropertyKeyframeDocument,
  clearPropertyTrackDocument,
  propertyValueAtTime,
  patchVisibilityDocument,
  clearVisibilityDocument,
  resetDocumentNode,
  visibilityAtTime,
} from './modifier-model.js';

function signal(initial) {
  let value = initial;
  const accessor = function (next) {
    if (arguments.length === 0) return value;
    value = next;
  };
  accessor.context = {raw: () => value};
  return accessor;
}

test('patchDocument stores the strict flat override contract', () => {
  const base = normalizeDocument(null, {
    generationId: 'sync-generation',
    contentRevision: 3,
    sourceHash: 'source-hash',
  });
  const patched = patchDocument(
    base,
    'scene-id',
    'scene/card',
    'node-fingerprint',
    {
      x: 12,
      scale: 1.2,
      hidden: true,
      editorLocked: true,
    },
  );
  assert.deepEqual(
    getOverride(buildModifierIndex(patched), 'scene-id', 'scene/card'),
    {
      sceneId: 'scene-id',
      nodeKey: 'scene/card',
      nodeFingerprint: 'node-fingerprint',
      patch: {
        x: 12,
        scale: 1.2,
        hidden: true,
        editorLocked: true,
      },
    },
  );
  assert.equal(
    resetDocumentNode(patched, 'scene-id', 'scene/card').overrides.length,
    0,
  );
});

test('patchDocument giữ nguyên thứ tự khi patch không đổi', () => {
  const base = normalizeDocument(null, {
    generationId: 'sync-generation',
    contentRevision: 3,
    sourceHash: 'source-hash',
  });
  const first = patchDocument(
    base,
    'scene-id',
    'scene/card',
    'card-fingerprint',
    {x: 12},
  );
  const withSibling = patchDocument(
    first,
    'scene-id',
    'scene/label',
    'label-fingerprint',
    {y: 8},
  );
  assert.deepEqual(
    patchDocument(
      withSibling,
      'scene-id',
      'scene/card',
      'card-fingerprint',
      {x: 12},
    ),
    withSibling,
  );
});

test('text modifier không cắt nội dung dài của người dùng', () => {
  const text = 'Nội dung dài '.repeat(200);
  const base = normalizeDocument(null, {
    generationId: 'sync-generation',
    contentRevision: 3,
    sourceHash: 'source-hash',
  });
  const patched = patchDocument(
    base,
    'scene-id',
    'scene/label',
    'label-fingerprint',
    {text},
  );

  assert.equal(
    getOverride(buildModifierIndex(patched), 'scene-id', 'scene/label').patch
      .text,
    text,
  );
});

test('applyOverride restores raw animated signals in finally-compatible order', () => {
  const node = {
    position: signal({x: 5, y: 7}),
    scale: signal({x: 1, y: 2}),
    rotation: signal(10),
    opacity: signal(0.8),
    zIndex: signal(1),
    fill: signal('#112233'),
    stroke: signal('#445566'),
    lineWidth: signal(2),
  };
  const restore = applyOverride(node, {
    patch: {
      x: 3,
      y: -2,
      scale: 2,
      rotation: 5,
      opacity: 0.5,
      fill: '#AABBCC',
      stroke: null,
      strokeWidth: 6,
      zIndexDelta: 4,
      editorLocked: true,
    },
  });

  assert.deepEqual(node.position(), [8, 5]);
  assert.deepEqual(node.scale(), [2, 4]);
  assert.equal(node.rotation(), 15);
  assert.equal(node.opacity(), 0.4);
  assert.equal(node.zIndex(), 5);
  assert.equal(node.fill(), '#AABBCC');
  assert.equal(node.stroke(), null);
  assert.equal(node.lineWidth(), 6);

  restore();
  assert.deepEqual(node.position(), {x: 5, y: 7});
  assert.deepEqual(node.scale(), {x: 1, y: 2});
  assert.equal(node.rotation(), 10);
  assert.equal(node.opacity(), 0.8);
  assert.equal(node.zIndex(), 1);
  assert.equal(node.fill(), '#112233');
  assert.equal(node.stroke(), '#445566');
  assert.equal(node.lineWidth(), 2);
});

test('applyOverride translates layout-managed nodes after flex computation', () => {
  class Matrix {
    constructor(value = {}) {
      this.e = value.e ?? 0;
      this.f = value.f ?? 0;
    }
  }
  const position = signal({x: 0, y: 0});
  const originalLocalToParent = function () {
    return new Matrix({e: 240, f: 360});
  };
  let dirtyCount = 0;
  originalLocalToParent.context = {
    markDirty() {
      dirtyCount++;
    },
  };
  const node = {
    position,
    isLayoutRoot: () => false,
    localToParent: originalLocalToParent,
  };

  const restore = applyOverride(node, {patch: {x: 80, y: -30}});

  assert.deepEqual(node.localToParent(), new Matrix({e: 320, f: 330}));
  assert.deepEqual(node.position(), {x: 0, y: 0});
  assert.equal(dirtyCount, 1);

  restore();

  assert.equal(node.localToParent, originalLocalToParent);
  assert.deepEqual(node.position(), {x: 0, y: 0});
  assert.equal(dirtyCount, 2);
});

test('hidden is delete semantics and editor lock does not disable rendering', () => {
  const node = {opacity: signal(0.75)};
  const restore = applyOverride(node, {
    patch: {hidden: true, editorLocked: true},
  });
  assert.equal(node.opacity(), 0);
  restore();
  assert.equal(node.opacity(), 0.75);
});

test('visibility keyframes switch state at scene-local time and survive patches', () => {
  const base = normalizeDocument(null, {
    generationId: 'sync-generation',
    contentRevision: 3,
    sourceHash: 'source-hash',
  });
  const hidden = patchVisibilityDocument(
    base,
    'scene-id',
    'scene/card',
    'card-fingerprint',
    1.25,
    true,
  );
  const visible = patchVisibilityDocument(
    hidden,
    'scene-id',
    'scene/card',
    'card-fingerprint',
    2.5,
    false,
  );
  const patched = patchDocument(
    visible,
    'scene-id',
    'scene/card',
    'card-fingerprint',
    {x: 12},
  );
  const override = getOverride(
    buildModifierIndex(patched),
    'scene-id',
    'scene/card',
  );

  assert.equal(visibilityAtTime(override.visibility, 1), null);
  assert.equal(visibilityAtTime(override.visibility, 1.25), true);
  assert.equal(visibilityAtTime(override.visibility, 2.49), true);
  assert.equal(visibilityAtTime(override.visibility, 2.5), false);
  assert.equal(override.patch.x, 12);

  const node = {opacity: signal(0.75)};
  const restoreHidden = applyOverride(node, override, {timeSeconds: 2});
  assert.equal(node.opacity(), 0);
  restoreHidden();
  const restoreVisible = applyOverride(node, override, {timeSeconds: 3});
  assert.equal(node.opacity(), 0.75);
  restoreVisible();

  const cleared = clearVisibilityDocument(
    patched,
    'scene-id',
    'scene/card',
  );
  assert.equal(cleared.overrides[0].visibility, undefined);
  assert.equal(cleared.overrides[0].patch.x, 12);
});

test('visibility-only overrides are removed when their track is cleared', () => {
  const tracked = patchVisibilityDocument(
    normalizeDocument(null),
    'scene-id',
    'scene/card',
    'card-fingerprint',
    0,
    true,
  );
  assert.deepEqual(tracked.overrides[0].patch, {});
  assert.equal(
    clearVisibilityDocument(tracked, 'scene-id', 'scene/card').overrides
      .length,
    0,
  );
});

test('text typography modifiers are normalized, applied, and restored', () => {
  const base = normalizeDocument(null, {
    generationId: 'sync-generation',
    contentRevision: 3,
    sourceHash: 'source-hash',
  });
  const patched = patchDocument(
    base,
    'scene-id',
    'scene/title',
    'title-fingerprint',
    {
      text: 'Tiêu đề mới',
      fontFamily: 'Georgia, Times New Roman, serif',
      fontSize: 72,
      fontWeight: 700,
      fontStyle: 'italic',
      underline: true,
      strikethrough: true,
    },
  );
  const override = getOverride(
    buildModifierIndex(patched),
    'scene-id',
    'scene/title',
  );
  const node = {
    text: signal('Tiêu đề cũ'),
    fontFamily: signal('Arial'),
    fontSize: signal(48),
    fontWeight: signal(400),
    fontStyle: signal('normal'),
  };

  const restore = applyOverride(node, override);
  assert.equal(node.text(), 'Tiêu đề mới');
  assert.equal(node.fontFamily(), 'Georgia, Times New Roman, serif');
  assert.equal(node.fontSize(), 72);
  assert.equal(node.fontWeight(), 700);
  assert.equal(node.fontStyle(), 'italic');

  restore();
  assert.equal(node.text(), 'Tiêu đề cũ');
  assert.equal(node.fontFamily(), 'Arial');
  assert.equal(node.fontSize(), 48);
  assert.equal(node.fontWeight(), 400);
  assert.equal(node.fontStyle(), 'normal');
});

test('property tracks interpolate easing and compose with animated source signals', () => {
  const base = normalizeDocument(null, {
    generationId: 'sync-generation',
    contentRevision: 3,
    sourceHash: 'source-hash',
  });
  const first = patchPropertyKeyframeDocument(
    base,
    'scene-id',
    'block-search',
    'block-fingerprint',
    'scale',
    0,
    1,
    'linear',
  );
  const tracked = patchPropertyKeyframeDocument(
    first,
    'scene-id',
    'block-search',
    'block-fingerprint',
    'scale',
    2,
    2,
    'linear',
  );
  const override = tracked.overrides[0];
  assert.equal(propertyValueAtTime(override.animations[0], 1), 1.5);

  const node = {scale: signal([2, 3])};
  const restore = applyOverride(node, override, {timeSeconds: 1});
  assert.deepEqual(node.scale(), [3, 4.5]);
  restore();
  assert.deepEqual(node.scale(), [2, 3]);
});

test('property keyframes replace by time and tracks clear without losing static patch', () => {
  const base = patchDocument(
    normalizeDocument(null),
    'scene-id',
    'block-search',
    'block-fingerprint',
    {x: 12},
  );
  const first = patchPropertyKeyframeDocument(
    base,
    'scene-id',
    'block-search',
    'block-fingerprint',
    'opacity',
    1,
    0.2,
  );
  const replaced = patchPropertyKeyframeDocument(
    first,
    'scene-id',
    'block-search',
    'block-fingerprint',
    'opacity',
    1,
    0.8,
  );
  assert.equal(
    replaced.overrides[0].animations[0].keyframes.length,
    1,
  );
  assert.equal(
    replaced.overrides[0].animations[0].keyframes[0].value,
    0.8,
  );

  const removed = removePropertyKeyframeDocument(
    replaced,
    'scene-id',
    'block-search',
    'opacity',
    1,
  );
  assert.equal(removed.overrides[0].animations, undefined);
  assert.equal(removed.overrides[0].patch.x, 12);

  const retracked = patchPropertyKeyframeDocument(
    removed,
    'scene-id',
    'block-search',
    'block-fingerprint',
    'x',
    0,
    10,
  );
  const cleared = clearPropertyTrackDocument(
    retracked,
    'scene-id',
    'block-search',
    'x',
  );
  assert.equal(cleared.overrides[0].animations, undefined);
  assert.equal(cleared.overrides[0].patch.x, 12);
});
