import {useCallback, useEffect, useRef, useState} from 'react';
import {
  TeachingOutlineContentSchema,
  type TeachingOutlineContent,
  type TeachingOutlineSection,
  type TopicProject,
} from '../shared/topic.ts';
import type {
  OutlineCandidateRecord,
  OutlineEditScope,
  OutlineHistoryResponse,
  OutlineVersionRecord,
} from '../shared/outlineHistory.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {
  outlineIsStale,
  sameValue,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  applyOutlineCandidate,
  approveTeachingOutline,
  createOutlineCandidate,
  createOutlineCheckpoint,
  generateTeachingOutline,
  getOutlineHistory,
  getProject,
  rejectOutlineCandidate,
  restoreOutlineVersion,
  updateTeachingOutline,
} from './api.ts';
import {recordCodexWaitSample} from './codexWaitEstimate.ts';
import {ProjectOperationQueue} from './projectOperationQueue.ts';
import {registerNavigationGuard} from './router.ts';

type LoadState = 'loading' | 'ready' | 'error';
export type OutlineSaveState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

function outlineValidationErrors(draft: TeachingOutlineContent | null) {
  if (!draft) return [];
  const parsed = TeachingOutlineContentSchema.safeParse(draft);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map(issue => {
    const [group, index, field] = issue.path;
    if (group === 'sections' && typeof index === 'number') {
      const labels: Record<string, string> = {
        title: 'Tên ý',
        goal: 'Mục tiêu',
        content: 'Nội dung',
        estimatedSeconds: 'Thời lượng',
      };
      return `Ý ${index + 1} · ${labels[String(field)] ?? 'Thông tin'}: ${issue.message}`;
    }
    if (group === 'brief') {
      return `Tóm tắt yêu cầu: ${issue.message}`;
    }
    if (group === 'centralMessage') {
      return `Thông điệp trung tâm: ${issue.message}`;
    }
    return issue.message;
  }))];
}

function getOutlineContent(project: TopicProject): TeachingOutlineContent | null {
  if (!project.outline) return null;
  return {
    brief: project.outline.brief,
    centralMessage: project.outline.centralMessage,
    sections: project.outline.sections,
  };
}

