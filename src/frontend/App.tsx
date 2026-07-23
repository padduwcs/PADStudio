import {
  lazy,
  Suspense,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  TopicInputSchema,
  type TopicGuidanceGenerationResponse,
  type ProjectStep,
  type TeachingOutlineContent,
  type TopicProject,
} from '../shared/topic.ts';
import type {
  OutlineGlobalField,
  OutlineSectionField,
  OutlineVersionRecord,
} from '../shared/outlineHistory.ts';
import {targetNarrationTokenCount} from '../shared/narrationTiming.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {AdaptiveHeading} from './AdaptiveText.tsx';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  FolderIcon,
  LayersIcon,
  LightbulbIcon,
  LockIcon,
  MenuIcon,
  SparkIcon,
  UserIcon,
  XIcon,
} from './icons.tsx';
import {ProjectLibrary} from './ProjectLibrary.tsx';
import {
  navigate,
  navigateDiscardingPendingChanges,
  projectOutlinePath,
  projectStepPath,
  projectTopicPath,
  projectVoiceVisualPath,
  useAppRoute,
} from './router.ts';
import {
  clearLocalTopicDraft,
  type TopicFormState,
  useTopicDraft,
} from './useTopicDraft.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {useOutlineDraft} from './useOutlineDraft.ts';
import {ApiRequestError, generateTopicGuidance} from './api.ts';

const VoiceVisualPage = lazy(async () => {
  const module = await import('./VoiceVisualPage.tsx');
  return {default: module.VoiceVisualPage};
});
const MotionCanvasPage = lazy(async () => {
  const module = await import('./MotionCanvasPage.tsx');
  return {default: module.MotionCanvasPage};
});
const VoicePage = lazy(async () => {
  const module = await import('./VoicePage.tsx');
  return {default: module.VoicePage};
});
const AnimationSyncPage = lazy(async () => {
  const module = await import('./AnimationSyncPage.tsx');
  return {default: module.AnimationSyncPage};
});
const LayoutEditorPage = lazy(async () => {
  const module = await import('./LayoutEditorPage.tsx');
  return {default: module.LayoutEditorPage};
});
const FinalRenderPage = lazy(async () => {
  const module = await import('./FinalRenderPage.tsx');
  return {default: module.FinalRenderPage};
});

const pipelineSteps: ReadonlyArray<{
  id: ProjectStep;
  label: string;
}> = [
  {id: 'topic', label: 'Nhập chủ đề'},
  {id: 'outline', label: 'Mạch giảng'},
  {id: 'voiceVisual', label: 'Voice — visual'},
  {id: 'motionCanvas', label: 'Sinh scene Motion Canvas'},
  {id: 'voice', label: 'Tạo voice ElevenLabs'},
  {id: 'sync', label: 'Đồng bộ'},
  {id: 'layout', label: 'Layout Editor'},
  {id: 'render', label: 'Render cuối'},
];

const topicSuggestions = [
  'Tìm kiếm nhị phân',
  'Cây tìm kiếm nhị phân',
  'Duyệt đồ thị BFS',
];

const audienceOptions: Array<{
  value: TopicFormState['audience'];
  title: string;
  description: string;
}> = [
  {
    value: 'beginner',
    title: 'Người mới',
    description: 'Chưa có mô hình tư duy rõ',
  },
  {
    value: 'familiar',
    title: 'Đã biết cơ bản',
    description: 'Cần hiểu sâu bản chất',
  },
];

const durationOptions: Array<{
  value: TopicFormState['duration'];
  title: string;
  description: string;
}> = [
  {value: 'concise', title: 'Ngắn gọn', description: '1–2 phút'},
  {value: 'standard', title: 'Tiêu chuẩn', description: '3–5 phút'},
  {value: 'deep', title: 'Chuyên sâu', description: '6–8 phút'},
  {
    value: 'custom',
    title: 'Tùy chỉnh',
    description: 'Chọn số phút',
  },
];

const audienceLabels: Record<TopicFormState['audience'], string> = {
  beginner: 'Người mới',
  familiar: 'Đã biết cơ bản',
};

const durationLabels: Record<TopicFormState['duration'], string> = {
  concise: '1–2 phút',
  standard: '3–5 phút',
  deep: '6–8 phút',
  custom: 'Tùy chỉnh',
};

function durationLabel(
  input: Pick<TopicFormState, 'duration' | 'targetDurationMinutes'>,
) {
  return input.duration === 'custom'
    ? Number.isFinite(input.targetDurationMinutes)
      ? `${input.targetDurationMinutes} phút (mục tiêu)`
      : 'Chưa chọn thời lượng'
    : durationLabels[input.duration];
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="PAD Studio — Trang chủ">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="brand-name">
        PAD <strong>Studio</strong>
      </span>
    </a>
  );
}

function PipelineSidebar({
  activeStep,
  hasProject,
  open,
  onClose,
  onOpenProjects,
  onSelectStep,
}: {
  activeStep: number;
  hasProject: boolean;
  open: boolean;
  onClose: () => void;
  onOpenProjects: () => void;
  onSelectStep: (step: ProjectStep) => void;
}) {
  return (
    <aside
      id="pipeline-navigation"
      className={`pipeline-sidebar${open ? ' is-open' : ''}`}
    >
      <div className="sidebar-mobile-heading">
        <Brand />
        <button
          type="button"
          aria-label="Đóng quy trình sản xuất"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      <button
        className="projects-nav-button"
        type="button"
        onClick={() => {
          onClose();
          onOpenProjects();
        }}
      >
        <FolderIcon />
        Project của bạn
      </button>

      <div className="sidebar-heading">
        <span>Quy trình sản xuất</span>
        <strong>{String(activeStep + 1).padStart(2, '0')} / 08</strong>
      </div>

      <nav aria-label="Các bước sản xuất video">
        <ol className="pipeline-list">
          {pipelineSteps.map((step, index) => {
            const unavailable = !hasProject && step.id !== 'topic';
            return (
            <li
              className={index === activeStep ? 'is-active' : ''}
              key={step.id}
            >
              <button
                className="pipeline-step-button"
                type="button"
                aria-current={index === activeStep ? 'step' : undefined}
                disabled={unavailable}
                title={
                  unavailable
                    ? 'Hãy lưu chủ đề để mở các bước còn lại.'
                    : `Mở ${step.label}`
                }
                onClick={() => {
                  if (index === activeStep) {
                    onClose();
                    return;
                  }
                  onSelectStep(step.id);
                }}
              >
                <span className="step-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="step-name">{step.label}</span>
              </button>
            </li>
            );
          })}
        </ol>
      </nav>

      <div className="sidebar-note">
        <LightbulbIcon />
        <p>
          Chọn bất kỳ bước nào để mở trực tiếp. Bước chưa đủ dữ liệu sẽ hiển
          thị điều kiện cần hoàn tất.
        </p>
      </div>
    </aside>
  );
}

function MobileHeader({
  activeStep,
  sidebarOpen,
  onToggleSidebar,
  onOpenProjects,
}: {
  activeStep: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenProjects: () => void;
}) {
  return (
    <header className="mobile-header">
      <div className="mobile-brand-group">
        <button
          className="mobile-sidebar-button"
          type="button"
          aria-label="Mở quy trình sản xuất"
          aria-controls="pipeline-navigation"
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <MenuIcon />
        </button>
        <Brand />
      </div>
      <div className="mobile-progress">
        <button
          className="mobile-projects-button"
          type="button"
          aria-label="Mở danh sách project"
          onClick={onOpenProjects}
        >
          <FolderIcon />
        </button>
        <span>Bước {activeStep + 1} / 8</span>
        <span className="mobile-progress-track">
          <span style={{width: `${((activeStep + 1) / 8) * 100}%`}} />
        </span>
      </div>
    </header>
  );
}

