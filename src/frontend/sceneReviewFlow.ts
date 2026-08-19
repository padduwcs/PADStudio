import type {
  AnimationSyncBundle,
  LayoutBundle,
  MotionCanvasBundle,
} from '../shared/topic.ts';
import type {VisualDesignBundle} from '../shared/layout.ts';
import type {RenderWatermark} from '../shared/render.ts';

export type SceneReviewPhase =
  | 'motion-draft'
  | 'motion-stale'
  | 'sync-required'
  | 'sync-draft'
  | 'sync-approved'
  | 'layout-ready';

export interface SceneReviewFlowInput {
  motion: Pick<MotionCanvasBundle, 'status'> | null;
  motionStale: boolean;
  sync: Pick<AnimationSyncBundle, 'status'> | null;
  syncStale: boolean;
  layoutReady: boolean;
}

/**
 * Keeps the Scene Review UI honest about which artifact is being reviewed.
 * A stale artifact is never offered an action that the backend will reject.
 */
export function deriveSceneReviewPhase({
  motion,
  motionStale,
  sync,
  syncStale,
  layoutReady,
}: SceneReviewFlowInput): SceneReviewPhase {
  if (!motion) {
    return 'motion-draft';
  }
  if (motionStale) return 'motion-stale';
  if (motion.status !== 'approved') return 'motion-draft';
  if (!sync || syncStale) return 'sync-required';
  if (sync.status === 'draft') return 'sync-draft';
  return layoutReady ? 'layout-ready' : 'sync-approved';
}

/** A ready layout can only be reused when it has the selected output settings. */
export function sceneReviewOutputIsReady(
  layout: Pick<LayoutBundle, 'status' | 'renderSettings'> | null,
  layoutArtifactReady: boolean,
  watermark: RenderWatermark,
) {
  return Boolean(
    layoutArtifactReady &&
      layout?.status === 'approved' &&
      JSON.stringify(layout.renderSettings.watermark) === JSON.stringify(watermark),
  );
}

export function sceneReviewPrimaryAction(phase: SceneReviewPhase) {
  if (phase === 'motion-stale') return 'back-to-production' as const;
  if (phase === 'layout-ready') return 'navigate-to-render' as const;
  if (phase === 'sync-draft' || phase === 'sync-approved') {
    return 'approve-sync-and-prepare-output' as const;
  }
  return 'approve-motion-and-generate-sync' as const;
}

export interface SceneReviewOperationState {
  syncing: boolean;
  designSaveState: 'idle' | 'saving' | 'saved' | 'error';
  candidateGenerating: boolean;
  candidateRepairing: boolean;
  candidateApplying: boolean;
  candidatePending: boolean;
  historyBusy: boolean;
}

/** Operations which can change the Motion source must settle before approval/output. */
export function sceneReviewOperationIsBusy({
  syncing,
  designSaveState,
  candidateGenerating,
  candidateRepairing,
  candidateApplying,
  candidatePending,
  historyBusy,
}: SceneReviewOperationState) {
  return (
    syncing ||
    designSaveState === 'saving' ||
    candidateGenerating ||
    candidateRepairing ||
    candidateApplying ||
    candidatePending ||
    historyBusy
  );
}

export function sceneReviewPhaseHasSynchronizedPreview(
  phase: SceneReviewPhase,
) {
  return (
    phase === 'sync-draft' ||
    phase === 'sync-approved' ||
    phase === 'layout-ready'
  );
}

/** A changed saved override must create a fresh Sync preview session/URL. */
export function synchronizedPreviewKey(
  syncGenerationId: string,
  visualDesign: Pick<VisualDesignBundle, 'contentRevision' | 'overrides'> | null,
) {
  return JSON.stringify({
    syncGenerationId,
    visualDesignContentRevision: visualDesign?.contentRevision ?? null,
    overrides: visualDesign?.overrides ?? [],
  });
}
