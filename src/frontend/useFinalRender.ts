import {useEffect, useRef, useState} from 'react';
import type {
  FinalRenderJobStatus,
  GenerateFinalRender,
} from '../shared/render.ts';
import type {TopicProject} from '../shared/topic.ts';
import {
  finalRenderIsReady,
  finalRenderPrerequisitesAreReady,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  generateFinalRender,
  getFinalRenderStatus,
  getProject,
} from './api.ts';

type LoadState = 'loading' | 'ready' | 'error';

function jobIsActive(status: FinalRenderJobStatus | null) {
  return Boolean(
    status &&
      !['completed', 'failed'].includes(status.state),
  );
}

export function useFinalRender(projectId: string) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [status, setStatus] = useState<FinalRenderJobStatus | null>(null);
  const [generationId, setGenerationId] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const projectRef = useRef<TopicProject | null>(null);
  const renderingRef = useRef(false);

  function publishProject(value: TopicProject) {
    projectRef.current = value;
    setProject(value);
  }

  useEffect(() => {
    let active = true;
    projectRef.current = null;
    renderingRef.current = false;
    setProject(null);
    setStatus(null);
    setGenerationId('');
    setConflict(false);
    setActionError('');
    setLoadError('');
    setLoadState('loading');
    void Promise.all([
      getProject(projectId),
      getFinalRenderStatus(projectId),
    ])
      .then(([loadedProject, latestStatus]) => {
        if (!active) return;
        publishProject(loadedProject);
        setStatus(latestStatus);
        if (latestStatus) {
          setGenerationId(latestStatus.generationId);
          renderingRef.current = jobIsActive(latestStatus);
          if (latestStatus.state === 'failed') {
            setActionError(latestStatus.message);
          }
        }
        setLoadState('ready');
      })
      .catch(error => {
        if (!active) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể mở bước final render.',
        );
        setLoadState('error');
      });
    return () => {
      active = false;
    };
  }, [projectId, reloadKey]);

  useEffect(() => {
    if (!generationId || !jobIsActive(status)) return;
    let active = true;
    let timer: number | null = null;
    let completedProjectRetries = 0;
    const poll = async () => {
      try {
        const nextStatus = await getFinalRenderStatus(
          projectId,
          generationId,
        );
        if (!active) return;
        if (!nextStatus) {
          timer = window.setTimeout(poll, 700);
          return;
        }
        setActionError('');
        setStatus(nextStatus);
        renderingRef.current = jobIsActive(nextStatus);
        if (nextStatus.state === 'completed') {
          const updatedProject = await getProject(projectId);
          if (!active) return;
          publishProject(updatedProject);
          if (
            updatedProject.renderBundle?.generation.generationId !==
            generationId
          ) {
            completedProjectRetries += 1;
            if (completedProjectRetries < 20) {
              timer = window.setTimeout(poll, 700);
            } else {
              setActionError(
                'Video đã dựng xong nhưng project đã thay đổi trước khi ghi nhận kết quả. Hãy kiểm tra lại nguồn và render lại.',
              );
            }
            return;
          }
        } else if (nextStatus.state === 'failed') {
          setActionError(nextStatus.message);
        }
        if (jobIsActive(nextStatus)) {
          timer = window.setTimeout(poll, 700);
        }
      } catch (error) {
        if (!active) return;
        setActionError(
          error instanceof ApiRequestError
            ? error.message
            : 'Mất kết nối với tiến trình render.',
        );
        timer = window.setTimeout(poll, 1_500);
      }
    };
    timer = window.setTimeout(poll, 350);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [generationId, projectId]);

  async function render(
    options: Omit<GenerateFinalRender, 'generationId'> = {
      playbackRate: 1,
      watermark: {type: 'none'},
    },
  ) {
    if (renderingRef.current || conflict) return null;
    const currentProject = projectRef.current;
    if (!currentProject || !finalRenderPrerequisitesAreReady(currentProject)) {
      setActionError('Hãy duyệt Layout hiện hành trước khi render video cuối.');
      return null;
    }
    const nextGenerationId = crypto.randomUUID();
    const queuedAt = new Date().toISOString();
    const totalFrames = Math.ceil(
      ((currentProject.layoutBundle?.totalDurationSeconds ?? 0) /
        options.playbackRate) * 30,
    ) + 1;
    renderingRef.current = true;
    setGenerationId(nextGenerationId);
    setActionError('');
    setStatus({
      generationId: nextGenerationId,
      state: 'queued',
      progress: 0,
      renderedFrames: 0,
      totalFrames,
      startedAt: null,
      updatedAt: queuedAt,
      message: 'Đang gửi yêu cầu render…',
      errorCode: null,
    });
    try {
      const startedStatus = await generateFinalRender(
        projectId,
        {generationId: nextGenerationId, ...options},
        currentProject.revision,
      );
      renderingRef.current = jobIsActive(startedStatus);
      setStatus(startedStatus);
      if (startedStatus.state === 'completed') {
        const updatedProject = await getProject(projectId);
        publishProject(updatedProject);
        return updatedProject;
      }
      return currentProject;
    } catch (error) {
      renderingRef.current = false;
      const isConflict =
        error instanceof ApiRequestError && error.code === 'PROJECT_CONFLICT';
      if (isConflict) {
        setConflict(true);
        if (error.currentProject) publishProject(error.currentProject);
      }
      let message =
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể hoàn tất final render lúc này.';
      try {
        const failedStatus = await getFinalRenderStatus(
          projectId,
          nextGenerationId,
        );
        if (failedStatus?.state === 'failed') {
          setStatus(failedStatus);
          message = failedStatus.message;
        }
      } catch {
        // Giữ lỗi từ request chính nếu status endpoint cũng không khả dụng.
      }
      setActionError(message);
      setStatus(previous =>
        previous?.state !== 'failed'
          ? {
              ...(previous ?? {
                generationId: nextGenerationId,
                progress: 0,
                renderedFrames: 0,
                totalFrames,
                startedAt: null,
              }),
              state: 'failed',
              updatedAt: new Date().toISOString(),
              message,
              errorCode:
                error instanceof ApiRequestError ? error.code : 'REQUEST_ERROR',
            }
          : previous,
      );
      return null;
    }
  }

  return {
    project,
    loadState,
    loadError,
    actionError,
    status,
    conflict,
    rendering: jobIsActive(status),
    ready: project ? finalRenderIsReady(project) : false,
    prerequisitesReady: project
      ? finalRenderPrerequisitesAreReady(project)
      : false,
    render,
    reload: () => setReloadKey(current => current + 1),
  };
}
