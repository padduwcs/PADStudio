import {useCallback, useEffect, useRef, useState} from 'react';
import {
  CreationIdSchema,
  TopicInputSchema,
  type TopicInput,
  type TopicProject,
  type UpdateProject,
} from '../shared/topic.ts';
import {
  ApiRequestError,
  createTopicProject,
  getProject,
  updateTopicProject,
} from './api.ts';
import {ProjectOperationQueue} from './projectOperationQueue.ts';

const STORAGE_KEY = 'pad-studio:topic-form:v1';
const CREATION_ID_KEY = 'pad-studio:topic-creation-id:v1';

export function clearLocalTopicDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CREATION_ID_KEY);
  } catch {
    // Browser draft persistence is best-effort.
  }
}

export interface TopicFormState {
  topic: string;
  learningGoal: string;
  videoDirection: string;
  audience: TopicInput['audience'];
  duration: TopicInput['duration'];
  targetDurationMinutes: number;
}

type FieldErrors = Partial<Record<keyof TopicFormState, string>>;
type SubmitState = 'idle' | 'submitting' | 'success' | 'error';
type LoadState = 'loading' | 'ready' | 'error';
export type SaveState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

const initialForm: TopicFormState = {
  topic: '',
  learningGoal: '',
  videoDirection: '',
  audience: 'beginner',
  duration: 'standard',
  targetDurationMinutes: 10,
};

function loadLocalDraft(): TopicFormState {
  try {
    const storedValue = localStorage.getItem(STORAGE_KEY);
    if (!storedValue) return initialForm;

    const value = JSON.parse(storedValue) as Partial<TopicFormState>;
    return {
      topic: typeof value.topic === 'string' ? value.topic : '',
      learningGoal:
        typeof value.learningGoal === 'string' ? value.learningGoal : '',
      videoDirection:
        typeof value.videoDirection === 'string' ? value.videoDirection : '',
      audience:
        value.audience === 'familiar' || value.audience === 'beginner'
          ? value.audience
          : 'beginner',
      duration:
        value.duration === 'concise' ||
        value.duration === 'standard' ||
        value.duration === 'deep' ||
        value.duration === 'custom'
          ? value.duration
          : 'standard',
      targetDurationMinutes:
        typeof value.targetDurationMinutes === 'number' &&
        Number.isFinite(value.targetDurationMinutes)
          ? value.targetDurationMinutes
          : 10,
    };
  } catch {
    return initialForm;
  }
}

function getOrCreateCreationId() {
  try {
    const storedValue = localStorage.getItem(CREATION_ID_KEY);
    const storedCreationId = CreationIdSchema.safeParse(storedValue);
    if (storedCreationId.success) return storedCreationId.data;

    const creationId = crypto.randomUUID();
    localStorage.setItem(CREATION_ID_KEY, creationId);
    return creationId;
  } catch {
    return crypto.randomUUID();
  }
}

function toFormState(input: TopicInput): TopicFormState {
  return {
    topic: input.topic,
    learningGoal: input.learningGoal ?? '',
    videoDirection: input.videoDirection ?? '',
    audience: input.audience,
    duration: input.duration,
    targetDurationMinutes: input.targetDurationMinutes ?? 10,
  };
}

function toCandidate(form: TopicFormState) {
  const {targetDurationMinutes, ...baseForm} = form;
  return {
    ...baseForm,
    targetDurationMinutes:
      form.duration === 'custom' ? targetDurationMinutes : undefined,
    learningGoal: form.learningGoal.trim() || undefined,
    videoDirection: form.videoDirection.trim() || undefined,
  };
}

function getFieldErrors(
  issues: Array<{path: PropertyKey[]; message: string}>,
): FieldErrors {
  const errors: FieldErrors = {};

  for (const issue of issues) {
    const field = String(issue.path[0]) as keyof TopicFormState;
    errors[field] ??= issue.message;
  }

  return errors;
}

