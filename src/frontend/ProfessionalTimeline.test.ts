import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import type {
  LayoutEditorNode,
  LayoutNodeOverride,
} from '../shared/layout.ts';
import {compactTimelineNodes} from './professionalTimelineState.ts';

function node(
  key: string,
  role: LayoutEditorNode['role'],
): LayoutEditorNode {
  return {
    key,
    fingerprint: 'a'.repeat(64),
    label: key,
    nodeType: role === 'element' ? 'Rect' : 'Layout',
    parentKey: null,
    identity: 'semantic',
    role,
    editableProperties: ['opacity'],
    lockedProperties: [],
    lockReason: null,
  };
}

test('timeline gọn chỉ giữ khung, layer đang chọn và layer có track', () => {
  const sceneId = randomUUID();
  const overrides: LayoutNodeOverride[] = [
    {
      sceneId,
      nodeKey: 'animated-label',
      nodeFingerprint: 'a'.repeat(64),
      patch: {},
      animations: [
        {
          property: 'opacity',
          keyframes: [
            {timeSeconds: 0, value: 0, easing: 'linear'},
            {timeSeconds: 1, value: 1, easing: 'ease-out'},
          ],
        },
      ],
    },
  ];
  const nodes = [
    node('scene-background', 'background'),
    node('scene-content-root', 'content'),
    node('block-title', 'block'),
    node('plain-label', 'element'),
    node('selected-label', 'element'),
    node('animated-label', 'element'),
  ];

  assert.deepEqual(
    compactTimelineNodes(
      nodes,
      overrides,
      sceneId,
      'selected-label',
    ).map(item => item.key),
    [
      'scene-content-root',
      'block-title',
      'selected-label',
      'animated-label',
    ],
  );
});
