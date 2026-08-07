import {useCallback, useEffect, useRef, useState} from 'react';
import {
  VoiceVisualPlanContentSchema,
  type TopicProject,
  type VoiceVisualBeat,
  type VoiceVisualPlanContent,
} from '../shared/topic.ts';
import type {
  VoiceVisualCandidateRecord,
  VoiceVisualEditScope,
  VoiceVisualHistoryResponse,
  VoiceVisualReviewRecord,
  VoiceVisualVersionRecord,
} from '../shared/voiceVisualHistory.ts';
import {plannedBeatDurationSeconds} from '../shared/narrationTiming.ts';
import {speechTextForBeat} from '../shared/vietnameseSpeech.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {
  outlineIsReady,
  sameValue,
  voiceVisualIsStale,
  voiceVisualMatchesOutline,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  applyVoiceVisualCandidate,
  approveVoiceVisualPlan,
  createVoiceVisualCandidate,
  createVoiceVisualCheckpoint,
  generateVoiceVisualPlan,
  getVoiceVisualHistory,
  getProject,
  rejectVoiceVisualCandidate,
  reviewVoiceVisualPlan,
  restoreVoiceVisualVersion,
  updateVoiceVisualPlan,
} from './api.ts';
import {recordCodexWaitSample} from './codexWaitEstimate.ts';
import {ProjectOperationQueue} from './projectOperationQueue.ts';
import {registerNavigationGuard} from './router.ts';
import {voiceVisualCandidateIsCurrent} from './voiceVisualWorkflowState.ts';

type LoadState = 'loading' | 'ready' | 'error';
export type VoiceVisualSaveState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

function voiceVisualValidationErrors(
  draft: VoiceVisualPlanContent | null,
) {
  if (!draft) return [];
  const parsed = VoiceVisualPlanContentSchema.safeParse(draft);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map(issue => {
    const [group, sectionIndex, beats, beatIndex, field] = issue.path;
    if (
      group === 'sections' &&
      typeof sectionIndex === 'number' &&
      beats === 'beats' &&
      typeof beatIndex === 'number'
    ) {
      const labels: Record<string, string> = {
        voiceover: 'Lời thuyết minh',
        visualDescription: 'Mô tả visual',
        animationDescription: 'Chuyển động',
        visualHoldSeconds: 'Giữ hình',
        durationSeconds: 'Thời lượng',
      };
      return `Ý ${sectionIndex + 1} · Beat ${beatIndex + 1} · ${labels[String(field)] ?? 'Thông tin'}: ${issue.message}`;
    }
    if (group === 'voiceDirection') {
      return `Giọng kể: ${issue.message}`;
    }
    if (group === 'visualDirection') {
      return `Ngôn ngữ hình ảnh: ${issue.message}`;
    }
    return issue.message;
  }))];
}

function getPlanContent(
  project: TopicProject,
): VoiceVisualPlanContent | null {
  if (!project.voiceVisualPlan) return null;
  return {
    voiceDirection: project.voiceVisualPlan.voiceDirection,
    visualDirection: project.voiceVisualPlan.visualDirection,
    timingCalibration: project.voiceVisualPlan.timingCalibration,
    sections: project.voiceVisualPlan.sections,
  };
}

