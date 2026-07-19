import type {
  LayoutEditorManifest,
  LayoutOverridesDocument,
} from '../shared/layout.ts';

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