export function useOutlineDraft(projectId: string) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [draft, setDraftState] = useState<TeachingOutlineContent | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<OutlineSaveState>('idle');
  const [actionError, setActionError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [candidateGenerating, setCandidateGenerating] = useState(false);
  const [candidateApplying, setCandidateApplying] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [history, setHistory] = useState<OutlineHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [candidate, setCandidate] = useState<OutlineCandidateRecord | null>(
    null,
  );
  const [approving, setApproving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const projectRef = useRef<TopicProject | null>(null);
  const draftRef = useRef<TeachingOutlineContent | null>(null);
  const generationRequestRef = useRef<{
    fingerprint: string;
    generationId: string;
  } | null>(null);
  const candidateRequestRef = useRef<{
    fingerprint: string;
    generationId: string;
  } | null>(null);
  const sessionRef = useRef(0);
  const operationQueueRef = useRef(new ProjectOperationQueue());

  useEffect(() => {
    let active = true;
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    operationQueueRef.current = new ProjectOperationQueue();
    projectRef.current = null;
    draftRef.current = null;
    generationRequestRef.current = null;
    candidateRequestRef.current = null;
    setProject(null);
    setDraftState(null);
    setLoadState('loading');
    setLoadError('');
    setActionError('');
    setSaveState('idle');
    setGenerating(false);
    setCandidateGenerating(false);
    setCandidateApplying(false);
    setHistoryBusy(false);
    setHistory(null);
    setHistoryError('');
    setCandidate(null);
    setApproving(false);

    void getProject(projectId)
      .then((loadedProject) => {
        if (!active || sessionRef.current !== session) return;
        const content = getOutlineContent(loadedProject);
        projectRef.current = loadedProject;
        draftRef.current = content;
        setProject(loadedProject);
        setDraftState(content);
        setLoadState('ready');
        setSaveState(content ? 'saved' : 'idle');
        if (loadedProject.outline) {
          void getOutlineHistory(projectId)
            .then(loadedHistory => {
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
            })
            .catch(error => {
              if (!active || sessionRef.current !== session) return;
              setHistoryError(
                error instanceof ApiRequestError
                  ? error.message
                  : 'Không thể tải lịch sử phiên bản.',
              );
            });
        }
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể mở project.',
        );
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [projectId, reloadKey]);

  const saveCurrentDraft = useCallback(async () => {
    const session = sessionRef.current;
    const currentProject = projectRef.current;
    const currentDraft = draftRef.current;
    if (!currentProject || !currentDraft) {
      throw new OutlineOperationCancelledError();
    }

    const parsedDraft = TeachingOutlineContentSchema.safeParse(currentDraft);
    if (!parsedDraft.success) {
      throw new OutlineDraftInvalidError();
    }
    const adoptNormalizedDraft = () => {
      if (!sameValue(draftRef.current, currentDraft)) return;
      draftRef.current = parsedDraft.data;
      setDraftState(latest =>
        sameValue(latest, currentDraft) ? parsedDraft.data : latest,
      );
    };
    if (
      currentProject.outline &&
      sameValue(getOutlineContent(currentProject), parsedDraft.data)
    ) {
      adoptNormalizedDraft();
      return currentProject;
    }

    const updatedProject = await updateTeachingOutline(
      projectId,
      parsedDraft.data,
      currentProject.revision,
    );
    if (sessionRef.current !== session) {
      throw new OutlineOperationCancelledError();
    }

    projectRef.current = updatedProject;
    setProject(updatedProject);
    adoptNormalizedDraft();
    return updatedProject;
  }, [projectId]);

  useEffect(() => {
    if (
      loadState !== 'ready' ||
      !project?.outline ||
      !draft ||
      generating ||
      candidateGenerating ||
      candidateApplying ||
      historyBusy ||
      approving ||
      saveState === 'conflict'
    ) {
      return;
    }

    const parsedDraft = TeachingOutlineContentSchema.safeParse(draft);
    if (!parsedDraft.success) {
      setSaveState('idle');
      return;
    }
    if (sameValue(getOutlineContent(project), parsedDraft.data)) {
      setSaveState('saved');
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      setSaveState('saving');
      void operationQueueRef.current
        .enqueue(saveCurrentDraft)
        .then(() => {
          if (active) {
            setSaveState('saved');
            void refreshHistory();
          }
        })
        .catch((error) => {
          if (!active || error instanceof OutlineOperationCancelledError) return;
          setSaveState(
            error instanceof ApiRequestError &&
              error.code === 'PROJECT_CONFLICT'
              ? 'conflict'
              : error instanceof OutlineDraftInvalidError
                ? 'idle'
                : 'error',
          );
        });
    }, 700);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    approving,
    candidateApplying,
    candidateGenerating,
    draft,
    generating,
    historyBusy,
    loadState,
    project,
    saveCurrentDraft,
    saveState,
  ]);

  function setDraft(
    updater: (current: TeachingOutlineContent) => TeachingOutlineContent,
  ) {
    setDraftState((current) => {
      if (!current) return current;
      const next = updater(current);
      draftRef.current = next;
      return next;
    });
    setCandidate(null);
    setActionError('');
    if (saveState !== 'conflict') setSaveState('idle');
  }

  function updateBriefSummary(value: string) {
    setDraft((current) => ({
      ...current,
      brief: {...current.brief, summary: value},
    }));
  }

  function updateAssumption(index: number, value: string) {
    setDraft((current) => ({
      ...current,
      brief: {
        ...current.brief,
        assumptions: current.brief.assumptions.map((assumption, itemIndex) =>
          itemIndex === index ? value : assumption,
        ),
      },
    }));
  }

  function addAssumption() {
    setDraft((current) => {
      if (current.brief.assumptions.length >= 6) return current;
      return {
        ...current,
        brief: {
          ...current.brief,
          assumptions: [...current.brief.assumptions, 'Giả định mới'],
        },
      };
    });
  }

  function removeAssumption(index: number) {
    setDraft((current) => ({
      ...current,
      brief: {
        ...current.brief,
        assumptions: current.brief.assumptions.filter(
          (_assumption, itemIndex) => itemIndex !== index,
        ),
      },
    }));
  }

  function updateCentralMessage(value: string) {
    setDraft((current) => ({...current, centralMessage: value}));
  }

  function updateSection<Key extends keyof TeachingOutlineSection>(
    sectionId: string,
    field: Key,
    value: TeachingOutlineSection[Key],
  ) {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? {...section, [field]: value} : section,
      ),
    }));
  }

  function addSection() {
    setDraft((current) => {
      if (
        current.sections.length >= pipelineSafetyLimits.maximumSections
      ) return current;
      return {
        ...current,
        sections: [
          ...current.sections,
          {
            id: crypto.randomUUID(),
            title: 'Ý mới',
            goal: 'Người xem hiểu được ý chính của phần này.',
            content: 'Mô tả nội dung cần giải thích trong phần này.',
            estimatedSeconds: 30,
          },
        ],
      };
    });
  }

  function removeSection(sectionId: string) {
    setDraft((current) => {
      if (
        current.sections.length <= pipelineSafetyLimits.minimumSections
      ) return current;
      return {
        ...current,
        sections: current.sections.filter(
          (section) => section.id !== sectionId,
        ),
      };
    });
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    setDraft((current) => {
      const index = current.sections.findIndex(
        (section) => section.id === sectionId,
      );
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.sections.length) {
        return current;
      }

      const sections = [...current.sections];
      const [section] = sections.splice(index, 1);
      if (!section) return current;
      sections.splice(targetIndex, 0, section);
      return {...current, sections};
    });
  }

  async function generate(
    guidance: string,
    model?: string,
    reasoningEffort?: string,
  ) {
    if (generating || saveState === 'conflict') return null;
    const startedAt = Date.now();
    setGenerating(true);
    setActionError('');

    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          let currentProject = projectRef.current;
          if (!currentProject) throw new OutlineOperationCancelledError();

          if (draftRef.current && !outlineIsStale(currentProject)) {
            currentProject = await saveCurrentDraft();
          }

          const normalizedGuidance = guidance.trim() || undefined;
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

          return generateTeachingOutline(
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
      const content = getOutlineContent(updatedProject);
      projectRef.current = updatedProject;
      draftRef.current = content;
      setProject(updatedProject);
      setDraftState(content);
      setSaveState('saved');
      setCandidate(null);
      generationRequestRef.current = null;
      await refreshHistory();
      if (reasoningEffort) {
        recordCodexWaitSample({
          model:
            updatedProject.outline?.generation.requestedModel ??
            model ??
            updatedProject.outline?.generation.model ??
            'default',
          reasoningEffort,
          task: 'outline',
          elapsedMs: Date.now() - startedAt,
        });
      }
      return updatedProject;
    } catch (error) {
      if (error instanceof OutlineOperationCancelledError) return null;
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) setSaveState('conflict');
      setActionError(
        error instanceof OutlineDraftInvalidError
          ? 'Hãy hoàn thiện các ý đang chỉnh trước khi yêu cầu AI làm lại.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể tạo mạch giảng lúc này.',
      );
      return null;
    } finally {
      setGenerating(false);
    }
  }

  async function refreshHistory() {
    try {
      const loadedHistory = await getOutlineHistory(projectId);
      setHistory(loadedHistory);
      setHistoryError('');
      return loadedHistory;
    } catch (error) {
      setHistoryError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể tải lịch sử phiên bản.',
      );
      return null;
    }
  }

  async function projectForContentReplacement() {
    const currentProject = projectRef.current;
    const currentDraft = draftRef.current;
    if (!currentProject || !currentDraft) {
      throw new OutlineOperationCancelledError();
    }
    if (TeachingOutlineContentSchema.safeParse(currentDraft).success) {
      return saveCurrentDraft();
    }
    return currentProject;
  }

  async function createEditCandidate(
    guidance: string,
    scope: OutlineEditScope,
    model?: string,
    reasoningEffort?: string,
    baseCandidateId?: string,
  ) {
    if (
      candidateGenerating ||
      generating ||
      saveState === 'conflict'
    ) {
      return null;
    }
    const startedAt = Date.now();
    setCandidateGenerating(true);
    setActionError('');

    try {
      const nextCandidate = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = await saveCurrentDraft();
          const normalizedGuidance = guidance.trim();
          const fingerprint = JSON.stringify({
            projectId,
            revision: currentProject.revision,
            baseCandidateId,
            model,
            reasoningEffort,
            guidance: normalizedGuidance,
            scope,
          });
          const previousRequest = candidateRequestRef.current;
          const generationId =
            previousRequest?.fingerprint === fingerprint
              ? previousRequest.generationId
              : crypto.randomUUID();
          candidateRequestRef.current = {fingerprint, generationId};
          return createOutlineCandidate(
            projectId,
            {
              generationId,
              ...(baseCandidateId ? {baseCandidateId} : {}),
              ...(model ? {model} : {}),
              ...(reasoningEffort ? {reasoningEffort} : {}),
              guidance: normalizedGuidance,
              scope,
            },
            currentProject.revision,
          );
        },
      );
      setCandidate(nextCandidate);
      candidateRequestRef.current = null;
      setHistory(current =>
        current
          ? {
              ...current,
              candidates: [
                nextCandidate,
                ...current.candidates.filter(
                  item => item.candidateId !== nextCandidate.candidateId,
                ),
              ],
            }
          : current,
      );
      if (reasoningEffort) {
        recordCodexWaitSample({
          model: nextCandidate.generation.model || model || 'default',
          reasoningEffort,
          task: 'outline',
          elapsedMs: Date.now() - startedAt,
        });
      }
      await refreshHistory();
      return nextCandidate;
    } catch (error) {
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) setSaveState('conflict');
      setActionError(
        error instanceof OutlineDraftInvalidError
          ? 'Hãy hoàn thiện mạch giảng đang sửa trước khi tạo đề xuất.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể tạo đề xuất chỉnh sửa lúc này.',
      );
      return null;
    } finally {
      setCandidateGenerating(false);
    }
  }

  async function applyCandidate(candidateToApply = candidate) {
    if (
      !candidateToApply ||
      candidateApplying ||
      saveState === 'conflict'
    ) {
      return null;
    }
    setCandidateApplying(true);
    setActionError('');
    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = await projectForContentReplacement();
          return applyOutlineCandidate(
            projectId,
            candidateToApply.candidateId,
            currentProject.revision,
          );
        },
      );
      const content = getOutlineContent(updatedProject);
      projectRef.current = updatedProject;
      draftRef.current = content;
      setProject(updatedProject);
      setDraftState(content);
      setSaveState('saved');
      setCandidate(null);
      await refreshHistory();
      return updatedProject;
    } catch (error) {
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) setSaveState('conflict');
      setActionError(
        error instanceof OutlineDraftInvalidError
          ? 'Hãy hoàn thiện mạch giảng đang sửa trước khi áp dụng đề xuất.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể áp dụng đề xuất lúc này.',
      );
      return null;
    } finally {
      setCandidateApplying(false);
    }
  }

  async function saveCheckpoint(label?: string) {
    if (historyBusy || saveState === 'conflict') return null;
    setHistoryBusy(true);
    setActionError('');
    try {
      const version = await operationQueueRef.current.enqueue(async () => {
        const currentProject = await saveCurrentDraft();
        return createOutlineCheckpoint(
          projectId,
          currentProject.revision,
          label,
        );
      });
      await refreshHistory();
      return version;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT'
      ) {
        setSaveState('conflict');
      }
      setActionError(
        error instanceof OutlineDraftInvalidError
          ? 'Hãy hoàn thiện mạch giảng trước khi lưu phiên bản.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể lưu phiên bản lúc này.',
      );
      return null;
    } finally {
      setHistoryBusy(false);
    }
  }

  async function rejectCandidate(candidateToReject = candidate) {
    if (!candidateToReject || historyBusy || saveState === 'conflict') {
      return null;
    }
    setHistoryBusy(true);
    setActionError('');
    try {
      const rejected = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = projectRef.current;
          if (!currentProject) throw new OutlineOperationCancelledError();
          return rejectOutlineCandidate(
            projectId,
            candidateToReject.candidateId,
            currentProject.revision,
          );
        },
      );
      setCandidate(null);
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
      return rejected;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT'
      ) {
        setSaveState('conflict');
      }
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể cập nhật trạng thái candidate lúc này.',
      );
      return null;
    } finally {
      setHistoryBusy(false);
    }
  }

  async function restoreVersion(version: OutlineVersionRecord) {
    if (historyBusy || saveState === 'conflict') return null;
    setHistoryBusy(true);
    setActionError('');
    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = await projectForContentReplacement();
          return restoreOutlineVersion(
            projectId,
            version.versionId,
            currentProject.revision,
          );
        },
      );
      const content = getOutlineContent(updatedProject);
      projectRef.current = updatedProject;
      draftRef.current = content;
      setProject(updatedProject);
      setDraftState(content);
      setSaveState('saved');
      setCandidate(null);
      await refreshHistory();
      return updatedProject;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT'
      ) {
        setSaveState('conflict');
      }
      setActionError(
        error instanceof OutlineDraftInvalidError
          ? 'Hãy hoàn thiện mạch giảng trước khi chuyển phiên bản.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể khôi phục phiên bản lúc này.',
      );
      return null;
    } finally {
      setHistoryBusy(false);
    }
  }

  async function approve() {
    if (approving || saveState === 'conflict') return null;
    setApproving(true);
    setActionError('');

    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const savedProject = await saveCurrentDraft();
          return approveTeachingOutline(projectId, savedProject.revision);
        },
      );
      projectRef.current = updatedProject;
      setProject(updatedProject);
      setSaveState('saved');
      return updatedProject;
    } catch (error) {
      if (error instanceof OutlineOperationCancelledError) return null;
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) setSaveState('conflict');
      setActionError(
        error instanceof OutlineDraftInvalidError
          ? 'Hãy hoàn thiện mạch giảng trước khi chốt.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể chốt mạch giảng lúc này.',
      );
      return null;
    } finally {
      setApproving(false);
    }
  }

  const stale = project ? outlineIsStale(project) : false;
  const validationErrors = outlineValidationErrors(draft);
  const valid = Boolean(draft && validationErrors.length === 0);
  const hasUnsavedChanges = Boolean(
    loadState === 'ready' &&
      project?.outline &&
      draft &&
      !stale &&
      !sameValue(getOutlineContent(project), draft),
  );

  const flushPendingSave = useCallback(async () => {
    const currentProject = projectRef.current;
    const currentDraft = draftRef.current;
    if (!currentProject?.outline || !currentDraft) return true;
    if (outlineIsStale(currentProject)) return true;
    if (sameValue(getOutlineContent(currentProject), currentDraft)) return true;
    if (!TeachingOutlineContentSchema.safeParse(currentDraft).success) {
      return window.confirm(
        'Mạch giảng đang có nội dung chưa hợp lệ và chưa thể lưu. Rời trang sẽ bỏ các thay đổi này. Bạn có muốn tiếp tục?',
      );
    }
    try {
      setSaveState('saving');
      await operationQueueRef.current.enqueue(saveCurrentDraft);
      setSaveState('saved');
      return true;
    } catch (error) {
      if (error instanceof OutlineOperationCancelledError) return false;
      setSaveState(
        error instanceof ApiRequestError && error.code === 'PROJECT_CONFLICT'
          ? 'conflict'
          : 'error',
      );
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể lưu mạch giảng trước khi rời trang.',
      );
      return false;
    }
  }, [saveCurrentDraft]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    return registerNavigationGuard(flushPendingSave);
  }, [flushPendingSave, hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const preventUnsavedUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventUnsavedUnload);
    return () => window.removeEventListener('beforeunload', preventUnsavedUnload);
  }, [hasUnsavedChanges]);

  return {
    project,
    draft,
    loadState,
    loadError,
    saveState,
    actionError,
    generating,
    candidateGenerating,
    candidateApplying,
    historyBusy,
    history,
    historyError,
    candidate,
    approving,
    stale,
    valid,
    validationErrors,
    updateBriefSummary,
    updateAssumption,
    addAssumption,
    removeAssumption,
    updateCentralMessage,
    updateSection,
    addSection,
    removeSection,
    moveSection,
    generate,
    createEditCandidate,
    applyCandidate,
    saveCheckpoint,
    restoreVersion,
    rejectCandidate,
    refreshHistory,
    selectCandidate: setCandidate,
    dismissCandidate: () => setCandidate(null),
    approve,
    reload: () => setReloadKey((current) => current + 1),
  };
}

class OutlineOperationCancelledError extends Error {}
class OutlineDraftInvalidError extends Error {}
