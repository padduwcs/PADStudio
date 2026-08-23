import type {TopicProject} from '../shared/topic.ts';
import {
  finalRenderMatchesLayout,
  layoutMatchesAnimationSync,
  nextWorkflowStep,
  sameValue,
} from '../shared/projectPipeline.ts';
import {
  animationSyncMatchesSources,
  voiceMatchesPlan,
} from './projectConsistency.ts';

/**
 * The only set of project fields that a persistence operation may replace.
 *
 * This intentionally models a state transition rather than an arbitrary JSON
 * merge.  The reconciliation below owns downstream invalidation so callers
 * cannot accidentally leave an approved artifact attached to changed input.
 */
export type ProjectStateChange = {
  /** Explicit resume state for an in-place scene editing transition. */
  currentStep?: TopicProject['currentStep'];
  topicInput?: TopicProject['topicInput'];
  outline?: NonNullable<TopicProject['outline']>;
  voiceVisualPlan?: NonNullable<TopicProject['voiceVisualPlan']>;
  motionCanvasBundle?: NonNullable<TopicProject['motionCanvasBundle']>;
  voiceBundle?: NonNullable<TopicProject['voiceBundle']>;
  animationSyncBundle?: NonNullable<TopicProject['animationSyncBundle']>;
  layoutBundle?: NonNullable<TopicProject['layoutBundle']>;
  renderBundle?: NonNullable<TopicProject['renderBundle']>;
  narration?: NonNullable<TopicProject['narration']> | null;
  renderProfile?: NonNullable<TopicProject['renderProfile']>;
};

export function projectChangeAlreadyApplied(
  project: TopicProject,
  change: ProjectStateChange,
) {
  return (
    (change.currentStep === undefined ||
      change.currentStep === project.currentStep) &&
    (change.topicInput === undefined ||
      sameValue(change.topicInput, project.topicInput)) &&
    (change.outline === undefined || sameValue(change.outline, project.outline)) &&
    (change.voiceVisualPlan === undefined ||
      sameValue(change.voiceVisualPlan, project.voiceVisualPlan)) &&
    (change.motionCanvasBundle === undefined ||
      sameValue(change.motionCanvasBundle, project.motionCanvasBundle)) &&
    (change.voiceBundle === undefined ||
      sameValue(change.voiceBundle, project.voiceBundle)) &&
    (change.animationSyncBundle === undefined ||
      sameValue(change.animationSyncBundle, project.animationSyncBundle)) &&
    (change.layoutBundle === undefined ||
      sameValue(change.layoutBundle, project.layoutBundle)) &&
    (change.renderBundle === undefined ||
      sameValue(change.renderBundle, project.renderBundle)) &&
    (change.narration === undefined ||
      sameValue(change.narration, project.narration)) &&
    (change.renderProfile === undefined ||
      sameValue(change.renderProfile, project.renderProfile))
  );
}

/**
 * Applies one logical project change and reconciles every downstream artifact.
 *
 * Generated files remain on disk as immutable history; only their eligibility
 * for the current pipeline changes.  This makes retries and restores safe and
 * keeps the project's state machine deterministic.
 */