export function useVoiceVisualDraft(projectId: string) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [draft, setDraftState] = useState<VoiceVisualPlanContent | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] =
    useState<VoiceVisualSaveState>('idle');
  const [actionError, setActionError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [candidateGenerating, setCandidateGenerating] = useState(false);
  const [candidateApplying, setCandidateApplying] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [standaloneReview, setStandaloneReview] =
    useState<VoiceVisualReviewRecord | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [history, setHistory] = useState<VoiceVisualHistoryResponse | null>(
    null,
  );
  const [historyError, setHistoryError] = useState('');
  const [candidate, setCandidate] =
    useState<VoiceVisualCandidateRecord | null>(null);
  const [approving, setApproving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const projectRef = useRef<TopicProject | null>(null);
  const draftRef = useRef<VoiceVisualPlanContent | null>(null);
  const generationRequestRef = useRef<{
    fingerprint: string;
    generationId: string;
  } | null>(null);
  const candidateRequestRef = useRef<{
    fingerprint: string;
    generationId: string;
  } | null>(null);
  const reviewRequestRef = useRef<{
    fingerprint: string;
    reviewId: string;
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
    reviewRequestRef.current = null;
    setProject(null);
    setDraftState(null);
    setLoadState('loading');
    setLoadError('');
    setActionError('');
    setSaveState('idle');
    setGenerating(false);
    setCandidateGenerating(false);
    setCandidateApplying(false);
    setReviewing(false);
    setStandaloneReview(null);
    setHistoryBusy(false);
    setHistory(null);
    setHistoryError('');
    setCandidate(null);
    setApproving(false);

    void getProject(projectId)
      .then((loadedProject) => {
        if (!active || sessionRef.current !== session) return;
        const content = getPlanContent(loadedProject);
        projectRef.current = loadedProject;
        draftRef.current = content;
        setProject(loadedProject);
        setDraftState(content);
        setLoadState('ready');
        setSaveState(content ? 'saved' : 'idle');
        if (content && !voiceVisualIsStale(loadedProject)) {
          void getVoiceVisualHistory(projectId)
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
                  : 'Không thể tải lịch sử voice–visual.',
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

  const refreshHistory = useCallback(async () => {
    const currentProject = projectRef.current;
    if (!currentProject?.voiceVisualPlan || voiceVisualIsStale(currentProject)) {
      setHistory(null);
      return null;
    }
    try {
      const loadedHistory = await getVoiceVisualHistory(projectId);
      setHistory(loadedHistory);
      setHistoryError('');
      return loadedHistory;
    } catch (error) {
      setHistoryError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể tải lịch sử voice–visual.',
      );
      return null;
    }
  }, [projectId]);

  const saveCurrentDraft = useCallback(async () => {
    const session = sessionRef.current;
    const currentProject = projectRef.current;
    const currentDraft = draftRef.current;
    if (!currentProject || !currentDraft) {
      throw new VoiceVisualOperationCancelledError();
    }
    if (voiceVisualIsStale(currentProject)) {
      throw new VoiceVisualOutdatedError();
    }

    const parsedDraft = VoiceVisualPlanContentSchema.safeParse(currentDraft);
    if (
      !parsedDraft.success ||
      !currentProject.outline ||
      !voiceVisualMatchesOutline(parsedDraft.data, currentProject.outline)
    ) {
      throw new VoiceVisualDraftInvalidError();
    }
    const adoptNormalizedDraft = (normalized: VoiceVisualPlanContent) => {
      if (!sameValue(draftRef.current, currentDraft)) return;
      draftRef.current = normalized;
      setDraftState(latest =>
        sameValue(latest, currentDraft) ? normalized : latest,
      );
    };
    if (
      currentProject.voiceVisualPlan &&
      sameValue(getPlanContent(currentProject), parsedDraft.data)
    ) {
      adoptNormalizedDraft(parsedDraft.data);
      return currentProject;
    }

    const updatedProject = await updateVoiceVisualPlan(
      projectId,
      parsedDraft.data,
      currentProject.revision,
    );
    if (sessionRef.current !== session) {
      throw new VoiceVisualOperationCancelledError();
    }

    projectRef.current = updatedProject;
    setProject(updatedProject);
    const savedContent = getPlanContent(updatedProject);
    if (savedContent) adoptNormalizedDraft(savedContent);
    return updatedProject;
  }, [projectId]);

  const projectForContentReplacement = useCallback(async () => {
    const currentProject = projectRef.current;
    const currentDraft = draftRef.current;
    if (!currentProject || !currentDraft) {
      throw new VoiceVisualOperationCancelledError();
    }
    const parsedDraft = VoiceVisualPlanContentSchema.safeParse(currentDraft);
    if (
      parsedDraft.success &&
      currentProject.outline &&
      voiceVisualMatchesOutline(parsedDraft.data, currentProject.outline)
    ) {
      return saveCurrentDraft();
    }
    return currentProject;
  }, [saveCurrentDraft]);

  useEffect(() => {
    if (
      loadState !== 'ready' ||
      !project?.voiceVisualPlan ||
      !draft ||
      generating ||
      candidateGenerating ||
      candidateApplying ||
      reviewing ||
      historyBusy ||
      approving ||
      saveState === 'conflict' ||
      voiceVisualIsStale(project)
    ) {
      return;
    }

    const parsedDraft = VoiceVisualPlanContentSchema.safeParse(draft);
    if (
      !parsedDraft.success ||
      !project.outline ||
      !voiceVisualMatchesOutline(parsedDraft.data, project.outline)
    ) {
      setSaveState('idle');
      return;
    }
    if (sameValue(getPlanContent(project), parsedDraft.data)) {
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
          if (
            !active ||
            error instanceof VoiceVisualOperationCancelledError
          ) {
            return;
          }
          setSaveState(
            error instanceof ApiRequestError &&
              error.code === 'PROJECT_CONFLICT'
              ? 'conflict'
              : error instanceof VoiceVisualDraftInvalidError
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
    reviewing,
    refreshHistory,
    saveCurrentDraft,
    saveState,
  ]);

  function setDraft(
    updater: (current: VoiceVisualPlanContent) => VoiceVisualPlanContent,
  ) {
    setDraftState((current) => {
      if (!current) return current;
      const next = updater(current);
      draftRef.current = next;
      return next;
    });
    setStandaloneReview(null);
    setCandidate(null);
    setActionError('');
    if (saveState !== 'conflict') setSaveState('idle');
  }

  function updateDirection(
    field: 'voiceDirection' | 'visualDirection',
    value: string,
  ) {
    setDraft((current) => ({...current, [field]: value}));
  }

  function updateBeat<Key extends keyof VoiceVisualBeat>(
    outlineSectionId: string,
    beatId: string,
    field: Key,
    value: VoiceVisualBeat[Key],
  ) {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.outlineSectionId === outlineSectionId
          ? {
              ...section,
              beats: section.beats.map((beat) =>
                beat.id === beatId
                  ? (() => {
                      const updated = {
                        ...beat,
                        [field]: value,
                        ...(field === 'voiceover'
                          ? {spokenVoiceover: undefined}
                          : {}),
                      };
                      if (
                        field !== 'voiceover' &&
                        field !== 'spokenVoiceover' &&
                        field !== 'visualHoldSeconds'
                      ) {
                        return updated;
                      }
                      return {
                        ...updated,
                        durationSeconds: plannedBeatDurationSeconds(
                          speechTextForBeat(updated),
                          Number(updated.visualHoldSeconds),
                          current.timingCalibration,
                        ),
                      };
                    })()
                  : beat,
              ),
            }
          : section,
      ),
    }));
  }

  function addBeat(outlineSectionId: string) {
    setDraft((current) => {
      const totalBeats = current.sections.reduce(
        (total, section) => total + section.beats.length,
        0,
      );
      if (totalBeats >= pipelineSafetyLimits.maximumTotalBeats) {
        return current;
      }

      return {
        ...current,
        sections: current.sections.map((section) =>
          section.outlineSectionId === outlineSectionId &&
          section.beats.length < pipelineSafetyLimits.maximumBeatsPerSection
            ? {
              ...section,
              beats: [
                ...section.beats,
                {
                  id: crypto.randomUUID(),
                  voiceover:
                    'Viết lời thuyết minh cho ý tiếp theo của phần này.',
                  visualDescription:
                    'Mô tả hình ảnh giúp người xem hiểu đúng ý đang được kể.',
                  animationDescription:
                    'Chuyển đổi trạng thái hình ảnh để làm rõ mối liên hệ.',
                  visualHoldSeconds: 0,
                  durationSeconds: plannedBeatDurationSeconds(
                    'Viết lời thuyết minh cho ý tiếp theo của phần này.',
                    0,
                    current.timingCalibration,
                  ),
                },
              ],
            }
            : section,
        ),
      };
    });
  }

  function removeBeat(outlineSectionId: string, beatId: string) {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.outlineSectionId === outlineSectionId &&
        section.beats.length > 1
          ? {
              ...section,
              beats: section.beats.filter((beat) => beat.id !== beatId),
            }
          : section,
      ),
    }));
  }

  function moveBeat(
    outlineSectionId: string,
    beatId: string,
    direction: -1 | 1,
  ) {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.outlineSectionId !== outlineSectionId) return section;
        const index = section.beats.findIndex((beat) => beat.id === beatId);
        const targetIndex = index + direction;
        if (
          index < 0 ||
          targetIndex < 0 ||
          targetIndex >= section.beats.length
        ) {
          return section;
        }

        const beats = [...section.beats];
        const [beat] = beats.splice(index, 1);
        if (!beat) return section;
        beats.splice(targetIndex, 0, beat);
        return {...section, beats};
      }),
    }));
  }

  function candidateIsActionable(
    targetCandidate: VoiceVisualCandidateRecord | null,
  ) {
    const currentProject = projectRef.current;
    const currentDraft = draftRef.current;
    return Boolean(
      voiceVisualCandidateIsCurrent(targetCandidate, history) &&
        currentProject?.voiceVisualPlan &&
        currentDraft &&
        sameValue(getPlanContent(currentProject), currentDraft),
    );
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
          if (!currentProject) {
            throw new VoiceVisualOperationCancelledError();
          }
          if (!outlineIsReady(currentProject)) {
            throw new VoiceVisualOutlineNotReadyError();
          }

          if (
            currentProject.voiceVisualPlan &&
            !voiceVisualIsStale(currentProject)
          ) {
            throw new VoiceVisualCandidateRequiredError();
          }

          const normalizedGuidance = guidance.trim() || undefined;
          if (
            normalizedGuidance &&
            voiceVisualIsStale(currentProject)
          ) {
            throw new VoiceVisualOutdatedError();
          }
          if (normalizedGuidance && draftRef.current) {
            currentProject = await saveCurrentDraft();
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

          return generateVoiceVisualPlan(
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
      const content = getPlanContent(updatedProject);
      projectRef.current = updatedProject;
      draftRef.current = content;
      setProject(updatedProject);
      setDraftState(content);
      setCandidate(null);
      setStandaloneReview(null);
      setSaveState('saved');
      generationRequestRef.current = null;
      await refreshHistory();
      if (reasoningEffort) {
        recordCodexWaitSample({
          model:
            updatedProject.voiceVisualPlan?.generation.requestedModel ??
            model ??
            updatedProject.voiceVisualPlan?.generation.model ??
            'default',
          reasoningEffort,
          task: 'voiceVisual',
          workUnits: updatedProject.outline?.sections.length ?? 1,
          elapsedMs: Date.now() - startedAt,
        });
      }
      return updatedProject;
    } catch (error) {
      if (error instanceof VoiceVisualOperationCancelledError) return null;
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) setSaveState('conflict');
      setActionError(
        error instanceof VoiceVisualOutlineNotReadyError
          ? 'Hãy chốt mạch giảng trước khi tạo kế hoạch voice–visual.'
          : error instanceof VoiceVisualCandidateRequiredError
            ? 'Kế hoạch đã tồn tại. Hãy chọn phạm vi và tạo bản đề xuất để so sánh.'
          : error instanceof VoiceVisualOutdatedError
            ? 'Mạch giảng đã thay đổi. Hãy tạo lại toàn bộ kế hoạch trước.'
            : error instanceof VoiceVisualDraftInvalidError
              ? 'Hãy hoàn thiện các beat đang chỉnh trước khi nhờ AI sửa.'
              : error instanceof ApiRequestError
                ? error.message
                : 'Không thể tạo kế hoạch voice–visual lúc này.',
      );
      return null;
    } finally {
      setGenerating(false);
    }
  }

  async function createCandidate(
    guidance: string,
    scope: VoiceVisualEditScope,
    model?: string,
    reasoningEffort?: string,
    baseMode: 'auto' | 'current' | 'candidate' = 'auto',
  ) {
    if (candidateGenerating || saveState === 'conflict') return null;
    const startedAt = Date.now();
    setCandidateGenerating(true);
    setActionError('');
    setHistoryError('');
    try {
      const candidateCanBeBase = candidateIsActionable(candidate);
      const created = await operationQueueRef.current.enqueue(async () => {
        const currentProject = await saveCurrentDraft();
        const normalizedGuidance = guidance.trim();
        if (!normalizedGuidance) throw new VoiceVisualGuidanceRequiredError();
        const baseCandidateId =
          baseMode !== 'current' &&
          candidateCanBeBase
            ? candidate?.candidateId
            : undefined;
        if (baseMode === 'candidate' && !baseCandidateId) {
          throw new VoiceVisualCandidateBaseRequiredError();
        }
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
        return createVoiceVisualCandidate(
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
      setStandaloneReview(null);
      await refreshHistory();
      if (reasoningEffort) {
        recordCodexWaitSample({
          model: created.generation.requestedModel ?? model ?? created.generation.model,
          reasoningEffort,
          task: 'voiceVisual',
          workUnits: Math.max(1, scope.beats.length),
          elapsedMs: Date.now() - startedAt,
        });
      }
      return created;
    } catch (error) {
      if (error instanceof VoiceVisualOperationCancelledError) return null;
      if (
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT'
      ) {
        setSaveState('conflict');
      }
      setActionError(
        error instanceof VoiceVisualGuidanceRequiredError
          ? 'Hãy nhập góp ý cụ thể cho phần đã chọn.'
          : error instanceof VoiceVisualCandidateBaseRequiredError
            ? 'Candidate dùng làm nền không còn khả dụng. Hãy chọn lại candidate hoặc dùng bản hiện tại.'
          : error instanceof VoiceVisualDraftInvalidError
            ? 'Hãy hoàn thiện các beat đang chỉnh trước khi nhờ AI sửa.'
            : error instanceof ApiRequestError
              ? error.message
              : 'Không thể tạo bản đề xuất voice–visual lúc này.',
      );
      return null;
    } finally {
      setCandidateGenerating(false);
    }
  }

  async function reviewPlan(
    target: 'current' | 'candidate',
    model?: string,
    reasoningEffort?: string,
  ) {
    if (reviewing || saveState === 'conflict') return null;
    const targetCandidate = target === 'candidate' ? candidate : null;
    if (
      target === 'candidate' &&
      !candidateIsActionable(targetCandidate)
    ) {
      setActionError(
        'Candidate này được tạo từ một bản cũ. Bạn vẫn có thể xem để so sánh, nhưng hãy tạo candidate mới từ bản hiện tại để tiếp tục.',
      );
      return null;
    }
    const startedAt = Date.now();
    setReviewing(true);
    setActionError('');
    try {
      const reviewed = await operationQueueRef.current.enqueue(async () => {
        const currentProject = target === 'current'
          ? await saveCurrentDraft()
          : projectRef.current;
        if (!currentProject) throw new VoiceVisualOperationCancelledError();
        const candidateId = targetCandidate?.candidateId;
        const fingerprint = JSON.stringify({
          projectId,
          revision: currentProject.revision,
          target,
          candidateId,
          model,
          reasoningEffort,
        });
        const previous = reviewRequestRef.current;
        const reviewId = previous?.fingerprint === fingerprint
          ? previous.reviewId
          : crypto.randomUUID();
        reviewRequestRef.current = {fingerprint, reviewId};
        return reviewVoiceVisualPlan(
          projectId,
          {
            reviewId,
            ...(candidateId ? {candidateId} : {}),
            model: model || undefined,
            reasoningEffort: reasoningEffort || undefined,
          },
          currentProject.revision,
        );
      });
      reviewRequestRef.current = null;
      setStandaloneReview(reviewed);
      if (target === 'current') setSaveState('saved');
      if (reasoningEffort) {
        recordCodexWaitSample({
          model: reviewed.generation.requestedModel ?? model ?? reviewed.generation.model,
          reasoningEffort,
          task: 'voiceVisual',
          workUnits: Math.max(
            1,
            draftRef.current?.sections.reduce(
              (total, section) => total + section.beats.length,
              0,
            ) ?? 1,
          ),
          elapsedMs: Date.now() - startedAt,
        });
      }
      return reviewed;
    } catch (error) {
      if (error instanceof VoiceVisualOperationCancelledError) return null;
      if (
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT'
      ) {
        setSaveState('conflict');
      }
      setActionError(
        error instanceof VoiceVisualDraftInvalidError
          ? 'Hãy hoàn thiện các beat đang chỉnh trước khi nhờ AI review.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Không thể review kế hoạch voice–visual lúc này.',
      );
      return null;
    } finally {
      setReviewing(false);
    }
  }

  async function applyCandidate(candidateId = candidate?.candidateId) {
    if (!candidateId || candidateApplying || saveState === 'conflict') {
      return null;
    }
    if (
      candidateId === candidate?.candidateId &&
      !candidateIsActionable(candidate)
    ) {
      setActionError(
        'Candidate này không còn cùng bản nền hiện tại. Hãy tạo candidate mới thay vì áp dụng nội dung cũ.',
      );
      return null;
    }
    setCandidateApplying(true);
    setActionError('');
    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = await projectForContentReplacement();
          return applyVoiceVisualCandidate(
            projectId,
            candidateId,
            currentProject.revision,
          );
        },
      );
      const content = getPlanContent(updatedProject);
      projectRef.current = updatedProject;
      draftRef.current = content;
      setProject(updatedProject);
      setDraftState(content);
      setCandidate(null);
      setStandaloneReview(null);
      setSaveState('saved');
      const loadedHistory = await getVoiceVisualHistory(projectId);
      setHistory(loadedHistory);
      return updatedProject;
    } catch (error) {
      if (error instanceof VoiceVisualOperationCancelledError) return null;
      if (
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT'
      ) {
        setSaveState('conflict');
      }
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể áp dụng bản đề xuất voice–visual.',
      );
      return null;
    } finally {
      setCandidateApplying(false);
    }
  }

  async function rejectCandidate(candidateId = candidate?.candidateId) {
    if (!candidateId || !projectRef.current || historyBusy) return null;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const rejected = await operationQueueRef.current.enqueue(async () => {
        const currentProject = projectRef.current;
        if (!currentProject) throw new VoiceVisualOperationCancelledError();
        return rejectVoiceVisualCandidate(
          projectId,
          candidateId,
          currentProject.revision,
        );
      });
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
      if (standaloneReview?.targetCandidateId === candidateId) {
        setStandaloneReview(null);
      }
      return rejected;
    } catch (error) {
      setHistoryError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể từ chối candidate voice–visual.',
      );
      return null;
    } finally {
      setHistoryBusy(false);
    }
  }

  async function createCheckpoint(label: string) {
    if (historyBusy || saveState === 'conflict') return null;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const version = await operationQueueRef.current.enqueue(async () => {
        const currentProject = await saveCurrentDraft();
        return createVoiceVisualCheckpoint(
          projectId,
          label,
          currentProject.revision,
        );
      });
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
          : 'Không thể lưu phiên bản voice–visual.',
      );
      return null;
    } finally {
      setHistoryBusy(false);
    }
  }

  async function restoreVersion(version: VoiceVisualVersionRecord) {
    if (historyBusy || saveState === 'conflict') return null;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const updatedProject = await operationQueueRef.current.enqueue(
        async () => {
          const currentProject = await projectForContentReplacement();
          return restoreVoiceVisualVersion(
            projectId,
            version.versionId,
            currentProject.revision,
          );
        },
      );
      const content = getPlanContent(updatedProject);
      projectRef.current = updatedProject;
      draftRef.current = content;
      setProject(updatedProject);
      setDraftState(content);
      setCandidate(null);
      setStandaloneReview(null);
      setSaveState('saved');
      setHistory(await getVoiceVisualHistory(projectId));
      return updatedProject;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT'
      ) {
        setSaveState('conflict');
      }
      setHistoryError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể khôi phục phiên bản voice–visual.',
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
          return approveVoiceVisualPlan(projectId, savedProject.revision);
        },
      );
      projectRef.current = updatedProject;
      setProject(updatedProject);
      setSaveState('saved');
      return updatedProject;
    } catch (error) {
      if (error instanceof VoiceVisualOperationCancelledError) return null;
      const isConflict =
        error instanceof ApiRequestError &&
        error.code === 'PROJECT_CONFLICT';
      if (isConflict) setSaveState('conflict');
      setActionError(
        error instanceof VoiceVisualDraftInvalidError
          ? 'Hãy hoàn thiện kế hoạch voice–visual trước khi chốt.'
          : error instanceof VoiceVisualOutdatedError
            ? 'Mạch giảng đã thay đổi. Hãy tạo lại kế hoạch trước khi chốt.'
            : error instanceof ApiRequestError
              ? error.message
              : 'Không thể chốt kế hoạch voice–visual lúc này.',
      );
      return null;
    } finally {
      setApproving(false);
    }
  }

  const stale = project ? voiceVisualIsStale(project) : false;
  const ready = project ? outlineIsReady(project) : false;
  const validationErrors = voiceVisualValidationErrors(draft);
  if (
    draft &&
    project?.outline &&
    !voiceVisualMatchesOutline(draft, project.outline)
  ) {
    validationErrors.push(
      'Các ý trong kế hoạch không còn khớp mạch giảng hiện tại.',
    );
  }
  const valid = Boolean(
    draft && project?.outline && validationErrors.length === 0,
  );
  const hasUnsavedChanges = Boolean(
    project?.voiceVisualPlan &&
      draft &&
      !stale &&
      !sameValue(getPlanContent(project), draft),
  );

  const flushPendingSave = useCallback(async () => {
    const currentProject = projectRef.current;
    const currentDraft = draftRef.current;
    if (!currentProject?.voiceVisualPlan || !currentDraft) return true;
    if (voiceVisualIsStale(currentProject)) return true;
    if (sameValue(getPlanContent(currentProject), currentDraft)) return true;
    if (!VoiceVisualPlanContentSchema.safeParse(currentDraft).success) {
      return window.confirm(
        'Kế hoạch voice–visual đang có nội dung chưa hợp lệ và chưa thể lưu. Rời trang sẽ bỏ các thay đổi này. Bạn có muốn tiếp tục?',
      );
    }
    try {
      setSaveState('saving');
      await operationQueueRef.current.enqueue(saveCurrentDraft);
      setSaveState('saved');
      return true;
    } catch (error) {
      if (error instanceof VoiceVisualOperationCancelledError) return false;
      setSaveState(
        error instanceof ApiRequestError && error.code === 'PROJECT_CONFLICT'
          ? 'conflict'
          : 'error',
      );
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể lưu kế hoạch voice–visual trước khi rời trang.',
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
    reviewing,
    standaloneReview,
    historyBusy,
    history,
    historyError,
    candidate,
    approving,
    stale,
    ready,
    valid,
    validationErrors,
    updateDirection,
    updateBeat,
    addBeat,
    removeBeat,
    moveBeat,
    generate,
    createCandidate,
    reviewPlan,
    applyCandidate,
    rejectCandidate,
    createCheckpoint,
    restoreVersion,
    refreshHistory,
    selectCandidate: (nextCandidate: VoiceVisualCandidateRecord) => {
      setCandidate(nextCandidate);
      setStandaloneReview(current =>
        current?.targetCandidateId === nextCandidate.candidateId
          ? current
          : null,
      );
    },
    dismissCandidate: () => {
      setCandidate(null);
      setStandaloneReview(current =>
        current?.target === 'candidate' ? null : current,
      );
    },
    dismissReview: () => setStandaloneReview(null),
    approve,
    reload: () => setReloadKey((current) => current + 1),
  };
}

class VoiceVisualOperationCancelledError extends Error {}
class VoiceVisualDraftInvalidError extends Error {}
class VoiceVisualOutdatedError extends Error {}
class VoiceVisualOutlineNotReadyError extends Error {}
class VoiceVisualCandidateRequiredError extends Error {}
class VoiceVisualGuidanceRequiredError extends Error {}
class VoiceVisualCandidateBaseRequiredError extends Error {}
