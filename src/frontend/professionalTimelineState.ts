import type {
  LayoutEditorNode,
  LayoutNodeOverride,
} from '../shared/layout.ts';

export function compactTimelineNodes(
  nodes: LayoutEditorNode[],
  overrides: LayoutNodeOverride[],
  activeSceneId: string,
  selectedNodeKey?: string | null,
) {
  return nodes.filter(node => {
    if (node.role === 'background') return false;
    const override = overrides.find(
      item =>
        item.sceneId === activeSceneId &&
        item.nodeKey === node.key,
    );
    return (
      node.key === selectedNodeKey ||
      node.role === 'content' ||
      node.role === 'block' ||
      Boolean(override?.animations?.length || override?.visibility?.length)
    );
  });
}
