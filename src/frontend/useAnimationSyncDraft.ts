import {useEffect, useRef, useState} from 'react';
import type {TopicProject} from '../shared/topic.ts';
import {
  animationSyncIsStale,
  animationSyncPrerequisitesAreReady,
} from '../shared/projectPipeline.ts';
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
  const previewIsStale = project
    ? animationSyncIsStale(project)
    : false;
  useEffect(() => {
    let active = true;
    if (!previewGenerationId || previewIsStale) {
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
  }, [
    previewGenerationId,
    previewIsStale,
    previewRetryKey,
    projectId,
  ]);

  async function generate() {
    if (generating || conflict) return null;
    setGenerating(true);
    setActionError('');

    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = projectRef.current;
          if (!currentProject) throw new AnimationSyncOperationCancelledError();
          if (!animationSyncPrerequisitesAreReady(currentProject)) {
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
          if (animationSyncIsStale(currentProject)) {
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

  const upstreamReady = project
    ? animationSyncPrerequisitesAreReady(project)
    : false;
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
    stale: project ? animationSyncIsStale(project) : false,
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
