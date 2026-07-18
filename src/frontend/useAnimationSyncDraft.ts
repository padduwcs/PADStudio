import {useEffect, useRef, useState} from 'react';
import type {TopicProject} from '../shared/topic.ts';
import {
  ApiRequestError,
  approveAnimationSync,
  generateAnimationSync,
  getAnimationSyncPreview,
  getProject,
} from './api.ts';
import {ProjectOperationQueue} from './projectOperationQueue.ts';

type LoadState = 'loading' | 'ready' | 'error';
type PreviewState = 'idle' | 'loading' | 'ready' | 'error';

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function upstreamIsApproved(project: TopicProject) {
  const outline = project.outline;
  const plan = project.voiceVisualPlan;
  const motion = project.motionCanvasBundle;
  const voice = project.voiceBundle;

  return Boolean(
    outline?.status === 'approved' &&
      sameValue(outline.sourceInput, project.topicInput) &&
      plan?.status === 'approved' &&
      plan.sourceOutlineContentRevision === outline.contentRevision &&
      motion?.status === 'approved' &&
      motion.sourceVoiceVisualContentRevision === plan.contentRevision &&
      voice?.status === 'approved' &&
      voice.sourceVoiceVisualContentRevision === plan.contentRevision &&
      outline.sections.length === plan.sections.length &&
      outline.sections.length === motion.scenes.length &&
      outline.sections.length === voice.sections.length &&
      outline.sections.every(
        (section, index) =>
          plan.sections[index]?.outlineSectionId === section.id &&
          motion.scenes[index]?.outlineSectionId === section.id &&
          voice.sections[index]?.outlineSectionId === section.id,
      ),
  );
}

function syncIsStale(project: TopicProject) {
  const sync = project.animationSyncBundle;
  const motion = project.motionCanvasBundle;
  const voice = project.voiceBundle;
  if (!sync) return false;

  return Boolean(
    !motion ||
      !voice ||
      !upstreamIsApproved(project) ||
      motion.timingContractVersion !== 1 ||
      sync.sourceMotionCanvasContentRevision !== motion.contentRevision ||
      sync.sourceVoiceContentRevision !== voice.contentRevision ||
      sync.sections.length !== motion.scenes.length ||
      sync.sections.length !== voice.sections.length ||
      !sync.sections.every((section, sectionIndex) => {
        const scene = motion.scenes[sectionIndex];
        const voiceSection = voice.sections[sectionIndex];
        return (
          scene &&
          voiceSection &&
          scene.timingEvents &&
          section.sceneId === scene.id &&
          section.filePath === scene.filePath &&
          section.outlineSectionId === scene.outlineSectionId &&
          section.outlineSectionId === voiceSection.outlineSectionId &&
          section.beats.length === scene.timingEvents.length &&
          section.beats.length === voiceSection.beats.length &&
          section.beats.every((beat, beatIndex) => {
            const timing = scene.timingEvents?.[beatIndex];
            const voiceBeat = voiceSection.beats[beatIndex];
            return (
              timing &&
              voiceBeat &&
              beat.beatId === timing.beatId &&
              beat.beatId === voiceBeat.beatId &&
              beat.startEvent === timing.startEvent &&
              beat.endEvent === timing.endEvent &&
              Math.abs(beat.voiceStartSeconds - voiceBeat.startSeconds) <
                0.001 &&
              Math.abs(beat.voiceEndSeconds - voiceBeat.endSeconds) < 0.001
            );
          })
        );
      }),
  );
}

