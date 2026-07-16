import {useEffect, useState} from 'react';
import {
  TopicInputSchema,
  type TopicInput,
  type TopicProject,
} from '../shared/topic.ts';
import {
  ApiRequestError,
  createTopicProject,
  getProject,
  updateTopicProject,
} from './api.ts';

const STORAGE_KEY = 'pad-studio:topic-form:v1';

export function clearLocalTopicDraft() {
  localStorage.removeItem(STORAGE_KEY);
}

export interface TopicFormState {
  topic: string;
  learningGoal: string;
  audience: TopicInput['audience'];
  duration: TopicInput['duration'];
}

type FieldErrors = Partial<Record<keyof TopicFormState, string>>;
type SubmitState = 'idle' | 'submitting' | 'success' | 'error';
type LoadState = 'loading' | 'ready' | 'error';
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const initialForm: TopicFormState = {
  topic: '',
  learningGoal: '',
  audience: 'beginner',
  duration: 'standard',
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
      audience:
        value.audience === 'familiar' || value.audience === 'beginner'
          ? value.audience
          : 'beginner',
      duration:
        value.duration === 'concise' ||
        value.duration === 'standard' ||
        value.duration === 'deep'
          ? value.duration
          : 'standard',
    };
  } catch {
    return initialForm;
  }
}

function toFormState(input: TopicInput): TopicFormState {
  return {
    topic: input.topic,
    learningGoal: input.learningGoal ?? '',
    audience: input.audience,
    duration: input.duration,
  };
}

function toCandidate(form: TopicFormState) {
  return {
    ...form,
    learningGoal: form.learningGoal.trim() || undefined,
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
}: {
  projectId?: string;
  onContinue: (project: TopicProject) => void;
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

  useEffect(() => {
    let active = true;
    setFieldErrors({});
    setSubmitError('');
    setSubmitState('idle');
    setLoadError('');

    if (!projectId) {
      setForm(loadLocalDraft());
      setProject(null);
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
        if (!active) return;
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
      submitState === 'submitting'
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

      void updateTopicProject(projectId, {topicInput: parsedInput.data})
        .then((updatedProject) => {
          if (!active) return;
          setProject(updatedProject);
          setSaveState('saved');
        })
        .catch(() => {
          if (!active) return;
          setSaveState('error');
        });
    }, 700);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [form, loadState, project, projectId, submitState]);

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
      const baseProject = projectId
        ? await updateTopicProject(projectId, {
            topicInput: parsedInput.data,
            currentStep: 'outline',
          })
        : await createTopicProject(parsedInput.data);
      const continuedProject =
        baseProject.currentStep === 'outline'
          ? baseProject
          : await updateTopicProject(baseProject.id, {
              currentStep: 'outline',
            });

      clearLocalTopicDraft();
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
        setSubmitError(error.message);
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