function ChoiceCard({
  name,
  checked,
  title,
  description,
  onChange,
  value,
}: {
  name: string;
  checked: boolean;
  title: string;
  description: string;
  onChange: () => void;
  value: string;
}) {
  return (
    <label className={`choice-card${checked ? ' is-selected' : ''}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
      />
      <span className="choice-radio" aria-hidden="true">
        <span />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function BriefPreview({
  form,
  savedProjectId,
}: {
  form: TopicFormState;
  savedProjectId?: string;
}) {
  const hasTopic = form.topic.trim().length >= 6;
  const hasGoal = form.learningGoal.trim().length > 0;

  return (
    <aside className="brief-preview" aria-label="Tóm tắt đầu vào">
      <div className="preview-topline">
        <span className="preview-kicker">
          <SparkIcon />
          Brief đầu vào
        </span>
        <span className={`draft-status${savedProjectId ? ' is-saved' : ''}`}>
          <span />
          {savedProjectId ? 'Đã lưu' : 'Bản nháp'}
        </span>
      </div>

      <div className="concept-visual" aria-hidden="true">
        <div className="visual-orbit orbit-one" />
        <div className="visual-orbit orbit-two" />
        <span className="visual-node node-main">
          <LayersIcon />
        </span>
        <span className="visual-node node-a" />
        <span className="visual-node node-b" />
        <span className="visual-node node-c" />
        <span className="visual-caption">Ý tưởng → Trực giác</span>
      </div>

      <div className="preview-content">
        <span className="preview-label">Chủ đề</span>
        <AdaptiveHeading as="h2">
          {form.topic.trim() || 'Chủ đề của bạn sẽ hiện ở đây'}
        </AdaptiveHeading>
        <p>
          {form.learningGoal.trim() ||
            'Thêm mục tiêu để AI hiểu chính xác điều người xem cần nắm được.'}
        </p>
      </div>

      {form.videoDirection.trim() && (
        <div className="preview-direction">
          <span className="preview-label">Định hướng video</span>
          <p>{form.videoDirection}</p>
        </div>
      )}

      <dl className="brief-meta">
        <div>
          <dt>
            <UserIcon />
            Người xem
          </dt>
          <dd>{audienceLabels[form.audience]}</dd>
        </div>
        <div>
          <dt>
            <ClockIcon />
            Thời lượng
          </dt>
          <dd>{durationLabel(form)}</dd>
        </div>
      </dl>

      <div className="readiness">
        <span className="preview-label">Mức độ sẵn sàng</span>
        <ul>
          <li className={hasTopic ? 'is-ready' : ''}>
            <span><CheckIcon /></span>
            Chủ đề đủ rõ
          </li>
          <li className={hasGoal ? 'is-ready' : ''}>
            <span><CheckIcon /></span>
            Có mục tiêu học cụ thể
            <small>Không bắt buộc</small>
          </li>
        </ul>
      </div>

      {savedProjectId && (
        <div className="saved-project">
          <CheckIcon />
          <div>
            <strong>Đã tạo project draft</strong>
            <code>{savedProjectId}</code>
          </div>
        </div>
      )}
    </aside>
  );
}

function TopicPage({
  projectId,
  onContinue,
  autosavePaused,
}: {
  projectId?: string;
  onContinue: (project: TopicProject) => void;
  autosavePaused: boolean;
}) {
  const {
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
  } = useTopicDraft({projectId, onContinue, autosavePaused});
  const codexConnection = useCodexConnection();
  const [guidanceSuggestion, setGuidanceSuggestion] =
    useState<TopicGuidanceGenerationResponse | null>(null);
  const [guidanceGenerating, setGuidanceGenerating] = useState(false);
  const [guidanceError, setGuidanceError] = useState('');
  const guidanceRequestRef = useRef<{
    fingerprint: string;
    generationId: string;
  } | null>(null);

  useEffect(() => {
    setGuidanceSuggestion(null);
    setGuidanceError('');
    guidanceRequestRef.current = null;
  }, [
    form.audience,
    form.duration,
    form.targetDurationMinutes,
    form.topic,
  ]);

  async function requestTopicGuidance() {
    if (guidanceGenerating || codexConnection.checking) return;
    const topicInput = TopicInputSchema.safeParse({
      topic: form.topic,
      learningGoal: form.learningGoal.trim() || undefined,
      videoDirection: form.videoDirection.trim() || undefined,
      audience: form.audience,
      duration: form.duration,
      targetDurationMinutes:
        form.duration === 'custom'
          ? form.targetDurationMinutes
          : undefined,
    });
    if (!topicInput.success) {
      setGuidanceError(
        'Hãy nhập chủ đề và thời lượng hợp lệ trước khi nhờ AI đề xuất.',
      );
      return;
    }

    setGuidanceGenerating(true);
    setGuidanceError('');
    try {
      const connectionStatus = await codexConnection.verify();
      if (connectionStatus?.state !== 'connected') return;
      const selection = codexConnection.getGenerationSelection();
      if (!selection) {
        setGuidanceError('Hãy chọn model và reasoning effort trước.');
        return;
      }
      const fingerprint = JSON.stringify({
        topicInput: topicInput.data,
        ...selection,
      });
      if (guidanceRequestRef.current?.fingerprint !== fingerprint) {
        guidanceRequestRef.current = {
          fingerprint,
          generationId: crypto.randomUUID(),
        };
      }
      const response = await generateTopicGuidance({
        generationId: guidanceRequestRef.current.generationId,
        topicInput: topicInput.data,
        ...selection,
      });
      setGuidanceSuggestion(response);
      guidanceRequestRef.current = null;
    } catch (error) {
      setGuidanceError(
        error instanceof ApiRequestError
          ? error.message
          : 'Không thể tạo gợi ý định hướng lúc này.',
      );
    } finally {
      setGuidanceGenerating(false);
    }
  }

  async function continueWithVerifiedCodex() {
    if (submitState === 'submitting' || codexConnection.checking) return;

    const connectionStatus = await codexConnection.verify();
    if (connectionStatus?.state !== 'connected') return;
    if (!codexConnection.getGenerationSelection()) return;

    await submit();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!codexConnection.generationReady) return;
    await continueWithVerifiedCodex();
  }

  function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (
        submitState !== 'submitting' &&
        saveState !== 'conflict' &&
        codexConnection.generationReady
      ) {
        void continueWithVerifiedCodex();
      }
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="page-state" role="status">
        <span className="spinner dark" />
        <strong>Đang mở project…</strong>
        <p>PAD Studio đang đọc dữ liệu cục bộ.</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Không thể mở project</strong>
        <p>{loadError}</p>
        <button type="button" onClick={() => navigate('/')}>
          Tạo project mới
        </button>
      </div>
    );
  }

  return (
    <div className="workspace-inner">
      <section className="topic-section">
        <div className="page-heading">
          <div className="eyebrow">
            <span>Bước 01</span>
            <span className="eyebrow-line" />
            {projectId ? 'Tinh chỉnh đầu vào' : 'Khởi tạo dự án'}
          </div>
          <AdaptiveHeading as="h1">
            {projectId
              ? 'Làm rõ đầu vào trước khi tiếp tục.'
              : 'Bạn muốn làm rõ điều gì?'}
          </AdaptiveHeading>
          <p>
            {projectId
              ? 'Mọi thay đổi hợp lệ được tự động lưu vào project hiện tại.'
              : 'Bắt đầu bằng một chủ đề. PAD Studio sẽ dùng đầu vào này để xây mạch giảng trực quan ở bước tiếp theo.'}
          </p>
        </div>

        <form
          className="topic-form"
          onSubmit={handleSubmit}
          onKeyDown={handleFormKeyDown}
          noValidate
        >
              <div className="form-section primary-input">
                <div className="field-heading">
                  <label htmlFor="topic">Chủ đề cần giải thích</label>
                </div>
                <div
                  className={`textarea-shell${fieldErrors.topic ? ' has-error' : ''}`}
                >
                  <textarea
                    id="topic"
                    name="topic"
                    value={form.topic}
                    rows={3}
                    autoFocus
                    placeholder="Ví dụ: Vì sao tìm kiếm nhị phân nhanh hơn tìm kiếm tuần tự?"
                    aria-describedby={
                      fieldErrors.topic ? 'topic-error' : 'topic-help'
                    }
                    aria-invalid={Boolean(fieldErrors.topic)}
                    onChange={(event) => updateField('topic', event.target.value)}
                  />
                  <SparkIcon className="textarea-spark" />
                </div>
                {fieldErrors.topic ? (
                  <p className="field-error" id="topic-error">
                    {fieldErrors.topic}
                  </p>
                ) : (
                  <p className="field-help" id="topic-help">
                    Viết như cách bạn sẽ hỏi một người giảng giỏi.
                  </p>
                )}

                <div className="suggestion-row" aria-label="Chủ đề gợi ý">
                  <span>Thử nhanh</span>
                  {topicSuggestions.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => updateField('topic', suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-divider">
                <span>Định hướng thêm</span>
                <small>Giúp kết quả sát ý hơn</small>
              </div>

              <div className="form-section">
                <div className="field-heading">
                  <label htmlFor="learning-goal">
                    Sau video, người xem nên hiểu được gì?
                    <small>Tùy chọn</small>
                  </label>
                </div>
                <textarea
                  className={fieldErrors.learningGoal ? 'has-error' : ''}
                  id="learning-goal"
                  name="learningGoal"
                  value={form.learningGoal}
                  rows={2}
                  placeholder="Ví dụ: Hiểu trực giác “chia đôi” và biết khi nào có thể áp dụng."
                  aria-invalid={Boolean(fieldErrors.learningGoal)}
                  onChange={(event) =>
                    updateField('learningGoal', event.target.value)
                  }
                />
                {fieldErrors.learningGoal && (
                  <p className="field-error">{fieldErrors.learningGoal}</p>
                )}
              </div>

              <div className="form-section video-direction-field">
                <div className="field-heading">
                  <label htmlFor="video-direction">
                    Mô tả video bạn muốn làm
                    <small>Tùy chọn</small>
                  </label>
                </div>
                <textarea
                  className={fieldErrors.videoDirection ? 'has-error' : ''}
                  id="video-direction"
                  name="videoDirection"
                  value={form.videoDirection}
                  rows={4}
                  placeholder="Ví dụ: Video ngắn đăng TikTok, nhịp nhanh, mở đầu bằng một câu hỏi gây tò mò, không dùng code và tập trung vào trực giác."
                  aria-invalid={Boolean(fieldErrors.videoDirection)}
                  onChange={(event) =>
                    updateField('videoDirection', event.target.value)
                  }
                />
                {fieldErrors.videoDirection ? (
                  <p className="field-error">{fieldErrors.videoDirection}</p>
                ) : (
                  <p className="field-help">
                    Có thể ghi nền tảng đăng, phong cách, nhịp độ, điều cần nhấn
                    mạnh hoặc cần tránh.
                  </p>
                )}
              </div>

              <div className="options-grid">
                <fieldset className="form-section option-group">
                  <legend>
                    <UserIcon />
                    Người xem chính
                  </legend>
                  <div className="choice-grid">
                    {audienceOptions.map((option) => (
                      <ChoiceCard
                        key={option.value}
                        name="audience"
                        value={option.value}
                        checked={form.audience === option.value}
                        title={option.title}
                        description={option.description}
                        onChange={() =>
                          updateField('audience', option.value)
                        }
                      />
                    ))}
                  </div>
                </fieldset>

                <fieldset className="form-section option-group">
                  <legend>
                    <ClockIcon />
                    Độ dài dự kiến
                  </legend>
                  <div className="choice-grid duration-grid">
                    {durationOptions.map((option) => (
                      <ChoiceCard
                        key={option.value}
                        name="duration"
                        value={option.value}
                        checked={form.duration === option.value}
                        title={option.title}
                        description={option.description}
                        onChange={() =>
                          updateField('duration', option.value)
                        }
                      />
                    ))}
                  </div>
                  {form.duration === 'custom' && (
                    <label className="custom-duration-field">
                      <span>Thời lượng mục tiêu</span>
                      <span className="custom-duration-control">
                        <input
                          className={
                            fieldErrors.targetDurationMinutes
                              ? 'has-error'
                              : ''
                          }
                          type="number"
                          min={
                            pipelineSafetyLimits.minimumCustomDurationMinutes
                          }
                          max={
                            pipelineSafetyLimits.maximumCustomDurationMinutes
                          }
                          step="0.1"
                          value={
                            Number.isFinite(form.targetDurationMinutes)
                              ? form.targetDurationMinutes
                              : ''
                          }
                          aria-invalid={Boolean(
                            fieldErrors.targetDurationMinutes,
                          )}
                          onChange={(event) =>
                            updateField(
                              'targetDurationMinutes',
                              event.currentTarget.valueAsNumber,
                            )
                          }
                        />
                        <span>phút</span>
                      </span>
                      <small>
                        Đây là mục tiêu linh hoạt; nội dung có thể chênh khoảng
                        ±15% để giữ nhịp kể tự nhiên.
                      </small>
                      {fieldErrors.targetDurationMinutes && (
                        <span className="field-error" role="alert">
                          {fieldErrors.targetDurationMinutes}
                        </span>
                      )}
                    </label>
                  )}
                </fieldset>
              </div>

              <CodexConnectionCard connection={codexConnection} />

              <section className="topic-ai-guidance" aria-live="polite">
                <header>
                  <div>
                    <span className="preview-kicker">
                      <SparkIcon /> AI hỗ trợ định hướng
                    </span>
                    <h2>Không cần bắt đầu từ trang trắng</h2>
                    <p>
                      Codex sẽ dựa trên chủ đề, người xem và thời lượng để viết
                      một bản nháp. Bạn có thể tham khảo, áp dụng rồi chỉnh tiếp.
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      guidanceGenerating ||
                      codexConnection.checking ||
                      !codexConnection.generationReady ||
                      form.topic.trim().length < 6
                    }
                    onClick={() => void requestTopicGuidance()}
                  >
                    {guidanceGenerating ? (
                      <><span className="spinner" /> Đang đề xuất…</>
                    ) : guidanceSuggestion ? (
                      'Tạo phương án khác'
                    ) : (
                      'Đề xuất định hướng'
                    )}
                  </button>
                </header>

                {guidanceError && (
                  <p className="field-error" role="alert">{guidanceError}</p>
                )}

                {guidanceSuggestion && (
                  <div className="topic-guidance-result">
                    <div className="topic-guidance-result-heading">
                      <strong>Bản nháp từ {guidanceSuggestion.generation.model}</strong>
                      <button
                        type="button"
                        onClick={() => {
                          updateField(
                            'learningGoal',
                            guidanceSuggestion.suggestion.learningGoal,
                          );
                          updateField(
                            'videoDirection',
                            guidanceSuggestion.suggestion.videoDirection,
                          );
                        }}
                      >
                        Áp dụng cả hai trường
                      </button>
                    </div>
                    <article>
                      <span>Mục tiêu học</span>
                      <p>{guidanceSuggestion.suggestion.learningGoal}</p>
                      <button
                        type="button"
                        onClick={() =>
                          updateField(
                            'learningGoal',
                            guidanceSuggestion.suggestion.learningGoal,
                          )
                        }
                      >
                        Dùng mục tiêu này
                      </button>
                    </article>
                    <article>
                      <span>Định hướng video</span>
                      <p>{guidanceSuggestion.suggestion.videoDirection}</p>
                      <button
                        type="button"
                        onClick={() =>
                          updateField(
                            'videoDirection',
                            guidanceSuggestion.suggestion.videoDirection,
                          )
                        }
                      >
                        Dùng định hướng này
                      </button>
                    </article>
                    <div className="topic-guidance-angles">
                      <span>Góc khai thác có thể cân nhắc</span>
                      <ul>
                        {guidanceSuggestion.suggestion.suggestedAngles.map(
                          (angle) => <li key={angle}>{angle}</li>,
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </section>

              {submitError && submitState === 'error' && (
                <div className="submit-error" role="alert">
                  {submitError}
                </div>
              )}

              {submitState === 'success' && (
                <div className="submit-success" role="status">
                  <span><CheckIcon /></span>
                  <div>
                    <strong>Chủ đề đã được lưu an toàn.</strong>
                    <p>Project draft đã sẵn sàng cho bước tạo mạch giảng.</p>
                  </div>
                </div>
              )}

          <footer className="form-actions">
            <div className={`local-note save-${saveState}`}>
              <LockIcon />
              <span>
                {projectId
                  ? saveState === 'saving'
                    ? 'Đang tự động lưu…'
                    : saveState === 'conflict'
                      ? 'Có thay đổi mới ở nơi khác'
                    : saveState === 'error'
                      ? 'Tự động lưu thất bại'
                      : saveState === 'idle'
                        ? 'Có thay đổi chưa thể lưu'
                        : 'Đã lưu vào project'
                  : 'Bản nháp lưu trên trình duyệt'}
                <small>
                  {projectId
                    ? saveState === 'conflict'
                      ? 'Mở lại project trước khi tiếp tục chỉnh sửa'
                      : 'Thay đổi hợp lệ được lưu sau 0,7 giây'
                    : guidanceSuggestion
                      ? 'Gợi ý chỉ được lưu khi bạn áp dụng vào biểu mẫu'
                      : 'Bản nháp chỉ được gửi tới AI khi bạn chủ động yêu cầu'}
                </small>
              </span>
            </div>
                <button
                  className="submit-button"
                  type="submit"
                  disabled={
                    submitState === 'submitting' ||
                    saveState === 'conflict' ||
                    codexConnection.checking ||
                    !codexConnection.generationReady
                  }
                >
                  {submitState === 'submitting' ? (
                    <>
                      <span className="spinner" />
                      {projectId ? 'Đang lưu dự án…' : 'Đang tạo dự án…'}
                    </>
                  ) : (
                    <>
                      {projectId
                        ? 'Lưu & quay lại mạch giảng'
                        : 'Lưu & chuẩn bị mạch giảng'}
                      <ArrowRightIcon />
                    </>
                  )}
                </button>
                <span className="keyboard-hint">
                  <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
                </span>
          </footer>
        </form>
      </section>

      <BriefPreview form={form} savedProjectId={project?.id} />
    </div>
  );
}

type OutlineDiffItem = {
  key: string;
  label: string;
  before: string;
  after: string;
};

const outlineVersionOriginLabels: Record<
  OutlineVersionRecord['origin'],
  string
> = {
  baseline: 'Mốc tự động',
  manual_checkpoint: 'Người dùng lưu',
  ai_candidate: 'Áp dụng AI',
  restore: 'Khôi phục',
  approval: 'Đã chốt',
};

function outlineContentFromArtifact(
  artifact: OutlineVersionRecord['artifact'],
): TeachingOutlineContent {
  return {
    brief: artifact.brief,
    centralMessage: artifact.centralMessage,
    sections: artifact.sections,
  };
}

function outlineDiff(
  before: TeachingOutlineContent,
  after: TeachingOutlineContent,
) {
  const changes: OutlineDiffItem[] = [];
  const add = (key: string, label: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    changes.push({
      key,
      label,
      before: Array.isArray(left) ? left.join('\n') : String(left ?? ''),
      after: Array.isArray(right) ? right.join('\n') : String(right ?? ''),
    });
  };
  add('brief.summary', 'Tóm tắt yêu cầu', before.brief.summary, after.brief.summary);
  add(
    'brief.assumptions',
    'Các giả định',
    before.brief.assumptions,
    after.brief.assumptions,
  );
  add(
    'centralMessage',
    'Thông điệp trung tâm',
    before.centralMessage,
    after.centralMessage,
  );
  const beforeById = new Map(before.sections.map(section => [section.id, section]));
  const afterById = new Map(after.sections.map(section => [section.id, section]));
  const allIds = new Set([...beforeById.keys(), ...afterById.keys()]);
  for (const sectionId of allIds) {
    const left = beforeById.get(sectionId);
    const right = afterById.get(sectionId);
    const title = right?.title ?? left?.title ?? 'Section';
    if (!left || !right) {
      add(
        `section.${sectionId}`,
        `${title} · cấu trúc`,
        left ? 'Có trong phiên bản' : 'Không có',
        right ? 'Có trong phiên bản' : 'Không có',
      );
      continue;
    }
    add(`${sectionId}.title`, `${title} · tên ý`, left.title, right.title);
    add(`${sectionId}.goal`, `${title} · mục tiêu`, left.goal, right.goal);
    add(
      `${sectionId}.content`,
      `${title} · nội dung`,
      left.content,
      right.content,
    );
    add(
      `${sectionId}.estimatedSeconds`,
      `${title} · thời lượng`,
      `${left.estimatedSeconds} giây`,
      `${right.estimatedSeconds} giây`,
    );
  }
  return changes;
}

function OutlineDiffList({
  changes,
  beforeLabel = 'Đang dùng',
  afterLabel = 'Đề xuất',
}: {
  changes: OutlineDiffItem[];
  beforeLabel?: string;
  afterLabel?: string;
}) {
  if (changes.length === 0) {
    return <p className="outline-diff-empty">Không có khác biệt nội dung.</p>;
  }
  return (
    <div className="outline-diff-list">
      {changes.map(change => (
        <article key={change.key} className="outline-diff-item">
          <strong>{change.label}</strong>
          <div>
            <span>
              <small>{beforeLabel}</small>
              <p>{change.before || '—'}</p>
            </span>
            <span className="is-candidate">
              <small>{afterLabel}</small>
              <p>{change.after || '—'}</p>
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function OutlinePage({projectId}: {projectId: string}) {
  const outline = useOutlineDraft(projectId);
  const codexConnection = useCodexConnection();
  const [guidance, setGuidance] = useState('');
  const [scopeSectionIds, setScopeSectionIds] = useState<string[]>([]);
  const [sectionFields, setSectionFields] = useState<OutlineSectionField[]>([
    'goal',
    'content',
  ]);
  const [globalFields, setGlobalFields] = useState<OutlineGlobalField[]>([]);
  const [scopeError, setScopeError] = useState('');
  const [checkpointLabel, setCheckpointLabel] = useState('');
  const [selectedVersion, setSelectedVersion] =
    useState<OutlineVersionRecord | null>(null);

  useEffect(() => {
    const validIds = new Set(
      outline.draft?.sections.map(section => section.id) ?? [],
    );
    setScopeSectionIds(current =>
      current.filter(sectionId => validIds.has(sectionId)),
    );
  }, [outline.draft?.sections]);

  function toggleScopeSection(sectionId: string) {
    setScopeSectionIds(current =>
      current.includes(sectionId)
        ? current.filter(item => item !== sectionId)
        : [...current, sectionId],
    );
    setScopeError('');
  }

  function toggleSectionField(field: OutlineSectionField) {
    setSectionFields(current =>
      current.includes(field)
        ? current.filter(item => item !== field)
        : [...current, field],
    );
    setScopeError('');
  }

  function toggleGlobalField(field: OutlineGlobalField) {
    setGlobalFields(current =>
      current.includes(field)
        ? current.filter(item => item !== field)
        : [...current, field],
    );
    setScopeError('');
  }

  function selectEntireOutline() {
    if (!outline.draft) return;
    setGlobalFields([
      'brief.summary',
      'brief.assumptions',
      'centralMessage',
    ]);
    setScopeSectionIds(outline.draft.sections.map(section => section.id));
    setSectionFields(['title', 'goal', 'content', 'estimatedSeconds']);
    setScopeError('');
  }

  function selectAllOutlineSections() {
    if (!outline.draft) return;
    setScopeSectionIds(outline.draft.sections.map(section => section.id));
    if (sectionFields.length === 0) {
      setSectionFields(['title', 'goal', 'content', 'estimatedSeconds']);
    }
    setScopeError('');
  }

  function clearOutlineScope() {
    setGlobalFields([]);
    setScopeSectionIds([]);
    setScopeError('');
  }

  function prepareScopeExpansion() {
    const candidate = outline.candidate;
    const sections = outline.draft?.sections ?? [];
    if (!candidate || sections.length === 0) return;

    const validSectionIds = new Set(sections.map(section => section.id));
    const expandedIds = new Set(candidate.scope.sections.map(item => item.sectionId));
    for (const issue of candidate.coherence.issues) {
      if (!issue.requiresScopeExpansion) continue;
      for (const sectionId of issue.affectedSectionIds) {
        if (validSectionIds.has(sectionId)) expandedIds.add(sectionId);
      }
    }
    if (expandedIds.size === candidate.scope.sections.length) {
      const selectedIndexes = sections
        .map((section, index) => expandedIds.has(section.id) ? index : -1)
        .filter(index => index >= 0);
      for (const index of selectedIndexes) {
        const previous = sections[index - 1];
        const next = sections[index + 1];
        if (previous) expandedIds.add(previous.id);
        if (next) expandedIds.add(next.id);
      }
    }

    const expandedFields = new Set<OutlineSectionField>(
      candidate.scope.sections.flatMap(item => item.fields),
    );
    setScopeSectionIds([...expandedIds]);
    setSectionFields(
      expandedFields.size > 0 ? [...expandedFields] : ['content'],
    );
    setGlobalFields([...candidate.scope.globalFields]);
    const fixes = candidate.coherence.issues
      .filter(issue => issue.requiresScopeExpansion)
      .map(issue => issue.suggestedFix.trim())
      .filter(Boolean);
    setGuidance(
      [
        'Tiếp tục từ candidate hiện tại, giữ nguyên mọi phần đã tốt và chỉ xử lý các điểm reviewer nêu.',
        ...new Set(fixes),
      ]
        .join(' '),
    );
    setScopeError('');
  }

  async function handleGenerate() {
    if (
      outline.generating ||
      codexConnection.checking ||
      !codexConnection.generationReady
    ) return;
    const connectionStatus = await codexConnection.verify();
    if (connectionStatus?.state !== 'connected') return;
    const selection = codexConnection.getGenerationSelection();
    if (!selection) return;

    if (!outline.draft) {
      const generatedProject = await outline.generate(
        guidance,
        selection.model,
        selection.reasoningEffort,
      );
      if (generatedProject) setGuidance('');
      return;
    }

    if (!guidance.trim()) {
      setScopeError('Hãy mô tả cụ thể điều bạn muốn AI chỉnh.');
      return;
    }
    if (
      globalFields.length === 0 &&
      (scopeSectionIds.length === 0 || sectionFields.length === 0)
    ) {
      setScopeError('Hãy chọn ít nhất một phần AI được phép chỉnh.');
      return;
    }
    const nextCandidate = await outline.createEditCandidate(
      guidance,
      {
        globalFields,
        sections:
          sectionFields.length === 0
            ? []
            : scopeSectionIds.map(sectionId => ({
                sectionId,
                fields: sectionFields,
              })),
      },
      selection.model,
      selection.reasoningEffort,
      outline.candidate?.decision === 'pending'
        ? outline.candidate.candidateId
        : undefined,
    );
    if (nextCandidate) {
      setGuidance('');
      setScopeError('');
    }
  }

  async function handleApprove() {
    const approvedProject = await outline.approve();
    if (approvedProject) {
      navigate(projectVoiceVisualPath(approvedProject.id), true);
    }
  }

  function confirmDiscardInvalidDraft(action: string) {
    if (outline.validationErrors.length === 0) return true;
    return window.confirm(
      `Bản đang gõ chưa hợp lệ nên chưa thể lưu. ${action} sẽ bỏ các thay đổi cục bộ chưa hợp lệ và dùng dữ liệu đã lưu gần nhất. Bạn có muốn tiếp tục?`,
    );
  }

  async function handleApplyCandidate() {
    if (!confirmDiscardInvalidDraft('Áp dụng candidate')) return;
    await outline.applyCandidate();
  }

  async function handleRestoreVersion(version: OutlineVersionRecord) {
    if (!confirmDiscardInvalidDraft('Khôi phục phiên bản')) return;
    await outline.restoreVersion(version);
  }

  if (outline.loadState === 'loading') {
    return (
      <div className="page-state" role="status">
        <span className="spinner dark" />
        <strong>Đang chuẩn bị mạch giảng…</strong>
      </div>
    );
  }

  if (outline.loadState === 'error' || !outline.project) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Không thể mở bước mạch giảng</strong>
        <p>{outline.loadError}</p>
        <button type="button" onClick={() => navigate('/')}>
          Về project mới
        </button>
      </div>
    );
  }

  const {project, draft} = outline;
  const totalSeconds =
    draft?.sections.reduce(
      (total, section) => total + section.estimatedSeconds,
      0,
    ) ?? 0;
  const usage = project.outline?.generation.usage;
  const approved =
    project.outline?.status === 'approved' &&
    outline.saveState === 'saved' &&
    !outline.stale;

  return (
    <div className="outline-workspace">
      <header className="outline-heading">
        <div className="eyebrow">
          <span>Bước 02</span>
          <span className="eyebrow-line" />
          Mạch giảng
        </div>
        <AdaptiveHeading as="h1">
          Xây logic giải thích trước khi viết lời.
        </AdaptiveHeading>
        <p>
          AI đọc toàn bộ yêu cầu, tóm tắt cách hiểu và đề xuất thứ tự các ý.
          Bạn luôn có thể sửa trước khi chốt.
        </p>
      </header>

      <div className="outline-codex">
        <CodexConnectionCard connection={codexConnection} task="outline" />
      </div>

      {outline.saveState === 'conflict' && (
        <div className="outline-alert is-error" role="alert">
          <span>
            Project đã thay đổi ở nơi khác. Hãy tải lại trước khi tiếp tục.
          </span>
          <button type="button" onClick={outline.reload}>
            Tải lại
          </button>
        </div>
      )}

      {outline.stale && (
        <div className="outline-alert" role="status">
          Đầu vào đã thay đổi. Mạch giảng hiện tại cần được tạo lại trước khi
          chốt.
        </div>
      )}

      {outline.actionError && (
        <div className="outline-alert is-error" role="alert">
          {outline.actionError}
        </div>
      )}

      {draft && outline.validationErrors.length > 0 && (
        <div className="outline-alert draft-validation-alert" role="status">
          <strong>Cần bổ sung trước khi chốt:</strong>
          <ul>
            {outline.validationErrors.map(message => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {!draft ? (
        <div className="outline-grid">
          <section className="outline-primary-card">
            <div className="outline-card-heading">
              <span className="preview-kicker">
                <SparkIcon />
                Sẵn sàng tạo đề xuất
              </span>
              <span className="draft-status is-saved">
                <span />
                Đầu vào đã lưu
              </span>
            </div>

            <div className="outline-topic">
              <span className="preview-label">Chủ đề</span>
              <AdaptiveHeading as="h2">
                {project.topicInput.topic}
              </AdaptiveHeading>
              <p>
                {project.topicInput.learningGoal ||
                  'Chưa có mục tiêu học bổ sung.'}
              </p>
            </div>

            <div className="outline-empty-state">
              <span className="outline-empty-icon">
                <LayersIcon />
              </span>
              <div>
                <h3>Chưa có mạch giảng</h3>
                <p>
                  Codex sẽ tóm tắt yêu cầu và tạo một bản nháp để bạn review.
                  AI chỉ chạy khi bạn bấm nút bên dưới.
                </p>
              </div>
            </div>

            <footer className="outline-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => navigate(projectTopicPath(project.id))}
              >
                <ArrowLeftIcon />
                Chỉnh lại đầu vào
              </button>
              <button
                className="submit-button"
                type="button"
                disabled={
                  outline.generating ||
                  codexConnection.checking ||
                  !codexConnection.generationReady
                }
                onClick={() => void handleGenerate()}
              >
                {outline.generating ? (
                  <>
                    <span className="spinner" />
                    Đang tạo mạch giảng…
                  </>
                ) : (
                  <>
                    Phân tích & tạo mạch giảng
                    <SparkIcon />
                  </>
                )}
              </button>
            </footer>
          </section>

          <aside className="outline-side-card">
            <span className="preview-label">Thông tin đầu vào</span>
            <dl>
              <div>
                <dt>Người xem</dt>
                <dd>{audienceLabels[project.topicInput.audience]}</dd>
              </div>
              <div>
                <dt>Thời lượng</dt>
                <dd>
                  {durationLabel({
                    duration: project.topicInput.duration,
                    targetDurationMinutes:
                      project.topicInput.targetDurationMinutes ?? 10,
                  })}
                </dd>
              </div>
              <div>
                <dt>Định hướng riêng</dt>
                <dd>
                  {project.topicInput.videoDirection
                    ? 'Đã mô tả'
                    : 'Không có'}
                </dd>
              </div>
            </dl>
            <div className="outline-next-note">
              <LightbulbIcon />
              <p>
                PAD Studio dùng một lần gọi có cấu trúc và không tự động gọi
                lại để hạn chế token.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <>
          <div className="outline-editor-grid">
            <div className="outline-editor-main">
              <section className="outline-review-card">
                <header>
                  <div>
                    <span className="preview-kicker">
                      <SparkIcon />
                      AI hiểu yêu cầu như sau
                    </span>
                    <h2>Bản tóm tắt video</h2>
                  </div>
                  <span
                    className={`draft-status${approved ? ' is-saved' : ''}`}
                  >
                    <span />
                    {approved ? 'Đã chốt' : 'Bản nháp'}
                  </span>
                </header>

                <label className="outline-field">
                  <span>Tóm tắt yêu cầu</span>
                  <textarea
                    rows={4}
                    value={draft.brief.summary}
                    onChange={(event) =>
                      outline.updateBriefSummary(event.target.value)
                    }
                  />
                </label>

                <div className="outline-assumptions">
                  <div className="outline-subheading">
                    <span>Những điều AI đang giả định</span>
                    <button
                      type="button"
                      disabled={draft.brief.assumptions.length >= 6}
                      onClick={outline.addAssumption}
                    >
                      + Thêm
                    </button>
                  </div>
                  {draft.brief.assumptions.length === 0 ? (
                    <p className="outline-empty-copy">
                      Không có giả định bổ sung.
                    </p>
                  ) : (
                    <div className="assumption-list">
                      {draft.brief.assumptions.map((assumption, index) => (
                        <div className="assumption-row" key={index}>
                          <input
                            value={assumption}
                            aria-label={`Giả định ${index + 1}`}
                            onChange={(event) =>
                              outline.updateAssumption(
                                index,
                                event.target.value,
                              )
                            }
                          />
                          <button
                            type="button"
                            aria-label={`Xóa giả định ${index + 1}`}
                            onClick={() => outline.removeAssumption(index)}
                          >
                            Xóa
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <label className="outline-field">
                  <span>Thông điệp trung tâm</span>
                  <textarea
                    rows={3}
                    value={draft.centralMessage}
                    onChange={(event) =>
                      outline.updateCentralMessage(event.target.value)
                    }
                  />
                </label>
              </section>

              <section className="outline-sections">
                <div className="outline-section-heading">
                  <div>
                    <span className="preview-label">Mạch giảng</span>
                    <h2>Thứ tự các ý cần giải thích</h2>
                  </div>
                  <button
                    type="button"
                    disabled={
                      draft.sections.length >=
                      pipelineSafetyLimits.maximumSections
                    }
                    onClick={outline.addSection}
                  >
                    + Thêm ý
                  </button>
                </div>

                {draft.sections.map((section, index) => (
                  <article className="outline-section-card" key={section.id}>
                    <header>
                      <span className="outline-section-index">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <label className="outline-ai-scope-toggle">
                        <input
                          type="checkbox"
                          checked={scopeSectionIds.includes(section.id)}
                          onChange={() => toggleScopeSection(section.id)}
                        />
                        AI sửa
                      </label>
                      <input
                        className="outline-section-title"
                        value={section.title}
                        aria-label={`Tên ý ${index + 1}`}
                        onChange={(event) =>
                          outline.updateSection(
                            section.id,
                            'title',
                            event.target.value,
                          )
                        }
                      />
                      <div className="outline-section-controls">
                        <button
                          type="button"
                          disabled={index === 0}
                          aria-label={`Đưa ý ${index + 1} lên`}
                          onClick={() => outline.moveSection(section.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === draft.sections.length - 1}
                          aria-label={`Đưa ý ${index + 1} xuống`}
                          onClick={() => outline.moveSection(section.id, 1)}
                        >
                          ↓
                        </button>
                        <button
                          className="is-danger"
                          type="button"
                          disabled={
                            draft.sections.length <=
                            pipelineSafetyLimits.minimumSections
                          }
                          onClick={() => outline.removeSection(section.id)}
                        >
                          Xóa
                        </button>
                      </div>
                    </header>

                    <div className="outline-section-fields">
                      <label className="outline-field">
                        <span>Người xem cần hiểu gì?</span>
                        <textarea
                          rows={2}
                          value={section.goal}
                          onChange={(event) =>
                            outline.updateSection(
                              section.id,
                              'goal',
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="outline-field">
                        <span>Nội dung cần giải thích</span>
                        <textarea
                          rows={4}
                          value={section.content}
                          onChange={(event) =>
                            outline.updateSection(
                              section.id,
                              'content',
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="outline-time-field">
                        <span>
                          Mục tiêu narration ·{' '}
                          {targetNarrationTokenCount(
                            section.estimatedSeconds,
                          )}{' '}
                          đơn vị
                        </span>
                        <span>
                          <input
                            type="number"
                            min={
                              pipelineSafetyLimits.minimumSectionDurationSeconds
                            }
                            max={
                              pipelineSafetyLimits.maximumSectionDurationSeconds
                            }
                            value={section.estimatedSeconds}
                            onChange={(event) =>
                              outline.updateSection(
                                section.id,
                                'estimatedSeconds',
                                Number(event.target.value),
                              )
                            }
                          />
                          giây
                        </span>
                      </label>
                    </div>
                  </article>
                ))}
              </section>

              <section className="outline-ai-revision">
                <div className="outline-ai-revision-heading">
                  <span className="preview-kicker">
                    <SparkIcon />
                    {outline.candidate?.decision === 'pending'
                      ? 'Chỉnh tiếp đề xuất'
                      : 'Tạo đề xuất AI'}
                  </span>
                  <h2>Bạn muốn thay đổi điều gì?</h2>
                  <p>
                    AI đọc toàn bài nhưng chỉ được ghi vào phạm vi bạn chọn.
                  </p>
                </div>
                <div className="outline-ai-scope">
                  <div className="ai-scope-presets" aria-label="Chọn nhanh phạm vi">
                    <button type="button" onClick={selectEntireOutline}>
                      Chọn toàn bộ bài
                    </button>
                    <button type="button" onClick={selectAllOutlineSections}>
                      Chọn tất cả các ý
                    </button>
                    <button type="button" onClick={clearOutlineScope}>
                      Bỏ chọn
                    </button>
                  </div>
                  <div className="outline-ai-scope-group">
                    <strong>Phần tổng quan được phép sửa</strong>
                    <div>
                      {([
                        ['brief.summary', 'Tóm tắt'],
                        ['brief.assumptions', 'Giả định'],
                        ['centralMessage', 'Thông điệp'],
                      ] as const).map(([field, label]) => (
                        <label key={field}>
                          <input
                            type="checkbox"
                            checked={globalFields.includes(field)}
                            onChange={() => toggleGlobalField(field)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="outline-ai-scope-group">
                    <strong>
                      {scopeSectionIds.length} ý đã chọn · trường được sửa
                    </strong>
                    <div>
                      {([
                        ['title', 'Tên ý'],
                        ['goal', 'Mục tiêu'],
                        ['content', 'Nội dung'],
                        ['estimatedSeconds', 'Thời lượng'],
                      ] as const).map(([field, label]) => (
                        <label key={field}>
                          <input
                            type="checkbox"
                            checked={sectionFields.includes(field)}
                            onChange={() => toggleSectionField(field)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <p>
                      Chọn “AI sửa” trên từng ý phía trên. ID, thứ tự và các ý
                      không chọn luôn được giữ nguyên.
                    </p>
                  </div>
                </div>
                <div className="outline-ai-revision-request">
                  <textarea
                    rows={3}
                    value={guidance}
                    placeholder={
                      outline.candidate?.decision === 'pending'
                        ? 'Ví dụ: Giữ toàn bộ đề xuất này, chỉ làm câu kết tự nhiên hơn.'
                        : 'Ví dụ: Rút gọn ví dụ nhưng giữ nguyên luận điểm và làm câu chuyển sang ý tiếp theo tự nhiên hơn.'
                    }
                    onChange={(event) => {
                      setGuidance(event.target.value);
                      setScopeError('');
                    }}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      outline.candidateGenerating ||
                      outline.saveState === 'conflict' ||
                      codexConnection.checking ||
                      !codexConnection.generationReady
                    }
                    onClick={() => void handleGenerate()}
                  >
                    {outline.candidateGenerating ? (
                      <>
                        <span className="spinner dark" />
                        AI đang tạo và kiểm tra…
                      </>
                    ) : (
                      <>
                        <SparkIcon />
                        {outline.candidate?.decision === 'pending'
                          ? 'Chỉnh tiếp trên đề xuất'
                          : 'Tạo đề xuất để so sánh'}
                      </>
                    )}
                  </button>
                </div>
                {scopeError && (
                  <p className="outline-scope-error" role="alert">
                    {scopeError}
                  </p>
                )}
              </section>

              {outline.candidate && (
                <section className="outline-candidate-review">
                  <header>
                    <div>
                      <span className="preview-kicker">
                        <LayersIcon />
                        {outline.candidate.decision === 'accepted'
                          ? 'Candidate đã áp dụng'
                          : outline.candidate.decision === 'rejected'
                            ? 'Candidate đã giữ lại'
                            : 'Candidate chưa áp dụng'}
                      </span>
                      <h2>{outline.candidate.patch.editSummary}</h2>
                    </div>
                    <span className={`candidate-status is-${outline.candidate.status}`}>
                      {outline.candidate.status === 'ready'
                        ? 'Mạch lạc'
                        : outline.candidate.status === 'coherence_warning'
                          ? 'Có lưu ý'
                          : outline.candidate.status === 'coherence_blocked'
                            ? 'Cần chỉnh tiếp'
                            : 'Cần mở rộng phạm vi'}
                    </span>
                  </header>

                  <div className="outline-coherence-summary">
                    <strong>Kiểm tra sau khi ghép với toàn bài</strong>
                    <p>{outline.candidate.coherence.summary}</p>
                    {outline.candidate.coherence.issues.length > 0 && (
                      <ul>
                        {outline.candidate.coherence.issues.map((issue, index) => (
                          <li key={`${issue.category}-${index}`}>
                            <strong>
                              {issue.severity === 'error' ? 'Cần xử lý' : 'Lưu ý'}:
                            </strong>{' '}
                            {issue.message}
                            <small>{issue.suggestedFix}</small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {outline.candidate.decision === 'pending' &&
                    outline.candidate.status === 'scope_expansion_required' && (
                      <div className="candidate-scope-expansion">
                        <div>
                          <strong>Reviewer đề nghị mở rộng đúng phần liên quan</strong>
                          <small>
                            Candidate hiện tại vẫn làm nền; các section không nằm trong
                            phạm vi mới tiếp tục được bảo vệ.
                          </small>
                        </div>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={prepareScopeExpansion}
                        >
                          Mở phạm vi theo gợi ý
                        </button>
                      </div>
                    )}

                  <OutlineDiffList
                    changes={outlineDiff(draft, outline.candidate.content)}
                  />

                  <footer>
                    {outline.candidate.decision === 'pending' ? (
                      <>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={outline.historyBusy}
                          onClick={() => void outline.rejectCandidate()}
                        >
                          Giữ bản đang dùng
                        </button>
                        <button
                          className="submit-button"
                          type="button"
                          disabled={
                            outline.candidateApplying ||
                            outline.candidate.status ===
                              'scope_expansion_required' ||
                            outline.candidate.status === 'coherence_blocked'
                          }
                          onClick={() => void handleApplyCandidate()}
                        >
                          {outline.candidateApplying ? (
                            <>
                              <span className="spinner" />
                              Đang áp dụng…
                            </>
                          ) : (
                            <>
                              Áp dụng thành phiên bản mới
                              <CheckIcon />
                            </>
                          )}
                        </button>
                      </>
                    ) : (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={outline.dismissCandidate}
                      >
                        Đóng so sánh
                      </button>
                    )}
                  </footer>
                </section>
              )}
            </div>

            <aside className="outline-editor-side">
              <section className="outline-side-card">
                <span className="preview-label">Tổng quan</span>
                <dl>
                  <div>
                    <dt>Số ý</dt>
                    <dd>{draft.sections.length}</dd>
                  </div>
                  <div>
                    <dt>Thời lượng</dt>
                    <dd>
                      {Math.floor(totalSeconds / 60)}:
                      {String(totalSeconds % 60).padStart(2, '0')}
                    </dd>
                  </div>
                  <div>
                    <dt>Ngân sách lời</dt>
                    <dd>
                      {targetNarrationTokenCount(totalSeconds)} đơn vị
                    </dd>
                  </div>
                  <div>
                    <dt>Trạng thái</dt>
                    <dd>{approved ? 'Đã chốt' : 'Đang review'}</dd>
                  </div>
                  <div>
                    <dt>Tự lưu</dt>
                    <dd>
                      {outline.saveState === 'saving'
                        ? 'Đang lưu…'
                        : outline.saveState === 'error'
                          ? 'Lưu lỗi'
                          : outline.saveState === 'idle'
                            ? 'Chưa hợp lệ'
                            : 'Đã lưu'}
                    </dd>
                  </div>
                </dl>

                {usage && (
                  <div className="outline-usage">
                    <span>Token lần tạo gần nhất</span>
                    <strong>{usage.totalTokens.toLocaleString('vi-VN')}</strong>
                    <small>
                      Input {usage.inputTokens.toLocaleString('vi-VN')} · Output{' '}
                      {usage.outputTokens.toLocaleString('vi-VN')}
                    </small>
                    <small>
                      {project.outline?.generation.model}
                      {project.outline?.generation.reasoningEffort
                        ? ` · reasoning ${project.outline.generation.reasoningEffort}`
                        : ''}
                    </small>
                  </div>
                )}

                <div className="outline-next-note">
                  <LightbulbIcon />
                  <p>
                    Chốt chỉ xác nhận mạch giảng. PAD Studio chưa tạo voice hoặc
                    hình ảnh ở bước này.
                  </p>
                </div>
              </section>

              <section className="outline-history-card">
                <header>
                  <div>
                    <span className="preview-label">Lịch sử phiên bản</span>
                    <h2>Quay lại bất cứ lúc nào</h2>
                  </div>
                  <div className="outline-checkpoint-action">
                    <input
                      value={checkpointLabel}
                      placeholder="Tên phiên bản (tùy chọn)"
                      onChange={event => setCheckpointLabel(event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={outline.historyBusy}
                      onClick={() => {
                        void outline
                          .saveCheckpoint(checkpointLabel)
                          .then(version => {
                            if (version) setCheckpointLabel('');
                          });
                      }}
                    >
                      {outline.historyBusy ? 'Đang lưu…' : '+ Lưu phiên bản'}
                    </button>
                  </div>
                </header>

                {outline.historyError && (
                  <p className="outline-history-error">{outline.historyError}</p>
                )}

                <div className="outline-version-list">
                  {outline.history?.versions.slice(0, 8).map(version => {
                    const isCurrent =
                      JSON.stringify(outlineContentFromArtifact(version.artifact)) ===
                      JSON.stringify(draft);
                    return (
                      <article
                        key={version.versionId}
                        className={isCurrent ? 'is-current' : ''}
                      >
                        <div>
                          <strong>{version.label ?? outlineVersionOriginLabels[version.origin]}</strong>
                          <span>
                            {outlineVersionOriginLabels[version.origin]} ·{' '}
                            {new Date(version.createdAt).toLocaleString('vi-VN')}
                          </span>
                        </div>
                        <div>
                          {isCurrent ? (
                            <span className="outline-version-current">Đang dùng</span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setSelectedVersion(version)}
                              >
                                So sánh
                              </button>
                              <button
                                type="button"
                                disabled={outline.historyBusy}
                                onClick={() => void handleRestoreVersion(version)}
                              >
                                Khôi phục
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>

                {(outline.history?.candidates.length ?? 0) > 0 && (
                  <div className="outline-candidate-history">
                    <strong>Đề xuất AI</strong>
                    {outline.history?.candidates.slice(0, 8).map(item => {
                      const contextCurrent =
                        item.rootBaseContextHash ===
                        outline.history?.currentContextHash;
                      return (
                        <article key={item.candidateId}>
                          <div>
                            <strong>{item.patch.editSummary}</strong>
                            <span>
                              {item.decision === 'accepted'
                                ? 'Đã áp dụng'
                                : item.decision === 'rejected'
                                  ? 'Đã giữ bản cũ'
                                  : contextCurrent
                                    ? 'Đang chờ review'
                                    : 'Context cũ'}{' '}
                              · {new Date(item.createdAt).toLocaleString('vi-VN')}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => outline.selectCandidate(item)}
                          >
                            So sánh
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}

                {selectedVersion && (
                  <div className="outline-version-compare">
                    <header>
                      <strong>
                        So với {selectedVersion.label ?? 'phiên bản đã chọn'}
                      </strong>
                      <button
                        type="button"
                        onClick={() => setSelectedVersion(null)}
                      >
                        Đóng
                      </button>
                    </header>
                    <OutlineDiffList
                      changes={outlineDiff(
                        outlineContentFromArtifact(selectedVersion.artifact),
                        draft,
                      )}
                      beforeLabel="Phiên bản đã chọn"
                      afterLabel="Đang dùng"
                    />
                  </div>
                )}
              </section>
            </aside>
          </div>

          <footer className="outline-final-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => navigate(projectTopicPath(project.id))}
            >
              <ArrowLeftIcon />
              Chỉnh lại đầu vào
            </button>
            <div>
              <span>
                {approved
                  ? 'Mạch giảng đã sẵn sàng cho bước tiếp theo'
                  : outline.validationErrors[0] ??
                    'Review kỹ trước khi chuyển sang voice–visual'}
              </span>
              <button
                className="submit-button"
                type="button"
                disabled={
                  outline.approving ||
                  outline.generating ||
                  (!approved && outline.stale) ||
                  outline.saveState === 'conflict'
                }
                onClick={() =>
                  approved
                    ? navigate(projectVoiceVisualPath(project.id))
                    : void handleApprove()
                }
              >
                {outline.approving ? (
                  <>
                    <span className="spinner" />
                    Đang chốt…
                  </>
                ) : approved ? (
                  <>
                    Tiếp tục voice–visual
                    <ArrowRightIcon />
                  </>
                ) : (
                  <>
                    Chốt mạch giảng
                    <CheckIcon />
                  </>
                )}
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

export default function App() {
  const route = useAppRoute();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newProjectKey, setNewProjectKey] = useState(0);
  const [projectReloadKey, setProjectReloadKey] = useState(0);
  const activeStep =
    route.name === 'project-render'
      ? 7
      : route.name === 'project-layout'
      ? 6
      : route.name === 'project-sync'
      ? 5
      : route.name === 'project-voice'
      ? 4
      : route.name === 'project-motion-canvas'
      ? 3
      : route.name === 'project-voice-visual'
      ? 2
      : route.name === 'project-outline'
        ? 1
        : 0;
  const activeProjectId =
    route.name === 'new-topic' ? undefined : route.projectId;
  const routeIdentity =
    route.name === 'new-topic'
      ? `new-topic-${newProjectKey}`
      : `${route.name}-${route.projectId}-${projectReloadKey}`;
  const navigationRef = useRef({
    activeStep,
    routeIdentity,
    transition: 'fade' as 'backward' | 'fade' | 'forward',
  });
  if (navigationRef.current.routeIdentity !== routeIdentity) {
    navigationRef.current = {
      activeStep,
      routeIdentity,
      transition:
        activeStep > navigationRef.current.activeStep
          ? 'forward'
          : activeStep < navigationRef.current.activeStep
            ? 'backward'
            : 'fade',
    };
  }
  const pageTransition = navigationRef.current.transition;

  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const openLibrary = useCallback(() => setLibraryOpen(true), []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [routeIdentity]);

  useEffect(() => {
    if (!sidebarOpen) return;

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setSidebarOpen(false);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  function handleCreateProject() {
    clearLocalTopicDraft();
    setNewProjectKey((current) => current + 1);
    closeLibrary();
    navigate('/');
  }

  function handleOpenProject(project: TopicProject) {
    setProjectReloadKey((current) => current + 1);
    closeLibrary();
    navigate(projectStepPath(project.id, project.currentStep));
  }

  function handleEditProject(project: TopicProject) {
    setProjectReloadKey((current) => current + 1);
    closeLibrary();
    navigate(projectTopicPath(project.id));
  }

  function handleDeleted(projectId: string) {
    if (activeProjectId === projectId) {
      navigateDiscardingPendingChanges('/', true);
    }
  }

  return (
    <div className="app-shell">
      <PipelineSidebar
        activeStep={activeStep}
        hasProject={Boolean(activeProjectId)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenProjects={openLibrary}
        onSelectStep={(step) => {
          if (!activeProjectId) return;
          navigate(projectStepPath(activeProjectId, step));
        }}
      />
      <button
        className={`sidebar-backdrop${sidebarOpen ? ' is-open' : ''}`}
        type="button"
        aria-label="Đóng quy trình sản xuất"
        tabIndex={sidebarOpen ? 0 : -1}
        onClick={() => setSidebarOpen(false)}
      />
      <MobileHeader
        activeStep={activeStep}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        onOpenProjects={openLibrary}
      />

      <main className="workspace">
        <div
          className={`workspace-page is-${pageTransition}`}
          key={routeIdentity}
        >
          <Suspense
            fallback={
              <div className="page-state" role="status">
                <span className="spinner dark" />
                <strong>Đang mở công cụ của bước này…</strong>
              </div>
            }
          >
            {route.name === 'new-topic' && (
              <TopicPage
                autosavePaused={libraryOpen}
                onContinue={(project) =>
                  navigate(projectOutlinePath(project.id), true)
                }
              />
            )}
            {route.name === 'project-topic' && (
              <TopicPage
                projectId={route.projectId}
                autosavePaused={libraryOpen}
                onContinue={(project) =>
                  navigate(projectOutlinePath(project.id), true)
                }
              />
            )}
            {route.name === 'project-outline' && (
              <OutlinePage projectId={route.projectId} />
            )}
            {route.name === 'project-voice-visual' && (
              <VoiceVisualPage projectId={route.projectId} />
            )}
            {route.name === 'project-motion-canvas' && (
              <MotionCanvasPage projectId={route.projectId} />
            )}
            {route.name === 'project-voice' && (
              <VoicePage projectId={route.projectId} />
            )}
            {route.name === 'project-sync' && (
              <AnimationSyncPage projectId={route.projectId} />
            )}
            {route.name === 'project-layout' && (
              <LayoutEditorPage projectId={route.projectId} />
            )}
            {route.name === 'project-render' && (
              <FinalRenderPage projectId={route.projectId} />
            )}
          </Suspense>
        </div>
      </main>

      <ProjectLibrary
        open={libraryOpen}
        activeProjectId={activeProjectId}
        onClose={closeLibrary}
        onCreate={handleCreateProject}
        onOpenProject={handleOpenProject}
        onEditProject={handleEditProject}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