export function useAnimationSyncDraft(projectId: string) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [serveCommand, setServeCommand] = useState('');
  const [previewState, setPreviewState] =
    useState<PreviewState>('idle');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewRetryKey, setPreviewRetryKey] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const projectRef = useRef<TopicProject | null>(null);
  const sessionRef = useRef(0);
  const operationQueueRef = useRef(new ProjectOperationQueue());
  const generationRequestRef = useRef<{
    fingerprint: string;
    generationId: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    projectRef.current = null;
    operationQueueRef.current = new ProjectOperationQueue();
    generationRequestRef.current = null;
    setProject(null);
    setServeCommand('');
    setLoadState('loading');
    setLoadError('');
    setActionError('');
    setConflict(false);
    setGenerating(false);
    setApproving(false);

    void getProject(projectId)
      .then((loadedProject) => {
        if (!active || sessionRef.current !== session) return;
        projectRef.current = loadedProject;
        setProject(loadedProject);
        setServeCommand(
          loadedProject.animationSyncBundle
            ? `npm run sync:serve -- --project ${loadedProject.id}`
            : '',
        );
        setLoadState('ready');
      })
      .catch((error) => {
        if (!active || sessionRef.current !== session) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể mở bước đồng bộ animation.',
        );
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [projectId, reloadKey]);

  const previewGenerationId =
    project?.animationSyncBundle?.generation.generationId ?? '';
  useEffect(() => {
    let active = true;
    if (!previewGenerationId) {
      setPreviewState('idle');
      setPreviewUrl('');
      setPreviewError('');
      return () => {
        active = false;
      };
    }

    setPreviewState('loading');
    setPreviewUrl('');
    setPreviewError('');
    void getAnimationSyncPreview(projectId, previewGenerationId)
      .then((preview) => {
        if (
          !active ||
          preview.generationId !== previewGenerationId
        ) {
          return;
        }
        setPreviewUrl(preview.url);
        setPreviewState('ready');
      })
      .catch((error) => {
        if (!active) return;
        setPreviewError(
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể mở player cho bản nháp đồng bộ.',
        );
        setPreviewState('error');
      });

    return () => {
      active = false;
    };
  }, [projectId, previewGenerationId, previewRetryKey]);

  async function generate() {
    if (generating || conflict) return null;
    setGenerating(true);
    setActionError('');

    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = projectRef.current;
          if (!currentProject) throw new AnimationSyncOperationCancelledError();
          if (!upstreamIsApproved(currentProject)) {
            throw new AnimationSyncInputNotReadyError();
          }
          if (currentProject.motionCanvasBundle?.timingContractVersion !== 1) {
            throw new AnimationSyncLegacySceneError();
          }

          const fingerprint = JSON.stringify({
            projectId,
            revision: currentProject.revision,
            motionRevision:
              currentProject.motionCanvasBundle.contentRevision,
            voiceRevision: currentProject.voiceBundle?.contentRevision,
          });
          const previousRequest = generationRequestRef.current;
          const generationId =
            previousRequest?.fingerprint === fingerprint
              ? previousRequest.generationId
              : crypto.randomUUID();
          generationRequestRef.current = {fingerprint, generationId};

          return generateAnimationSync(
            projectId,
            {generationId},
            currentProject.revision,
          );
        },
      );
      projectRef.current = updatedProject;
      setProject(updatedProject);
      generationRequestRef.current = null;
      setServeCommand(
        `npm run sync:serve -- --project ${updatedProject.id}`,
      );
      return updatedProject;
    } catch (error) {
      if (error instanceof AnimationSyncOperationCancelledError) return null;
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) {
        setConflict(true);
        if (error.currentProject) {
          projectRef.current = error.currentProject;
          setProject(error.currentProject);
        }
      }
      setActionError(
        error instanceof AnimationSyncInputNotReadyError
          ? 'Hãy chốt Motion Canvas và voice hiện tại trước khi đồng bộ.'
          : error instanceof AnimationSyncLegacySceneError
            ? 'Scene hiện tại là bản legacy. Hãy sinh lại Motion Canvas để có timing contract.'
            : error instanceof ApiRequestError
              ? error.message
              : 'Không thể đồng bộ animation lúc này.',
      );
      return null;
    } finally {
      setGenerating(false);
    }
  }

  async function approve() {
    if (approving || conflict) return null;
    setApproving(true);
    setActionError('');

    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = projectRef.current;
          if (!currentProject) throw new AnimationSyncOperationCancelledError();
          if (syncIsStale(currentProject)) {
            throw new AnimationSyncOutdatedError();
          }
          return approveAnimationSync(
            projectId,
            currentProject.revision,
          );
        },
      );
      projectRef.current = updatedProject;
      setProject(updatedProject);
      return updatedProject;
    } catch (error) {
      if (error instanceof AnimationSyncOperationCancelledError) return null;
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) setConflict(true);
      setActionError(
        error instanceof AnimationSyncOutdatedError
          ? 'Scene hoặc voice đã thay đổi. Hãy đồng bộ lại trước khi chốt.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể chốt bản đồng bộ lúc này.',
      );
      return null;
    } finally {
      setApproving(false);
    }
  }

  const upstreamReady = project ? upstreamIsApproved(project) : false;
  const legacy = Boolean(
    project?.motionCanvasBundle &&
      project.motionCanvasBundle.timingContractVersion !== 1,
  );

  return {
    project,
    serveCommand,
    previewState,
    previewUrl,
    previewError,
    loadState,
    loadError,
    actionError,
    generating,
    approving,
    conflict,
    upstreamReady,
    ready: upstreamReady && !legacy,
    legacy,
    stale: project ? syncIsStale(project) : false,
    generate,
    approve,
    retryPreview: () =>
      setPreviewRetryKey((current) => current + 1),
    reload: () => setReloadKey((current) => current + 1),
  };
}

class AnimationSyncOperationCancelledError extends Error {}
class AnimationSyncInputNotReadyError extends Error {}
class AnimationSyncLegacySceneError extends Error {}
class AnimationSyncOutdatedError extends Error {}
