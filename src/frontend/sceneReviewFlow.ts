import type {
  AnimationSyncBundle,
  MotionCanvasBundle,
} from '../shared/topic.ts';

export type SceneReviewPhase =
  | 'motion-stale'
  | 'preparing-sync'
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
 * Step 4 has one user review: the edited, narrated scene. Motion and Sync
 * approvals are technical prerequisites and are prepared automatically.
 */
export function deriveSceneReviewPhase({
  motion,
  motionStale,
  sync,
  syncStale,
  layoutReady,
}: SceneReviewFlowInput): SceneReviewPhase {
  if (!motion) {
    return 'preparing-sync';
  }
  if (motionStale) return 'motion-stale';
  if (
    motion.status !== 'approved' ||
    !sync ||
    syncStale ||
    sync.status !== 'approved'
  ) return 'preparing-sync';
  return layoutReady ? 'layout-ready' : 'editing';
}

export function sceneReviewPrimaryAction(phase: SceneReviewPhase) {
  if (phase === 'motion-stale') return 'back-to-production' as const;
  if (phase === 'layout-ready') return 'navigate-to-render' as const;
  if (phase === 'editing') return 'approve-layout-and-continue' as const;
  return 'wait-for-sync' as const;
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
