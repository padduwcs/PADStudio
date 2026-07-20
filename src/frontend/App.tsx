import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {ProjectStep, TopicProject} from '../shared/topic.ts';
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
import {AnimationSyncPage} from './AnimationSyncPage.tsx';
import {LayoutEditorPage} from './LayoutEditorPage.tsx';
import {FinalRenderPage} from './FinalRenderPage.tsx';
import {MotionCanvasPage} from './MotionCanvasPage.tsx';
import {VoicePage} from './VoicePage.tsx';
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
import {VoiceVisualPage} from './VoiceVisualPage.tsx';

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
                  <span>{form.topic.length} / 180</span>
                </div>
                <div
                  className={`textarea-shell${fieldErrors.topic ? ' has-error' : ''}`}
                >
                  <textarea
                    id="topic"
                    name="topic"
                    value={form.topic}
                    maxLength={180}
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
                  <span>{form.learningGoal.length} / 320</span>
                </div>
                <textarea
                  className={fieldErrors.learningGoal ? 'has-error' : ''}
                  id="learning-goal"
                  name="learningGoal"
                  value={form.learningGoal}
                  maxLength={320}
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
                  <span>{form.videoDirection.length} / 1200</span>
                </div>
                <textarea
                  className={fieldErrors.videoDirection ? 'has-error' : ''}
                  id="video-direction"
                  name="videoDirection"
                  value={form.videoDirection}
                  maxLength={1200}
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
                    : 'Chưa gọi AI ở bước này'}
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

function OutlinePage({projectId}: {projectId: string}) {
  const outline = useOutlineDraft(projectId);
  const codexConnection = useCodexConnection();
  const [guidance, setGuidance] = useState('');

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

    const generatedProject = await outline.generate(
      guidance,
      selection.model,
      selection.reasoningEffort,
    );
    if (generatedProject) setGuidance('');
  }

  async function handleApprove() {
    const approvedProject = await outline.approve();
    if (approvedProject) {
      navigate(projectVoiceVisualPath(approvedProject.id), true);
    }
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
                    maxLength={700}
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
                            maxLength={220}
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
                    maxLength={400}
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
                      <input
                        className="outline-section-title"
                        value={section.title}
                        maxLength={120}
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
                          maxLength={280}
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
                          maxLength={4000}
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
                <div>
                  <span className="preview-kicker">
                    <SparkIcon />
                    Nhờ AI chỉnh lại
                  </span>
                  <h2>Bạn muốn thay đổi điều gì?</h2>
                  <p>
                    Chỉ khi có góp ý, mạch hiện tại mới được gửi lại cho AI.
                  </p>
                </div>
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={guidance}
                  placeholder="Ví dụ: Mở đầu hấp dẫn hơn, rút ngắn phần ví dụ và nhấn mạnh điều kiện dữ liệu phải được sắp xếp."
                  onChange={(event) => setGuidance(event.target.value)}
                />
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    outline.generating ||
                    outline.saveState === 'conflict' ||
                    codexConnection.checking ||
                    !codexConnection.generationReady
                  }
                  onClick={() => void handleGenerate()}
                >
                  {outline.generating ? (
                    <>
                      <span className="spinner dark" />
                      AI đang chỉnh…
                    </>
                  ) : (
                    <>
                      <SparkIcon />
                      {guidance.trim()
                        ? 'Chỉnh theo góp ý'
                        : 'Tạo lại toàn bộ'}
                    </>
                  )}
                </button>
              </section>
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
