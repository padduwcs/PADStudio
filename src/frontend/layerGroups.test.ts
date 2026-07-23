import assert from 'node:assert/strict';
import test from 'node:test';
import type {LayoutEditorNode} from '../shared/layout.ts';
import {groupEditorLayers} from './layerGroups.ts';

function node(
  key: string,
  parentKey: string | null,
  nodeType = 'Rect',
): LayoutEditorNode {
  return {
    key,
    fingerprint: 'a'.repeat(64),
    label: key,
    nodeType,
    parentKey,
    identity: 'semantic',
    editableProperties: ['opacity'],
    lockedProperties: [],
    lockReason: null,
  };
}

test('nhóm layer theo component semantic dưới scene root', () => {
  const nodes = [
    node('scene-background', null),
    node('ordered-panel', 'scene-background'),
    node('ordered-row', 'ordered-panel'),
    node('ordered-label', 'ordered-row', 'Txt'),
    node('target-card', 'scene-background'),
    node('target-label', 'target-card', 'Txt'),
  ];
  const groups = groupEditorLayers(nodes, nodes);
  assert.deepEqual(
    groups.map(group => [group.id, group.nodes.map(item => item.key)]),
    [
      ['scene-background', ['scene-background']],
      [
        'ordered-panel',
        ['ordered-panel', 'ordered-row', 'ordered-label'],
      ],
      ['target-card', ['target-card', 'target-label']],
    ],
  );
});

test('giữ cụm đúng khi kết quả tìm kiếm không chứa node cha', () => {
  const nodes = [
    node('scene-background', null),
    node('ordered-panel', 'scene-background'),
    node('ordered-label', 'ordered-panel', 'Txt'),
  ];
  const groups = groupEditorLayers([nodes[2]!], nodes);
  assert.equal(groups[0]?.id, 'ordered-panel');
  assert.deepEqual(groups[0]?.nodes.map(item => item.key), [
    'ordered-label',
  ]);
});
