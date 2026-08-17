import type {
  LayoutEditorNode,
  LayoutEditorManifest,
  LayoutOverridesDocument,
} from '../shared/layout.ts';

export interface RuntimeNodeVisibility {
  sceneId: string;
  visibleNodeKeys: string[];
  hiddenNodeCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function parseRuntimeNodeVisibility(
  value: unknown,
): RuntimeNodeVisibility | null {
  if (!isRecord(value) || !Array.isArray(value.visibleNodeKeys)) return null;
  const visibleNodeKeys = value.visibleNodeKeys.filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  );
  if (
    typeof value.sceneId !== 'string' ||
    !value.sceneId ||
    visibleNodeKeys.length !== value.visibleNodeKeys.length ||
    !Number.isInteger(value.hiddenNodeCount) ||
    Number(value.hiddenNodeCount) < 0
  ) {
    return null;
  }
  return {
    sceneId: value.sceneId,
    visibleNodeKeys: [...new Set(visibleNodeKeys)],
    hiddenNodeCount: Number(value.hiddenNodeCount),
  };
}

export function timelineVisibleEditorNodes<T extends Pick<LayoutEditorNode, 'key'>>(
  nodes: T[],
  sceneId: string,
  visibility: RuntimeNodeVisibility | null,
) {
  if (!visibility || visibility.sceneId !== sceneId) return nodes;
  const visible = new Set(visibility.visibleNodeKeys);
  return nodes.filter((node) => visible.has(node.key));
}

export function resolveLayoutEditorManifest(
  storedManifest: LayoutEditorManifest | null,
  currentManifest: LayoutEditorManifest | null,
  sourceDocument: LayoutOverridesDocument,
) {
  if (storedManifest) return storedManifest;
  if (
    currentManifest &&
    currentManifest.sourceAnimationSyncGenerationId ===
      sourceDocument.sourceAnimationSyncGenerationId &&
    currentManifest.sourceAnimationSyncContentRevision ===
      sourceDocument.sourceAnimationSyncContentRevision &&
    currentManifest.sourceAnimationSyncSourceHash ===
      sourceDocument.sourceAnimationSyncSourceHash
  ) {
    return currentManifest;
  }
  return null;
}

/**
 * A runtime manifest is discovery metadata, not a visual edit. Opening an
 * approved Layout must remain read-only until the user changes the document.
 * Draft layouts still persist their first complete manifest for review.
 */
export function runtimeManifestRequiresSave(
  persistedSignature: string,
  runtimeSignature: string,
  layoutStatus: 'draft' | 'approved' | null,
) {
  return (
    runtimeSignature !== persistedSignature &&
    layoutStatus !== 'approved'
  );
}
