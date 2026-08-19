import type {
  AnimationSyncBundle,
  MotionCanvasBundle,
} from '../shared/topic.ts';

export type SceneReviewPhase =
  | 'motion-draft'
  | 'motion-stale'
  | 'sync-required'
  | 'sync-draft'
  | 'editing'
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
  if (sync.status !== 'approved') return 'sync-draft';
  return layoutReady ? 'layout-ready' : 'editing';
}

export function sceneReviewPrimaryAction(phase: SceneReviewPhase) {
  if (phase === 'motion-stale') return 'back-to-production' as const;
  if (phase === 'layout-ready') return 'navigate-to-render' as const;
  if (phase === 'editing') return 'approve-layout-and-continue' as const;
  return 'approve-motion-and-generate-sync' as const;
}

export interface SceneReviewOperationState {
  syncing: boolean;
  layoutSaveState: 'idle' | 'saving' | 'saved' | 'error';
  candidateGenerating: boolean;
  candidateRepairing: boolean;
  candidateApplying: boolean;
  candidatePending: boolean;
  historyBusy: boolean;
}

/** Operations which can change the Motion source must settle before approval/output. */
export function sceneReviewOperationIsBusy({
  syncing,
  layoutSaveState,
  candidateGenerating,
  candidateRepairing,
  candidateApplying,
  candidatePending,
  historyBusy,
}: SceneReviewOperationState) {
  return (
    syncing ||
    layoutSaveState === 'saving' ||
    candidateGenerating ||
    candidateRepairing ||
    candidateApplying ||
    candidatePending ||
    historyBusy
  );
}
