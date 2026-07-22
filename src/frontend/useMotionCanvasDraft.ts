import {useEffect, useRef, useState} from 'react';
import type {LayoutNodeOverride} from '../shared/layout.ts';
import type {TopicProject} from '../shared/topic.ts';
import type {
  MotionCanvasCandidateRecord,
  MotionCanvasEditScope,
  MotionCanvasHistoryResponse,
  MotionCanvasVersionRecord,
} from '../shared/motionCanvasHistory.ts';
import {
  motionCanvasIsReady,
  motionCanvasIsStale,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  applyMotionCanvasCandidate,
  approveMotionCanvas,
  commitVisualDesign,
  createMotionCanvasCandidate,
  createMotionCanvasCheckpoint,
  generateMotionCanvas,
  getMotionCanvasFiles,
  getMotionCanvasCandidateFiles,
  getMotionCanvasCandidatePreview,
  getMotionCanvasHistory,
  getMotionCanvasPreview,
  getProject,
  rejectMotionCanvasCandidate,
  restoreMotionCanvasVersion,
} from './api.ts';
import {recordCodexWaitSample} from './codexWaitEstimate.ts';
import {ProjectOperationQueue} from './projectOperationQueue.ts';

type LoadState = 'loading' | 'ready' | 'error';
type PreviewState = 'idle' | 'loading' | 'ready' | 'error';
type DesignSaveState = 'idle' | 'saving' | 'saved' | 'error';

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
  const [candidateGenerating, setCandidateGenerating] = useState(false);
  const [candidateApplying, setCandidateApplying] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [history, setHistory] = useState<MotionCanvasHistoryResponse | null>(
    null,
  );
  const [historyError, setHistoryError] = useState('');
  const [candidate, setCandidate] =
    useState<MotionCanvasCandidateRecord | null>(null);
  const [candidatePreviewState, setCandidatePreviewState] =
    useState<PreviewState>('idle');
  const [candidatePreviewUrl, setCandidatePreviewUrl] = useState('');
  const [candidatePreviewError, setCandidatePreviewError] = useState('');
  const [candidateFiles, setCandidateFiles] = useState<
    Array<{path: string; source: string}>
  >([]);
  const [approving, setApproving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewSessionNonce, setPreviewSessionNonce] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewRetryKey, setPreviewRetryKey] = useState(0);
  const [designSaveState, setDesignSaveState] =
    useState<DesignSaveState>('idle');
  const [reloadKey, setReloadKey] = useState(0);
  const projectRef = useRef<TopicProject | null>(null);
  const sessionRef = useRef(0);
  const operationQueueRef = useRef(new ProjectOperationQueue());
  const generationRequestRef = useRef<{
    fingerprint: string;
    generationId: string;
  } | null>(null);
  const candidateRequestRef = useRef<{
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
    candidateRequestRef.current = null;
    projectRef.current = null;
    setProject(null);
    setFiles([]);
    setServeCommand('');
    setLoadState('loading');
    setLoadError('');
    setActionError('');
    setConflict(false);
    setGenerating(false);
    setCandidateGenerating(false);
    setCandidateApplying(false);
    setHistoryBusy(false);
    setHistory(null);
    setHistoryError('');
    setCandidate(null);
    setCandidatePreviewState('idle');
    setCandidatePreviewUrl('');
    setCandidatePreviewError('');
    setCandidateFiles([]);
    setApproving(false);
    setPreviewState('idle');
    setPreviewUrl('');
    setPreviewSessionNonce('');
    setPreviewError('');
    setDesignSaveState('idle');

    void getProject(projectId)
      .then(async (loadedProject) => {
        if (!active || sessionRef.current !== session) return;
        projectRef.current = loadedProject;
        setProject(loadedProject);
        await loadFiles(loadedProject, session);
        if (
          loadedProject.motionCanvasBundle &&
          !motionCanvasIsStale(loadedProject)
        ) {
          try {
            const loadedHistory = await getMotionCanvasHistory(projectId);
            if (!active || sessionRef.current !== session) return;
            setHistory(loadedHistory);
            setCandidate(
              loadedHistory.candidates.find(
                item =>
                  item.decision === 'pending' &&
                  item.rootBaseContextHash ===
                    loadedHistory.currentContextHash &&
                  item.candidateContentHash !==
                    loadedHistory.currentContentHash,
              ) ?? null,
            );
          } catch (error) {
            if (!active || sessionRef.current !== session) return;
            setHistoryError(
              error instanceof ApiRequestError
                ? error.message
                : 'Không thể tải lịch sử Motion Canvas.',
            );
          }
        }
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

  const sourceGenerationId =
    project?.motionCanvasBundle?.generation.generationId ?? '';

  useEffect(() => {
    let active = true;
    if (loadState !== 'ready' || !sourceGenerationId) {
      setPreviewState('idle');
      setPreviewUrl('');
      setPreviewSessionNonce('');
      setPreviewError('');
      return () => {
        active = false;
      };
    }
    setPreviewState('loading');
    setPreviewUrl('');
    setPreviewSessionNonce('');
    setPreviewError('');
    void getMotionCanvasPreview(projectId, sourceGenerationId)
      .then((preview) => {
        if (
          !active ||
          preview.sourceMotionCanvasGenerationId !== sourceGenerationId
        ) return;
        setPreviewUrl(preview.url);
        setPreviewSessionNonce(preview.sessionNonce);
        setPreviewState('ready');
      })
      .catch((error) => {
        if (!active) return;
        setPreviewError(
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể khởi động visual editor cho scene.',
        );
        setPreviewState('error');
      });
    return () => {
      active = false;
    };
  }, [loadState, previewRetryKey, projectId, sourceGenerationId]);

  const candidateId = candidate?.candidateId ?? '';
  useEffect(() => {
    let active = true;
    if (!candidateId) {
      setCandidatePreviewState('idle');
      setCandidatePreviewUrl('');
      setCandidatePreviewError('');
      setCandidateFiles([]);
      return () => {
        active = false;
      };
    }
    setCandidatePreviewState('loading');
    setCandidatePreviewUrl('');
    setCandidatePreviewError('');
    void Promise.all([
      getMotionCanvasCandidatePreview(projectId, candidateId),
      getMotionCanvasCandidateFiles(projectId, candidateId),
    ])
      .then(([preview, workspace]) => {
        if (!active) return;
        setCandidatePreviewUrl(preview.url);
        setCandidateFiles(workspace.files);
        setCandidatePreviewState('ready');
      })
      .catch(error => {
        if (!active) return;
        setCandidatePreviewError(
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể mở preview candidate scene.',
        );
        setCandidatePreviewState('error');
      });
    return () => {
      active = false;
    };
  }, [candidateId, projectId]);

  async function generate(
    guidance: string,
    model?: string,
    reasoningEffort?: string,
  ) {
    if (generating || conflict) return null;
    const startedAt = Date.now();
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
          if (
            currentProject.motionCanvasBundle &&
            !motionCanvasIsStale(currentProject)
          ) {
            throw new MotionCanvasCandidateRequiredError();
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
            model,
            reasoningEffort,
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
            {
              generationId,
              model: model || undefined,
              reasoningEffort: reasoningEffort || undefined,
              guidance: normalizedGuidance,
            },
            currentProject.revision,
          );
        },
      );
      const session = sessionRef.current;
      projectRef.current = updatedProject;
      setProject(updatedProject);
      generationRequestRef.current = null;
      if (reasoningEffort) {
        recordCodexWaitSample({
          model:
            updatedProject.motionCanvasBundle?.generation.requestedModel ??
            model ??
            updatedProject.motionCanvasBundle?.generation.model ??
            'default',
          reasoningEffort,
          task: 'motionCanvas',
          workUnits: updatedProject.outline?.sections.length ?? 1,
          elapsedMs: Date.now() - startedAt,
        });
      }
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
          : error instanceof MotionCanvasCandidateRequiredError
            ? 'Workspace đã tồn tại. Hãy chọn scene và tạo candidate để so sánh.'
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

  async function createCandidate(
    guidance: string,
    scope: MotionCanvasEditScope,
    model?: string,
    reasoningEffort?: string,
  ) {
    if (candidateGenerating || conflict) return null;
    const startedAt = Date.now();
    setCandidateGenerating(true);
    setActionError('');
    setHistoryError('');
    try {
      const created = await operationQueueRef.current.enqueue(async () => {
        const currentProject = projectRef.current;
        if (!currentProject) throw new MotionCanvasOperationCancelledError();
        if (motionCanvasIsStale(currentProject)) {
          throw new MotionCanvasOutdatedError();
        }
        const normalizedGuidance = guidance.trim();
        if (!normalizedGuidance) throw new MotionCanvasGuidanceRequiredError();
        const baseCandidateId =
          candidate?.decision === 'pending'
            ? candidate.candidateId
            : undefined;
        const fingerprint = JSON.stringify({
          projectId,
          revision: currentProject.revision,
          baseCandidateId,
          guidance: normalizedGuidance,
          scope,
          model,
          reasoningEffort,
        });
        const previous = candidateRequestRef.current;
        const generationId =
          previous?.fingerprint === fingerprint
            ? previous.generationId
            : crypto.randomUUID();
        candidateRequestRef.current = {fingerprint, generationId};
        return createMotionCanvasCandidate(
          projectId,
          {
            generationId,
            baseCandidateId,
            guidance: normalizedGuidance,
            scope,
            model: model || undefined,
            reasoningEffort: reasoningEffort || undefined,
          },
          currentProject.revision,
        );
      });
      candidateRequestRef.current = null;
      setCandidate(created);
      setHistory(current =>
        current
          ? {
              ...current,
              candidates: [
                created,
                ...current.candidates.filter(
                  item => item.candidateId !== created.candidateId,
                ),
              ],
            }
          : current,
      );
      if (reasoningEffort) {
        recordCodexWaitSample({
          model: created.generation.requestedModel ?? model ?? created.generation.model,
          reasoningEffort,
          task: 'motionCanvas',
          workUnits: Math.max(1, scope.sceneIds.length),
          elapsedMs: Date.now() - startedAt,
        });
      }
      return created;
    } catch (error) {
      if (error instanceof MotionCanvasOperationCancelledError) return null;
      if (
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT'
      ) setConflict(true);
      setActionError(
        error instanceof MotionCanvasGuidanceRequiredError
          ? 'Hãy nhập góp ý cụ thể cho scene đã chọn.'
          : error instanceof MotionCanvasOutdatedError
            ? 'Voice–visual đã thay đổi. Hãy sinh lại toàn bộ scene trước.'
            : error instanceof ApiRequestError
              ? error.message
              : 'Không thể tạo candidate scene lúc này.',
      );
      return null;
    } finally {
      setCandidateGenerating(false);
    }
  }

  async function applyCandidate(candidateId = candidate?.candidateId) {
    if (!candidateId || candidateApplying || conflict) return null;
    setCandidateApplying(true);
    setActionError('');
    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = projectRef.current;
          if (!currentProject) throw new MotionCanvasOperationCancelledError();
          return applyMotionCanvasCandidate(
            projectId,
            candidateId,
            currentProject.revision,
          );
        },
      );
      const session = sessionRef.current;
      projectRef.current = updatedProject;
      setProject(updatedProject);
      setCandidate(null);
      await loadFiles(updatedProject, session);
      setHistory(await getMotionCanvasHistory(projectId));
      return updatedProject;
    } catch (error) {
      if (error instanceof MotionCanvasOperationCancelledError) return null;
      if (
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT'
      ) setConflict(true);
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể áp dụng candidate scene.',
      );
      return null;
    } finally {
      setCandidateApplying(false);
    }
  }

  async function rejectCandidate(candidateId = candidate?.candidateId) {
    const currentProject = projectRef.current;
    if (!candidateId || !currentProject || historyBusy) return null;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const rejected = await rejectMotionCanvasCandidate(
        projectId,
        candidateId,
        currentProject.revision,
      );
      setHistory(current =>
        current
          ? {
              ...current,
              candidates: current.candidates.map(item =>
                item.candidateId === rejected.candidateId ? rejected : item,
              ),
            }
          : current,
      );
      if (candidate?.candidateId === candidateId) setCandidate(null);
      return rejected;
    } catch (error) {
      setHistoryError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể từ chối candidate scene.',
      );
      return null;
    } finally {
      setHistoryBusy(false);
    }
  }

  async function createCheckpoint(label: string) {
    const currentProject = projectRef.current;
    if (!currentProject || historyBusy || conflict) return null;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const version = await operationQueueRef.current.enqueue(() =>
        createMotionCanvasCheckpoint(
          projectId,
          label,
          projectRef.current?.revision ?? currentProject.revision,
        ),
      );
      setHistory(current =>
        current
          ? {
              ...current,
              versions: [
                version,
                ...current.versions.filter(
                  item => item.versionId !== version.versionId,
                ),
              ],
            }
          : current,
      );
      return version;
    } catch (error) {
      setHistoryError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể lưu phiên bản scene.',
      );
      return null;
    } finally {
      setHistoryBusy(false);
    }
  }

  async function restoreVersion(version: MotionCanvasVersionRecord) {
    if (historyBusy || conflict) return null;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = projectRef.current;
          if (!currentProject) throw new MotionCanvasOperationCancelledError();
          return restoreMotionCanvasVersion(
            projectId,
            version.versionId,
            currentProject.revision,
          );
        },
      );
      const session = sessionRef.current;
      projectRef.current = updatedProject;
      setProject(updatedProject);
      setCandidate(null);
      await loadFiles(updatedProject, session);
      setHistory(await getMotionCanvasHistory(projectId));
      return updatedProject;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT'
      ) setConflict(true);
      setHistoryError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể khôi phục phiên bản scene.',
      );
      return null;
    } finally {
      setHistoryBusy(false);
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

  async function saveDesign(
    overrides: LayoutNodeOverride[],
    sessionNonce = previewSessionNonce,
  ) {
    if (!sessionNonce || conflict) return null;
    setDesignSaveState('saving');
    setActionError('');
    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = projectRef.current;
          const motion = currentProject?.motionCanvasBundle;
          if (!currentProject || !motion) {
            throw new MotionCanvasOperationCancelledError();
          }
          return commitVisualDesign(
            projectId,
            {
              sourceMotionCanvasGenerationId:
                motion.generation.generationId,
              sessionNonce,
              overrides,
            },
            currentProject.revision,
          );
        },
      );
      projectRef.current = updatedProject;
      setProject(updatedProject);
      setDesignSaveState('saved');
      return updatedProject;
    } catch (error) {
      if (error instanceof MotionCanvasOperationCancelledError) return null;
      const isConflict =
        error instanceof ApiRequestError && error.code === 'PROJECT_CONFLICT';
      if (isConflict) setConflict(true);
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể lưu chỉnh sửa visual scene.',
      );
      setDesignSaveState('error');
      return null;
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
    candidateGenerating,
    candidateApplying,
    historyBusy,
    history,
    historyError,
    candidate,
    candidatePreviewState,
    candidatePreviewUrl,
    candidatePreviewError,
    candidateFiles,
    approving,
    conflict,
    previewState,
    previewUrl,
    previewSessionNonce,
    previewError,
    designSaveState,
    ready: project ? motionCanvasIsReady(project) : false,
    stale: project ? motionCanvasIsStale(project) : false,
    generate,
    createCandidate,
    applyCandidate,
    rejectCandidate,
    createCheckpoint,
    restoreVersion,
    selectCandidate: setCandidate,
    dismissCandidate: () => setCandidate(null),
    approve,
    saveDesign,
    retryPreview: () => setPreviewRetryKey((current) => current + 1),
    reload: () => setReloadKey((current) => current + 1),
  };
}

class MotionCanvasOperationCancelledError extends Error {}
class MotionCanvasInputNotReadyError extends Error {}
class MotionCanvasOutdatedError extends Error {}
class MotionCanvasCandidateRequiredError extends Error {}
class MotionCanvasGuidanceRequiredError extends Error {}
