import type {
  AnimationSyncBundle,
  FinalRenderBundle,
  LayoutBundle,
  MotionCanvasBundle,
  TeachingOutline,
  TopicProject,
  VoiceBundle,
  VoiceVisualPlan,
  VoiceVisualPlanContent,
} from './topic.ts';
import {finalRenderTimingToleranceSeconds} from './render.ts';

const TIMING_TOLERANCE_SECONDS = 0.001;

export function isDirectNarrationProject(project: TopicProject): boolean {
  return (
    project.outline?.generation.promptVersion === 'direct-narration-v1' &&
    project.voiceVisualPlan?.generation.promptVersion === 'direct-narration-v1'
  );
}

export function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function outlineIsCurrent(project: TopicProject): boolean {
  return Boolean(
    project.outline &&
      sameValue(project.outline.sourceInput, project.topicInput),
  );
}

export function outlineIsReady(project: TopicProject): boolean {
  return Boolean(
    project.outline?.status === 'approved' && outlineIsCurrent(project),
  );
}

export function outlineIsStale(project: TopicProject): boolean {
  return Boolean(project.outline && !outlineIsCurrent(project));
}

export function voiceVisualMatchesOutline(
  plan: Pick<VoiceVisualPlanContent, 'sections'>,
  outline: Pick<TeachingOutline, 'sections'>,
): boolean {
  return (
    plan.sections.length === outline.sections.length &&
    plan.sections.every(
      (section, index) =>
        section.outlineSectionId === outline.sections[index]?.id,
    )
  );
}

export function voiceVisualIsReady(project: TopicProject): boolean {
  const outline = project.outline;
  const plan = project.voiceVisualPlan;

  return Boolean(
    outline &&
      outlineIsReady(project) &&
      plan?.status === 'approved' &&
      plan.sourceOutlineContentRevision === outline.contentRevision &&
      voiceVisualMatchesOutline(plan, outline),
  );
}

export function voiceVisualIsStale(project: TopicProject): boolean {
  const outline = project.outline;
  const plan = project.voiceVisualPlan;
  if (!plan) return false;

  return Boolean(
    !outline ||
      !outlineIsReady(project) ||
      plan.sourceOutlineContentRevision !== outline.contentRevision ||
      !voiceVisualMatchesOutline(plan, outline),
  );
}

export function motionCanvasMatchesOutline(
  bundle: Pick<MotionCanvasBundle, 'scenes'>,
  outline: Pick<TeachingOutline, 'sections'>,
): boolean {
  return (
    bundle.scenes.length === outline.sections.length &&
    bundle.scenes.every(
      (scene, index) =>
        scene.outlineSectionId === outline.sections[index]?.id,
    )
  );
}

export function motionCanvasIsReady(project: TopicProject): boolean {
  return voiceVisualIsReady(project);
}

export function motionCanvasIsStale(project: TopicProject): boolean {
  const outline = project.outline;
  const plan = project.voiceVisualPlan;
  const bundle = project.motionCanvasBundle;
  if (!bundle) return false;

  return Boolean(
    !outline ||
      !plan ||
      !voiceVisualIsReady(project) ||
      bundle.sourceVoiceVisualContentRevision !== plan.contentRevision ||
      !motionCanvasMatchesOutline(bundle, outline),
  );
}

export function visualDesignMatchesMotion(
  design: NonNullable<TopicProject['visualDesignBundle']>,
  motion: NonNullable<TopicProject['motionCanvasBundle']>,
) {
  return (
    design.sourceMotionCanvasGenerationId ===
      motion.generation.generationId &&
    design.sourceMotionCanvasContentRevision === motion.contentRevision &&
    design.sourceMotionCanvasSourceHash === motion.validation.sourceHash
  );
}

export function voicePrerequisitesAreReady(project: TopicProject): boolean {
  const outline = project.outline;
  const plan = project.voiceVisualPlan;
  const motion = project.motionCanvasBundle;

  return Boolean(
    outline &&
      plan &&
      voiceVisualIsReady(project) &&
      motion?.status === 'approved' &&
      motion.sourceVoiceVisualContentRevision === plan.contentRevision &&
      motionCanvasMatchesOutline(motion, outline),
  );
}

