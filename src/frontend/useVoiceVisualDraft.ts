import {useCallback, useEffect, useRef, useState} from 'react';
import {
  VoiceVisualPlanContentSchema,
  type TopicProject,
  type VoiceVisualBeat,
  type VoiceVisualPlanContent,
} from '../shared/topic.ts';
import {plannedBeatDurationSeconds} from '../shared/narrationTiming.ts';
import {
  outlineIsReady,
  sameValue,
  voiceVisualIsStale,
  voiceVisualMatchesOutline,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  approveVoiceVisualPlan,
  generateVoiceVisualPlan,
  getProject,
  updateVoiceVisualPlan,
} from './api.ts';
import {ProjectOperationQueue} from './projectOperationQueue.ts';

type LoadState = 'loading' | 'ready' | 'error';
export type VoiceVisualSaveState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

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
  const [approving, setApproving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const projectRef = useRef<TopicProject | null>(null);
  const draftRef = useRef<VoiceVisualPlanContent | null>(null);
  const generationRequestRef = useRef<{
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
    setProject(null);
    setDraftState(null);
    setLoadState('loading');
    setLoadError('');
    setActionError('');
    setSaveState('idle');
    setGenerating(false);
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
    if (
      currentProject.voiceVisualPlan &&
      sameValue(getPlanContent(currentProject), parsedDraft.data)
    ) {
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
    return updatedProject;
  }, [projectId]);

  useEffect(() => {
    if (
      loadState !== 'ready' ||
      !project?.voiceVisualPlan ||
      !draft ||
      generating ||
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
          if (active) setSaveState('saved');
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
    draft,
    generating,
    loadState,
    project,
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
                      const updated = {...beat, [field]: value};
                      if (
                        field !== 'voiceover' &&
                        field !== 'visualHoldSeconds'
                      ) {
                        return updated;
                      }
                      return {
                        ...updated,
                        durationSeconds: plannedBeatDurationSeconds(
                          String(updated.voiceover),
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
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.outlineSectionId === outlineSectionId &&
        section.beats.length < 8
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
    }));
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

  async function generate(guidance: string) {
    if (generating || saveState === 'conflict') return null;
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
            {generationId, guidance: normalizedGuidance},
            currentProject.revision,
          );
        },
      );
      const content = getPlanContent(updatedProject);
      projectRef.current = updatedProject;
      draftRef.current = content;
      setProject(updatedProject);
      setDraftState(content);
      setSaveState('saved');
      generationRequestRef.current = null;
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
  const valid = Boolean(
    draft &&
      project?.outline &&
      VoiceVisualPlanContentSchema.safeParse(draft).success &&
      voiceVisualMatchesOutline(draft, project.outline),
  );

  return {
    project,
    draft,
    loadState,
    loadError,
    saveState,
    actionError,
    generating,
    approving,
    stale,
    ready,
    valid,
    updateDirection,
    updateBeat,
    addBeat,
    removeBeat,
    moveBeat,
    generate,
    approve,
    reload: () => setReloadKey((current) => current + 1),
  };
}

class VoiceVisualOperationCancelledError extends Error {}
class VoiceVisualDraftInvalidError extends Error {}
class VoiceVisualOutdatedError extends Error {}
class VoiceVisualOutlineNotReadyError extends Error {}
