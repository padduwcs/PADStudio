import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyOverride,
  buildModifierIndex,
  getOverride,
  normalizeDocument,
  patchDocument,
  resetDocumentNode,
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

test('hidden is delete semantics and editor lock does not disable rendering', () => {
  const node = {opacity: signal(0.75)};
  const restore = applyOverride(node, {
    patch: {hidden: true, editorLocked: true},
  });
  assert.equal(node.opacity(), 0);
  restore();
  assert.equal(node.opacity(), 0.75);
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
