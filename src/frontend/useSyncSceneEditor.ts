import {useEffect, useRef, useState} from 'react';
import type {LayoutNodeOverride, LayoutRenderSettings} from '../shared/layout.ts';
import {
  layoutIsCurrent,
  layoutPrerequisitesAreReady,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  approveLayout,
  commitLayoutDesign,
  getLayoutPreview,
} from './api.ts';
import type {useMotionCanvasDraft} from './useMotionCanvasDraft.ts';

type PreviewState = 'idle' | 'loading' | 'ready' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Drives the single interactive scene editor for step 4: it opens the
 * Motion Canvas Layout Editor runtime against the *retimed, narrated*
 * Animation Sync workspace (so playback has real audio) and saves every
 * edit straight into `layoutBundle` — the same artifact Final Render reads.
 */
export function useSyncSceneEditor(
  projectId: string,
  motionCanvas: ReturnType<typeof useMotionCanvasDraft>,
) {
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewGenerationId, setPreviewGenerationId] = useState('');
  const [previewSessionNonce, setPreviewSessionNonce] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewRetryKey, setPreviewRetryKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [approving, setApproving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const project = motionCanvas.project;
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const saveChainRef = useRef(Promise.resolve());
  const baseGenerationIdRef = useRef<string | null>(null);

  const syncGenerationId =
    project?.animationSyncBundle?.generation.generationId ?? '';
  const syncReady = project ? layoutPrerequisitesAreReady(project) : false;

  useEffect(() => {
    setSaveState('idle');
    setSaveError('');
    setApproving(false);
    setConflict(false);
    saveChainRef.current = Promise.resolve();
  }, [projectId, syncGenerationId]);

  useEffect(() => {
    let active = true;
    if (!syncGenerationId || !syncReady) {
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
    baseGenerationIdRef.current =
      projectRef.current?.layoutBundle?.generation.generationId ?? null;
    void getLayoutPreview(projectId)
      .then((preview) => {
        if (!active || preview.sourceSyncGenerationId !== syncGenerationId) {
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
            : 'Không thể mở editor scene.',
        );
        setPreviewState('error');
      });
    return () => {
      active = false;
    };
  }, [projectId, syncGenerationId, syncReady, previewRetryKey]);

  function saveDesign(
    overrides: LayoutNodeOverride[],
    renderSettings: LayoutRenderSettings,
    sessionNonce = previewSessionNonce,
  ) {
    if (!sessionNonce || conflict) return Promise.resolve(null);
    setSaveState('saving');
    setSaveError('');
    const run = saveChainRef.current.catch(() => undefined).then(async () => {
      const currentProject = projectRef.current;
      const sync = currentProject?.animationSyncBundle;
      if (!currentProject || !sync) return null;
      try {
        const updatedProject = await commitLayoutDesign(
          projectId,
          {
            generationId: crypto.randomUUID(),
            baseGenerationId: baseGenerationIdRef.current,
            sourceAnimationSyncGenerationId: sync.generation.generationId,
            sessionNonce,
            overrides,
            renderSettings,
          },
          currentProject.revision,
        );
        baseGenerationIdRef.current =
          updatedProject.layoutBundle?.generation.generationId ??
          baseGenerationIdRef.current;
        motionCanvas.adoptProject(updatedProject);
        setSaveState('saved');
        return updatedProject;
      } catch (error) {
        const isConflict =
          error instanceof ApiRequestError &&
          error.code === 'PROJECT_CONFLICT';
        if (isConflict) setConflict(true);
        setSaveError(
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể lưu chỉnh sửa scene.',
        );
        setSaveState('error');
        return null;
      }
    });
    saveChainRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function approve() {
    const currentProject = projectRef.current;
    const layout = currentProject?.layoutBundle;
    if (
      !currentProject ||
      !layout ||
      approving ||
      conflict ||
      saveState === 'saving' ||
      saveState === 'error'
    ) {
      return null;
    }
    setApproving(true);
    setSaveError('');
    try {
      const updatedProject = await approveLayout(
        projectId,
        {generationId: layout.generation.generationId},
        currentProject.revision,
      );
      motionCanvas.adoptProject(updatedProject);
      return updatedProject;
    } catch (error) {
      const isConflict =
        error instanceof ApiRequestError && error.code === 'PROJECT_CONFLICT';
      if (isConflict) setConflict(true);
      setSaveError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể duyệt bản chỉnh sửa.',
      );
      return null;
    } finally {
      setApproving(false);
    }
  }

  return {
    previewState,
    previewUrl,
    previewGenerationId,
    previewSessionNonce,
    previewError,
    retryPreview: () => setPreviewRetryKey((current) => current + 1),
    saveState,
    saveError,
    saveDesign,
    approving,
    approve,
    conflict,
    hasUnsavedChanges: saveState === 'saving' || saveState === 'error',
    ready: project ? layoutIsCurrent(project) : false,
  };
}
