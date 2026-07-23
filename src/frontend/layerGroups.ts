import type {LayoutEditorNode} from '../shared/layout.ts';

export interface EditorLayerGroup {
  id: string;
  label: string;
  nodes: LayoutEditorNode[];
}

function readableLabel(node: LayoutEditorNode) {
  if (/background|backdrop|canvas|scene-root/iu.test(node.key)) {
    return 'Nền và khung scene';
  }
  const source = node.label.startsWith('Txt:') ? node.key : node.label;
  return source
    .replace(/[-_/]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\p{Ll}/u, value => value.toLocaleUpperCase('vi'));
}

/**
 * Groups a flat runtime manifest by the first semantic component below the
 * scene root. Parent links come from the complete manifest so search and
 * timeline filters do not destroy the grouping.
 */
export function groupEditorLayers(
  visibleNodes: LayoutEditorNode[],
  allNodes: LayoutEditorNode[] = visibleNodes,
): EditorLayerGroup[] {
  const nodeByKey = new Map(allNodes.map(node => [node.key, node]));
  const rootKeys = new Set(
    allNodes.filter(node => node.parentKey === null).map(node => node.key),
  );
  const preliminary = new Map<
    string,
    {label: string; nodes: LayoutEditorNode[]}
  >();

  for (const node of visibleNodes) {
    const ancestry: LayoutEditorNode[] = [node];
    const visited = new Set([node.key]);
    let parentKey = node.parentKey;
    while (parentKey && !visited.has(parentKey)) {
      visited.add(parentKey);
      const parent = nodeByKey.get(parentKey);
      if (!parent) break;
      ancestry.unshift(parent);
      parentKey = parent.parentKey;
    }

    const root = ancestry[0];
    const component =
      root && rootKeys.has(root.key)
        ? ancestry[1] ?? root
        : root ?? node;
    const groupId =
      component.key === node.key &&
      ancestry.length <= 2 &&
      !['Rect', 'Layout'].includes(component.nodeType)
        ? '__independent__'
        : component.key;
    const group = preliminary.get(groupId) ?? {
      label:
        groupId === '__independent__'
          ? 'Layer độc lập'
          : readableLabel(component),
      nodes: [],
    };
    group.nodes.push(node);
    preliminary.set(groupId, group);
  }

  return [...preliminary.entries()].map(([id, group]) => ({
    id,
    ...group,
  }));
}
