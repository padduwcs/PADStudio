import {useEffect, useRef, useState} from 'react';
import type {
  LayoutNodeOverride,
  LayoutOverridesDocument,
} from '../shared/layout.ts';
import type {TopicProject} from '../shared/topic.ts';
import {
  layoutIsStale,
  layoutPrerequisitesAreReady,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  approveLayout,
  commitLayout,
  getLayoutPreview,
  getLayoutState,
  getProject,
  type LayoutStatePayload,
} from './api.ts';
import {ProjectOperationQueue} from './projectOperationQueue.ts';

type LoadState = 'loading' | 'ready' | 'error';
type PreviewState = 'idle' | 'loading' | 'ready' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type ActionErrorKind = 'save' | 'approve' | null;

export function useLayoutEditor(projectId: string) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [layoutState, setLayoutState] =
    useState<LayoutStatePayload | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [previewState, setPreviewState] =
    useState<PreviewState>('idle');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewGenerationId, setPreviewGenerationId] = useState('');
  const [previewSessionNonce, setPreviewSessionNonce] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewRetryKey, setPreviewRetryKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [actionError, setActionError] = useState('');
  const [actionErrorKind, setActionErrorKind] =
    useState<ActionErrorKind>(null);
  const [approving, setApproving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const projectRef = useRef<TopicProject | null>(null);
  const layoutStateRef = useRef<LayoutStatePayload | null>(null);
  const conflictRef = useRef(false);
  const approvingRef = useRef(false);
  const sessionRef = useRef(0);
  const operationQueueRef = useRef(new ProjectOperationQueue());
  const saveSequenceRef = useRef(0);
  const commitRequestRef = useRef<{
    fingerprint: string;
    generationId: string;
  } | null>(null);

  function publishProject(value: TopicProject) {
    projectRef.current = value;
    setProject(value);
  }

  function publishLayoutState(value: LayoutStatePayload | null) {
    layoutStateRef.current = value;
    setLayoutState(value);
  }

  useEffect(() => {
    let active = true;
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    projectRef.current = null;
    layoutStateRef.current = null;
    operationQueueRef.current = new ProjectOperationQueue();
    saveSequenceRef.current = 0;
    commitRequestRef.current = null;
    setProject(null);
    setLayoutState(null);
    setLoadState('loading');
    setLoadError('');
    setActionError('');
    setActionErrorKind(null);
    conflictRef.current = false;
    setConflict(false);
    setSaveState('idle');
    approvingRef.current = false;
    setApproving(false);

    void getProject(projectId)
      .then(async (loadedProject) => {
        if (!active || sessionRef.current !== session) return;
        publishProject(loadedProject);
        if (!layoutPrerequisitesAreReady(loadedProject)) {
          setLoadState('ready');
          return;
        }
        const loadedLayout = await getLayoutState(projectId);
        if (!active || sessionRef.current !== session) return;
        publishLayoutState(loadedLayout);
        setLoadState('ready');
      })
      .catch((error) => {
        if (!active || sessionRef.current !== session) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể mở dữ liệu Layout Editor.',
        );
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [projectId, reloadKey]);

  const sourceSyncGenerationId =
    project?.animationSyncBundle?.generation.generationId ?? '';

  useEffect(() => {
    let active = true;
    if (
      loadState !== 'ready' ||
      !project ||
      !layoutPrerequisitesAreReady(project) ||
      !sourceSyncGenerationId
    ) {
      setPreviewState('idle');
      setPreviewUrl('');
      setPreviewGenerationId('');
      setPreviewSessionNonce('');
      setPreviewError('');
      return () => {
        active = false;
      };
    }

    setPreviewState('loading');
    setPreviewUrl('');
    setPreviewGenerationId('');
    setPreviewSessionNonce('');
    setPreviewError('');
    void getLayoutPreview(projectId, sourceSyncGenerationId)
      .then((preview) => {
        if (
          !active ||
          preview.sourceSyncGenerationId !==
            sourceSyncGenerationId
        ) {
          return;
        }
        setPreviewUrl(preview.url);
        setPreviewGenerationId(preview.generationId);
        setPreviewSessionNonce(preview.sessionNonce);
        setPreviewState('ready');
      })
      .catch((error) => {
        if (!active) return;
        setPreviewError(
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể khởi động Layout Editor runtime.',
        );
        setPreviewState('error');
      });

    return () => {
      active = false;
    };
  }, [
    loadState,
    previewRetryKey,
    projectId,
    sourceSyncGenerationId,
  ]);

  async function save(
    overrides: LayoutNodeOverride[],
    sessionNonce = previewSessionNonce,
  ) {
    const session = sessionRef.current;
    if (!sessionNonce || conflictRef.current) return null;
    const saveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = saveSequence;
    setSaveState('saving');
    setActionError('');
    setActionErrorKind(null);

    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          if (
            sessionRef.current !== session ||
            conflictRef.current
          ) {
            throw new StaleLayoutSessionError();
          }
          const currentProject = projectRef.current;
          const sync = currentProject?.animationSyncBundle;
          if (
            !currentProject ||
            !sync ||
            !layoutPrerequisitesAreReady(currentProject)
          ) {
            throw new LayoutInputOutdatedError();
          }

          const currentBundle = currentProject.layoutBundle;
          const fingerprint = JSON.stringify({
            sourceGenerationId: sync.generation.generationId,
            baseGenerationId: currentBundle?.generation.generationId ?? null,
            overrides,
          });
          const previousRequest = commitRequestRef.current;
          const generationId =
            previousRequest?.fingerprint === fingerprint
              ? previousRequest.generationId
              : crypto.randomUUID();
          commitRequestRef.current = {fingerprint, generationId};

          return commitLayout(
            projectId,
            {
              generationId,
              baseGenerationId:
                currentBundle?.generation.generationId ?? null,
              sourceAnimationSyncGenerationId:
                sync.generation.generationId,
              sessionNonce,
              overrides,
            },
            currentProject.revision,
          );
        },
      );

      if (sessionRef.current !== session) return null;
      publishProject(updatedProject);
      const sync = updatedProject.animationSyncBundle!;
      const previousState = layoutStateRef.current;
      const nextDocument: LayoutOverridesDocument = {
        version: 1,
        sourceAnimationSyncGenerationId: sync.generation.generationId,
        sourceAnimationSyncContentRevision: sync.contentRevision,
        sourceAnimationSyncSourceHash: sync.validation.sourceHash,
        overrides,
      };
      publishLayoutState({
        bundle: updatedProject.layoutBundle,
        overrides: nextDocument,
        manifest: previousState?.manifest ?? null,
      });
      commitRequestRef.current = null;
      if (saveSequenceRef.current === saveSequence) {
        setSaveState('saved');
      }
      return updatedProject;
    } catch (error) {
      if (
        error instanceof StaleLayoutSessionError ||
        sessionRef.current !== session
      ) {
        return null;
      }
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) {
        conflictRef.current = true;
        setConflict(true);
        if (error.currentProject) publishProject(error.currentProject);
      }
      setActionError(
        error instanceof LayoutInputOutdatedError
          ? 'Bản đồng bộ nguồn đã thay đổi. Hãy tải lại Layout Editor.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể tự lưu chỉnh sửa layout.',
      );
      setActionErrorKind('save');
      if (saveSequenceRef.current === saveSequence) {
        setSaveState('error');
      }
      return null;
    }
  }

  async function approve() {
    const session = sessionRef.current;
    if (approvingRef.current || conflictRef.current) return null;
    approvingRef.current = true;
    setApproving(true);
    setActionError('');
    setActionErrorKind(null);

    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          if (
            sessionRef.current !== session ||
            conflictRef.current
          ) {
            throw new StaleLayoutSessionError();
          }
          const currentProject = projectRef.current;
          const bundle = currentProject?.layoutBundle;
          if (
            !currentProject ||
            !bundle ||
            layoutIsStale(currentProject)
          ) {
            throw new LayoutInputOutdatedError();
          }
          return approveLayout(
            projectId,
            {generationId: bundle.generation.generationId},
            currentProject.revision,
          );
        },
      );
      if (sessionRef.current !== session) return null;
      publishProject(updatedProject);
      const currentState = layoutStateRef.current;
      if (currentState) {
        publishLayoutState({
          ...currentState,
          bundle: updatedProject.layoutBundle,
        });
      }
      return updatedProject;
    } catch (error) {
      if (
        error instanceof StaleLayoutSessionError ||
        sessionRef.current !== session
      ) {
        return null;
      }
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) {
        conflictRef.current = true;
        setConflict(true);
        if (error.currentProject) publishProject(error.currentProject);
      }
      setActionError(
        error instanceof LayoutInputOutdatedError
          ? 'Layout không còn khớp bản đồng bộ hiện tại.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể chốt layout lúc này.',
      );
      setActionErrorKind('approve');
      return null;
    } finally {
      if (sessionRef.current === session) {
        approvingRef.current = false;
        setApproving(false);
      }
    }
  }

  function clearActionError() {
    setActionError('');
    setActionErrorKind(null);
  }

  return {
    project,
    layoutState,
    loadRevision: reloadKey,
    loadState,
    loadError,
    previewState,
    previewUrl,
    previewGenerationId,
    previewSessionNonce,
    previewError,
    saveState,
    actionError,
    actionErrorKind,
    approving,
    conflict,
    ready: project ? layoutPrerequisitesAreReady(project) : false,
    stale: project ? layoutIsStale(project) : false,
    save,
    approve,
    clearActionError,
    retryPreview: () =>
      setPreviewRetryKey((current) => current + 1),
    reload: () => setReloadKey((current) => current + 1),
  };
}

class LayoutInputOutdatedError extends Error {}
class StaleLayoutSessionError extends Error {}