export function voiceMatchesPlanStructure(
  bundle: Pick<VoiceBundle, 'sourceNarrationRevision' | 'sections'>,
  plan: Pick<VoiceVisualPlan, 'narrationRevision' | 'sections'>,
): boolean {
  return (
    bundle.sourceNarrationRevision === plan.narrationRevision &&
    bundle.sections.length === plan.sections.length &&
    bundle.sections.every((section, sectionIndex) => {
      const planSection = plan.sections[sectionIndex];
      return Boolean(
        planSection &&
          section.outlineSectionId === planSection.outlineSectionId &&
          section.beats.length === planSection.beats.length &&
          section.beats.every(
            (beat, beatIndex) =>
              beat.beatId === planSection.beats[beatIndex]?.id,
          ),
      );
    })
  );
}

export function voiceIsStale(project: TopicProject): boolean {
  const bundle = project.voiceBundle;
  const plan = project.voiceVisualPlan;
  if (!bundle) return false;

  return !plan || !voiceMatchesPlanStructure(bundle, plan);
}

export function animationSyncPrerequisitesAreReady(
  project: TopicProject,
): boolean {
  const plan = project.voiceVisualPlan;
  const voice = project.voiceBundle;

  return Boolean(
    plan &&
      voicePrerequisitesAreReady(project) &&
      voice?.status === 'approved' &&
      voiceMatchesPlanStructure(voice, plan),
  );
}

export function animationSyncMatchesSourcesStructure(
  bundle: Pick<
    AnimationSyncBundle,
    | 'sourceMotionCanvasContentRevision'
    | 'sourceVoiceContentRevision'
    | 'sourceVisualDesignContentRevision'
    | 'sections'
  >,
  motion: Pick<
    MotionCanvasBundle,
    'contentRevision' | 'timingContractVersion' | 'scenes'
  >,
  voice: Pick<VoiceBundle, 'contentRevision' | 'sections'>,
  _visualDesign: Pick<
    NonNullable<TopicProject['visualDesignBundle']>,
    'contentRevision'
  > | null = null,
): boolean {
  return (
    motion.timingContractVersion === 1 &&
    bundle.sourceMotionCanvasContentRevision === motion.contentRevision &&
    bundle.sourceVoiceContentRevision === voice.contentRevision &&
    bundle.sections.length === motion.scenes.length &&
    bundle.sections.length === voice.sections.length &&
    bundle.sections.every((section, sectionIndex) => {
      const scene = motion.scenes[sectionIndex];
      const voiceSection = voice.sections[sectionIndex];
      const timingEvents = scene?.timingEvents;

      return Boolean(
        scene &&
          voiceSection &&
          timingEvents &&
          section.sceneId === scene.id &&
          section.filePath === scene.filePath &&
          section.outlineSectionId === scene.outlineSectionId &&
          section.outlineSectionId === voiceSection.outlineSectionId &&
          section.beats.length === timingEvents.length &&
          section.beats.length === voiceSection.beats.length &&
          section.beats.every((beat, beatIndex) => {
            const timing = timingEvents[beatIndex];
            const voiceBeat = voiceSection.beats[beatIndex];

            return Boolean(
              timing &&
                voiceBeat &&
                beat.beatId === timing.beatId &&
                beat.beatId === voiceBeat.beatId &&
                beat.startEvent === timing.startEvent &&
                beat.endEvent === timing.endEvent &&
                Math.abs(
                  beat.voiceStartSeconds - voiceBeat.startSeconds,
                ) < TIMING_TOLERANCE_SECONDS &&
                Math.abs(beat.voiceEndSeconds - voiceBeat.endSeconds) <
                  TIMING_TOLERANCE_SECONDS,
            );
          }),
      );
    })
  );
}

export function animationSyncIsStale(project: TopicProject): boolean {
  const bundle = project.animationSyncBundle;
  const motion = project.motionCanvasBundle;
  const voice = project.voiceBundle;
  if (!bundle) return false;

  return Boolean(
    !motion ||
      !voice ||
      !animationSyncPrerequisitesAreReady(project) ||
      !animationSyncMatchesSourcesStructure(
        bundle,
        motion,
        voice,
        project.visualDesignBundle,
      ),
  );
}

