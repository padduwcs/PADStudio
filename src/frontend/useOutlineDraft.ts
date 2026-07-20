import {useCallback, useEffect, useRef, useState} from 'react';
import {
  TeachingOutlineContentSchema,
  type TeachingOutlineContent,
  type TeachingOutlineSection,
  type TopicProject,
} from '../shared/topic.ts';
import {
  outlineIsStale,
  sameValue,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  approveTeachingOutline,
  generateTeachingOutline,
  getProject,
  updateTeachingOutline,
} from './api.ts';
import {recordCodexWaitSample} from './codexWaitEstimate.ts';
import {ProjectOperationQueue} from './projectOperationQueue.ts';

type LoadState = 'loading' | 'ready' | 'error';
export type OutlineSaveState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

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
  const [approving, setApproving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const projectRef = useRef<TopicProject | null>(null);
  const draftRef = useRef<TeachingOutlineContent | null>(null);
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
        const content = getOutlineContent(loadedProject);
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
      throw new OutlineOperationCancelledError();
    }

    const parsedDraft = TeachingOutlineContentSchema.safeParse(currentDraft);
    if (!parsedDraft.success) {
      throw new OutlineDraftInvalidError();
    }
    if (
      currentProject.outline &&
      sameValue(getOutlineContent(currentProject), parsedDraft.data)
    ) {
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
    return updatedProject;
  }, [projectId]);

  useEffect(() => {
    if (
      loadState !== 'ready' ||
      !project?.outline ||
      !draft ||
      generating ||
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
          if (active) setSaveState('saved');
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
    draft,
    generating,
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
      if (current.sections.length >= 10) return current;
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
      if (current.sections.length <= 2) return current;
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

          if (draftRef.current) {
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
      generationRequestRef.current = null;
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
  const valid = Boolean(
    draft && TeachingOutlineContentSchema.safeParse(draft).success,
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
    valid,
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
    approve,
    reload: () => setReloadKey((current) => current + 1),
  };
}

class OutlineOperationCancelledError extends Error {}
class OutlineDraftInvalidError extends Error {}