export function useTopicDraft({
  projectId,
  onContinue,
  autosavePaused = false,
}: {
  projectId?: string;
  onContinue: (project: TopicProject) => void;
  autosavePaused?: boolean;
}) {
  const [form, setForm] = useState<TopicFormState>(() =>
    projectId ? initialForm : loadLocalDraft(),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState('');
  const [loadState, setLoadState] = useState<LoadState>(
    projectId ? 'loading' : 'ready',
  );
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [project, setProject] = useState<TopicProject | null>(null);
  const projectRef = useRef<TopicProject | null>(null);
  const projectSessionRef = useRef(0);
  const operationQueueRef = useRef(new ProjectOperationQueue());
  const creationIdRef = useRef<string | null>(
    projectId ? null : getOrCreateCreationId(),
  );

  const enqueueProjectUpdate = useCallback(
    (update: UpdateProject) => {
      const targetProjectId = projectId;
      const targetSession = projectSessionRef.current;
      const queue = operationQueueRef.current;

      return queue.enqueue(async () => {
        const currentProject = projectRef.current;
        if (
          !targetProjectId ||
          projectSessionRef.current !== targetSession ||
          currentProject?.id !== targetProjectId
        ) {
          throw new ProjectOperationCancelledError();
        }

        const updatedProject = await updateTopicProject(
          targetProjectId,
          update,
          currentProject.revision,
        );

        if (projectSessionRef.current === targetSession) {
          projectRef.current = updatedProject;
          setProject(updatedProject);
        }

        return updatedProject;
      });
    },
    [projectId],
  );

  useEffect(() => {
    let active = true;
    const session = projectSessionRef.current + 1;
    projectSessionRef.current = session;
    operationQueueRef.current = new ProjectOperationQueue();
    projectRef.current = null;
    setFieldErrors({});
    setSubmitError('');
    setSubmitState('idle');
    setLoadError('');

    if (!projectId) {
      setForm(loadLocalDraft());
      setProject(null);
      creationIdRef.current = getOrCreateCreationId();
      setLoadState('ready');
      setSaveState('idle');
      return () => {
        active = false;
      };
    }

    setLoadState('loading');
    setSaveState('idle');

    void getProject(projectId)
      .then((loadedProject) => {
        if (!active || projectSessionRef.current !== session) return;
        projectRef.current = loadedProject;
        setProject(loadedProject);
        setForm(toFormState(loadedProject.topicInput));
        setLoadState('ready');
        setSaveState('saved');
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
  }, [projectId]);

  useEffect(() => {
    if (projectId || loadState !== 'ready') return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // Local draft persistence is a convenience; the form remains usable.
    }
  }, [form, loadState, projectId]);

  useEffect(() => {
    if (
      !projectId ||
      !project ||
      loadState !== 'ready' ||
      submitState === 'submitting' ||
      autosavePaused ||
      saveState === 'conflict'
    ) {
      return;
    }

    const parsedInput = TopicInputSchema.safeParse(toCandidate(form));
    if (!parsedInput.success) {
      setSaveState('idle');
      return;
    }

    if (
      JSON.stringify(parsedInput.data) === JSON.stringify(project.topicInput)
    ) {
      setSaveState('saved');
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      setSaveState('saving');

      void enqueueProjectUpdate({topicInput: parsedInput.data})
        .then(() => {
          if (!active) return;
          setSaveState('saved');
        })
        .catch((error) => {
          if (!active) return;

          if (error instanceof ProjectOperationCancelledError) return;
          setSaveState(
            error instanceof ApiRequestError &&
              error.code === 'PROJECT_CONFLICT'
              ? 'conflict'
              : 'error',
          );
        });
    }, 700);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    autosavePaused,
    enqueueProjectUpdate,
    form,
    loadState,
    project,
    projectId,
    submitState,
  ]);

  function updateField<Key extends keyof TopicFormState>(
    field: Key,
    value: TopicFormState[Key],
  ) {
    setForm((current) => ({...current, [field]: value}));
    setFieldErrors((current) => ({...current, [field]: undefined}));
    setSubmitError('');

    if (submitState === 'success') {
      setSubmitState('idle');
    }
  }

  async function submit() {
    const parsedInput = TopicInputSchema.safeParse(toCandidate(form));

    if (!parsedInput.success) {
      setFieldErrors(getFieldErrors(parsedInput.error.issues));
      setSubmitState('error');
      setSubmitError('Hãy kiểm tra lại các trường được đánh dấu.');
      return null;
    }

    setFieldErrors({});
    setSubmitError('');
    setSubmitState('submitting');

    try {
      const continuedProject = projectId
        ? await enqueueProjectUpdate({
            topicInput: parsedInput.data,
            currentStep: 'outline',
          })
        : await createTopicProject({
            creationId: creationIdRef.current ?? getOrCreateCreationId(),
            topicInput: parsedInput.data,
            currentStep: 'outline',
          });

      clearLocalTopicDraft();
      creationIdRef.current = null;
      projectRef.current = continuedProject;
      setProject(continuedProject);
      setSaveState('saved');
      setSubmitState('success');
      onContinue(continuedProject);
      return continuedProject;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const serverErrors: FieldErrors = {};
        for (const [field, messages] of Object.entries(error.fields ?? {})) {
          serverErrors[field as keyof TopicFormState] = messages[0];
        }
        setFieldErrors(serverErrors);
        setSubmitError(
          error.code === 'PROJECT_CONFLICT'
            ? `${error.message} Hãy mở lại project để tránh ghi đè thay đổi mới.`
            : error.message,
        );
        if (error.code === 'PROJECT_CONFLICT') {
          setSaveState('conflict');
        }
      } else {
        setSubmitError('Đã có lỗi ngoài dự kiến. Hãy thử lại.');
      }

      setSubmitState('error');
      return null;
    }
  }

  return {
    form,
    fieldErrors,
    submitState,
    submitError,
    loadState,
    loadError,
    saveState,
    project,
    updateField,
    submit,
  };
}

class ProjectOperationCancelledError extends Error {}