export function layoutPrerequisitesAreReady(project: TopicProject): boolean {
  const sync = project.animationSyncBundle;
  const motion = project.motionCanvasBundle;
  const voice = project.voiceBundle;

  return Boolean(
    sync &&
      motion &&
      voice &&
      sync.status === 'approved' &&
      animationSyncPrerequisitesAreReady(project) &&
      animationSyncMatchesSourcesStructure(
        sync,
        motion,
        voice,
        project.visualDesignBundle,
      ),
  );
}

export function layoutMatchesAnimationSync(
  bundle: Pick<
    LayoutBundle,
    | 'sourceAnimationSyncContentRevision'
    | 'sourceAnimationSyncGenerationId'
    | 'sourceAnimationSyncSourceHash'
    | 'sourceWorkspacePath'
    | 'totalDurationSeconds'
    | 'scenes'
  >,
  sync: Pick<
    AnimationSyncBundle,
    | 'contentRevision'
    | 'totalDurationSeconds'
    | 'sections'
    | 'validation'
    | 'generation'
    | 'workspacePath'
  >,
): boolean {
  return (
    bundle.sourceAnimationSyncContentRevision === sync.contentRevision &&
    bundle.sourceAnimationSyncGenerationId ===
      sync.generation.generationId &&
    bundle.sourceAnimationSyncSourceHash === sync.validation.sourceHash &&
    bundle.sourceWorkspacePath === sync.workspacePath &&
    Math.abs(bundle.totalDurationSeconds - sync.totalDurationSeconds) <
      TIMING_TOLERANCE_SECONDS &&
    bundle.scenes.length === sync.sections.length &&
    bundle.scenes.every(
      (scene, index) =>
        scene.sceneId === sync.sections[index]?.sceneId &&
        scene.filePath === sync.sections[index]?.filePath,
    )
  );
}

export function layoutIsCurrent(project: TopicProject): boolean {
  const bundle = project.layoutBundle;
  const sync = project.animationSyncBundle;

  return Boolean(
    bundle &&
      sync &&
      layoutPrerequisitesAreReady(project) &&
      layoutMatchesAnimationSync(bundle, sync),
  );
}

export function layoutIsReady(project: TopicProject): boolean {
  return Boolean(
    project.layoutBundle?.status === 'approved' &&
      layoutIsCurrent(project),
  );
}

export function layoutIsStale(project: TopicProject): boolean {
  return Boolean(project.layoutBundle && !layoutIsCurrent(project));
}

export function finalRenderPrerequisitesAreReady(
  project: TopicProject,
): boolean {
  return layoutIsReady(project);
}

export function finalRenderMatchesLayout(
  bundle: Pick<
    FinalRenderBundle,
    | 'sourceLayoutContentRevision'
    | 'sourceLayoutGenerationId'
    | 'sourceLayoutSourceHash'
    | 'durationSeconds'
    | 'watermark'
    | 'fps'
  >,
  layout: Pick<
    LayoutBundle,
    | 'contentRevision'
    | 'totalDurationSeconds'
    | 'generation'
    | 'validation'
    | 'renderSettings'
  >,
): boolean {
  return (
    bundle.sourceLayoutContentRevision === layout.contentRevision &&
    bundle.sourceLayoutGenerationId === layout.generation.generationId &&
    bundle.sourceLayoutSourceHash === layout.validation.sourceHash &&
    sameValue(bundle.watermark, layout.renderSettings.watermark) &&
    Math.abs(
      bundle.durationSeconds - layout.totalDurationSeconds,
    ) <
      finalRenderTimingToleranceSeconds(
        bundle.fps,
        bundle.durationSeconds,
      )
  );
}

export function finalRenderIsCurrent(project: TopicProject): boolean {
  const bundle = project.renderBundle;
  const layout = project.layoutBundle;

  return Boolean(
    bundle &&
      layout &&
      finalRenderPrerequisitesAreReady(project) &&
      finalRenderMatchesLayout(bundle, layout),
  );
}

export function finalRenderIsReady(project: TopicProject): boolean {
  return Boolean(
    project.renderBundle?.status === 'completed' &&
      finalRenderIsCurrent(project),
  );
}

export function finalRenderIsStale(project: TopicProject): boolean {
  return Boolean(project.renderBundle && !finalRenderIsCurrent(project));
}
