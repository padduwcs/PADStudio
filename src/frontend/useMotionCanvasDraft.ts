import {useEffect, useRef, useState} from 'react';
import type {TopicProject} from '../shared/topic.ts';
import {
  motionCanvasIsReady,
  motionCanvasIsStale,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  approveMotionCanvas,
  generateMotionCanvas,
  getMotionCanvasFiles,
  getProject,
} from './api.ts';
import {ProjectOperationQueue} from './projectOperationQueue.ts';

type LoadState = 'loading' | 'ready' | 'error';

export function useMotionCanvasDraft(projectId: string) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [files, setFiles] = useState<Array<{path: string; source: string}>>(
    [],
  );
  const [serveCommand, setServeCommand] = useState('');
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

  async function loadFiles(loadedProject: TopicProject, session: number) {
    if (!loadedProject.motionCanvasBundle) {
      setFiles([]);
      setServeCommand('');
      return;
    }

    const workspace = await getMotionCanvasFiles(loadedProject.id);
    if (sessionRef.current !== session) return;
    setFiles(workspace.files);
    setServeCommand(workspace.serveCommand);
  }

  useEffect(() => {
    let active = true;
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    operationQueueRef.current = new ProjectOperationQueue();
    generationRequestRef.current = null;
    projectRef.current = null;
    setProject(null);
    setFiles([]);
    setServeCommand('');
    setLoadState('loading');
    setLoadError('');
    setActionError('');
    setConflict(false);
    setGenerating(false);
    setApproving(false);

    void getProject(projectId)
      .then(async (loadedProject) => {
        if (!active || sessionRef.current !== session) return;
        projectRef.current = loadedProject;
        setProject(loadedProject);
        await loadFiles(loadedProject, session);
        if (active && sessionRef.current === session) setLoadState('ready');
      })
      .catch((error) => {
        if (!active || sessionRef.current !== session) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể mở bước Motion Canvas.',
        );
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [projectId, reloadKey]);

  async function generate(guidance: string) {
    if (generating || conflict) return null;
    setGenerating(true);
    setActionError('');

    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = projectRef.current;
          if (!currentProject) throw new MotionCanvasOperationCancelledError();
          if (!motionCanvasIsReady(currentProject)) {
            throw new MotionCanvasInputNotReadyError();
          }

          const normalizedGuidance = guidance.trim() || undefined;
          if (
            normalizedGuidance &&
            motionCanvasIsStale(currentProject)
          ) {
            throw new MotionCanvasOutdatedError();
          }
          const fingerprint = JSON.stringify({
            projectId,
            revision: currentProject.revision,
            guidance: normalizedGuidance,
          });
          const previousRequest = generationRequestRef.current;
          const generationId =
            previousRequest?.fingerprint === fingerprint
              ? previousRequest.generationId
              : crypto.randomUUID();
          generationRequestRef.current = {fingerprint, generationId};

          return generateMotionCanvas(
            projectId,
            {generationId, guidance: normalizedGuidance},
            currentProject.revision,
          );
        },
      );
      const session = sessionRef.current;
      projectRef.current = updatedProject;
      setProject(updatedProject);
      generationRequestRef.current = null;
      try {
        await loadFiles(updatedProject, session);
      } catch {
        if (sessionRef.current === session) {
          setFiles([]);
          setServeCommand(
            `npm run motion:serve -- --project ${updatedProject.id}`,
          );
          setActionError(
            'Scene đã được sinh nhưng chưa đọc lại được source preview. Hãy tải lại trang.',
          );
        }
      }
      return updatedProject;
    } catch (error) {
      if (error instanceof MotionCanvasOperationCancelledError) return null;
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) setConflict(true);
      setActionError(
        error instanceof MotionCanvasInputNotReadyError
          ? 'Hãy chốt kế hoạch voice–visual trước khi sinh scene.'
          : error instanceof MotionCanvasOutdatedError
            ? 'Kế hoạch voice–visual đã thay đổi. Hãy sinh lại toàn bộ scene.'
            : error instanceof ApiRequestError
              ? error.message
              : 'Không thể sinh scene Motion Canvas lúc này.',
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
          if (!currentProject) throw new MotionCanvasOperationCancelledError();
          if (motionCanvasIsStale(currentProject)) {
            throw new MotionCanvasOutdatedError();
          }
          return approveMotionCanvas(
            projectId,
            currentProject.revision,
          );
        },
      );
      projectRef.current = updatedProject;
      setProject(updatedProject);
      return updatedProject;
    } catch (error) {
      if (error instanceof MotionCanvasOperationCancelledError) return null;
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) setConflict(true);
      setActionError(
        error instanceof MotionCanvasOutdatedError
          ? 'Kế hoạch voice–visual đã thay đổi. Hãy sinh lại scene trước khi chốt.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể chốt scene Motion Canvas lúc này.',
      );
      return null;
    } finally {
      setApproving(false);
    }
  }

  return {
    project,
    files,
    serveCommand,
    loadState,
    loadError,
    actionError,
    generating,
    approving,
    conflict,
    ready: project ? motionCanvasIsReady(project) : false,
    stale: project ? motionCanvasIsStale(project) : false,
    generate,
    approve,
    reload: () => setReloadKey((current) => current + 1),
  };
}

class MotionCanvasOperationCancelledError extends Error {}
class MotionCanvasInputNotReadyError extends Error {}
class MotionCanvasOutdatedError extends Error {}