export function reconcileProjectState(
  currentProject: TopicProject,
  change: ProjectStateChange,
  updatedAt = new Date().toISOString(),
): TopicProject {
  if (projectChangeAlreadyApplied(currentProject, change)) {
    return currentProject;
  }

  const topicChanged =
    change.topicInput !== undefined &&
      !sameValue(change.topicInput, currentProject.topicInput);
  const narrationChanged =
    change.narration !== undefined &&
    !sameValue(change.narration, currentProject.narration);
  const nextNarration =
    change.narration !== undefined
      ? change.narration
      : currentProject.narration;
  // Proposals, audit notes and approval timestamps do not change the audio
  // source. Only source/normalized text changes invalidate generated voice.
  const narrationSourceChanged = Boolean(
    narrationChanged &&
      (
        nextNarration?.sourceText !== currentProject.narration?.sourceText ||
        nextNarration?.review?.sourceHash !==
          currentProject.narration?.review?.sourceHash
      ),
  );
  const nextOutline =
    change.outline ??
    (topicChanged && currentProject.outline
      ? {...currentProject.outline, status: 'draft' as const}
      : currentProject.outline);
  const outlineChanged = !sameValue(nextOutline, currentProject.outline);
  const nextVoiceVisualPlan =
    change.voiceVisualPlan ??
    ((topicChanged || narrationSourceChanged || outlineChanged) && currentProject.voiceVisualPlan
      ? {...currentProject.voiceVisualPlan, status: 'draft' as const}
      : currentProject.voiceVisualPlan);
  const voiceVisualContentChanged =
    nextVoiceVisualPlan?.contentRevision !==
    currentProject.voiceVisualPlan?.contentRevision;
  const nextMotionCanvasBundle =
    change.motionCanvasBundle ??
    ((topicChanged || narrationSourceChanged || outlineChanged || voiceVisualContentChanged) &&
    currentProject.motionCanvasBundle
      ? {...currentProject.motionCanvasBundle, status: 'draft' as const}
      : currentProject.motionCanvasBundle);
  const voiceSourceChanged = Boolean(
    currentProject.voiceBundle &&
      (!nextVoiceVisualPlan ||
        !voiceMatchesPlan(currentProject.voiceBundle, nextVoiceVisualPlan)),
  );
  const nextVoiceBundle =
    change.voiceBundle ??
    ((narrationSourceChanged || voiceSourceChanged) &&
    currentProject.voiceBundle
      ? {...currentProject.voiceBundle, status: 'draft' as const}
      : currentProject.voiceBundle);
  const syncSourcesChanged = Boolean(
    currentProject.animationSyncBundle &&
      (!nextMotionCanvasBundle ||
        !nextVoiceBundle ||
        nextMotionCanvasBundle.status !== 'approved' ||
        nextVoiceBundle.status !== 'approved' ||
        !animationSyncMatchesSources(
          currentProject.animationSyncBundle,
          nextMotionCanvasBundle,
          nextVoiceBundle,
        )),
  );
  const nextAnimationSyncBundle =
    change.animationSyncBundle ??
    (syncSourcesChanged && currentProject.animationSyncBundle
      ? {...currentProject.animationSyncBundle, status: 'draft' as const}
      : currentProject.animationSyncBundle);
  const layoutSourceChanged = Boolean(
    currentProject.layoutBundle &&
      (!nextAnimationSyncBundle ||
        nextAnimationSyncBundle.status !== 'approved' ||
        !layoutMatchesAnimationSync(
          currentProject.layoutBundle,
          nextAnimationSyncBundle,
        )),
  );
  const nextLayoutBundle =
    change.layoutBundle ??
    (layoutSourceChanged && currentProject.layoutBundle
      ? null
      : currentProject.layoutBundle);
  const renderSourceChanged = Boolean(
    currentProject.renderBundle &&
      (!nextLayoutBundle ||
        nextLayoutBundle.status !== 'approved' ||
        !finalRenderMatchesLayout(currentProject.renderBundle, nextLayoutBundle)),
  );
  const nextRenderBundle =
    change.renderBundle ??
    (renderSourceChanged ? null : currentProject.renderBundle);
  const reconciled = {
    ...currentProject,
      ...(change.topicInput ? {topicInput: change.topicInput} : {}),
      ...(change.narration !== undefined ? {narration: change.narration} : {}),
      ...(change.renderProfile ? {renderProfile: change.renderProfile} : {}),
    currentStep: change.currentStep ?? currentProject.currentStep,
    outline: nextOutline,
    voiceVisualPlan: nextVoiceVisualPlan,
    motionCanvasBundle: nextMotionCanvasBundle,
    voiceBundle: nextVoiceBundle,
    animationSyncBundle: nextAnimationSyncBundle,
    layoutBundle: nextLayoutBundle,
    renderBundle: nextRenderBundle,
    revision: currentProject.revision + 1,
    updatedAt,
  };
  return {
    ...reconciled,
    currentStep: change.currentStep ?? nextWorkflowStep(reconciled),
  };
}
