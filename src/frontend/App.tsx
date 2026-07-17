import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';
import type {TopicProject} from '../shared/topic.ts';
import {AdaptiveHeading} from './AdaptiveText.tsx';
import {ApiRequestError, getProject} from './api.ts';
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
  SparkIcon,
  UserIcon,
} from './icons.tsx';
import {ProjectLibrary} from './ProjectLibrary.tsx';
import {
  navigate,
  projectOutlinePath,
  projectStepPath,
  projectTopicPath,
  useAppRoute,
} from './router.ts';
import {
  clearLocalTopicDraft,
  type TopicFormState,
  useTopicDraft,
} from './useTopicDraft.ts';
import {useCodexConnection} from './useCodexConnection.ts';

const pipelineSteps = [
  'Nhập chủ đề',
  'Mạch giảng',
  'Voice — visual',
  'Sinh scene & voice',
  'Đồng bộ',
  'Layout Editor',
  'Render cuối',
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
];

const audienceLabels: Record<TopicFormState['audience'], string> = {
  beginner: 'Người mới',
  familiar: 'Đã biết cơ bản',
};

const durationLabels: Record<TopicFormState['duration'], string> = {
  concise: '1–2 phút',
  standard: '3–5 phút',
  deep: '6–8 phút',
};

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
  onOpenProjects,
}: {
  activeStep: number;
  onOpenProjects: () => void;
}) {
  return (
    <aside className="pipeline-sidebar">
      <Brand />
      <button
        className="projects-nav-button"
        type="button"
        onClick={onOpenProjects}
      >
        <FolderIcon />
        Project của bạn
      </button>

      <div className="sidebar-heading">
        <span>Quy trình sản xuất</span>
        <strong>{String(activeStep + 1).padStart(2, '0')} / 07</strong>
      </div>

      <nav aria-label="Các bước sản xuất video">
        <ol className="pipeline-list">
          {pipelineSteps.map((step, index) => (
            <li
              className={index === activeStep ? 'is-active' : ''}
              aria-current={index === activeStep ? 'step' : undefined}
              key={step}
            >
              <span className="step-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="step-name">{step}</span>
            </li>
          ))}
        </ol>
      </nav>

      <div className="sidebar-note">
        <LightbulbIcon />
        <p>
          Mỗi bước quan trọng đều chờ bạn review trước khi tiếp tục.
        </p>
      </div>
    </aside>
  );
}

function MobileHeader({
  activeStep,
  onOpenProjects,
}: {
  activeStep: number;
  onOpenProjects: () => void;
}) {
  return (
    <header className="mobile-header">
      <Brand />
      <div className="mobile-progress">
        <button
          className="mobile-projects-button"
          type="button"
          aria-label="Mở danh sách project"
          onClick={onOpenProjects}
        >
          <FolderIcon />
        </button>
        <span>Bước {activeStep + 1} / 7</span>
        <span className="mobile-progress-track">
          <span style={{width: `${((activeStep + 1) / 7) * 100}%`}} />
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
          <dd>{durationLabels[form.duration]}</dd>
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

    await submit();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!codexConnection.connected) return;
    await continueWithVerifiedCodex();
  }

  function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (
        submitState !== 'submitting' &&
        saveState !== 'conflict' &&
        codexConnection.connected
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
                    !codexConnection.connected
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
  const [project, setProject] = useState<TopicProject | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setState('loading');
    setError('');

    void getProject(projectId)
      .then((loadedProject) => {
        if (!active) return;
        setProject(loadedProject);
        setState('ready');
      })
      .catch((requestError) => {
        if (!active) return;
        setError(
          requestError instanceof ApiRequestError
            ? requestError.message
            : 'Không thể mở project.',
        );
        setState('error');
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  if (state === 'loading') {
    return (
      <div className="page-state" role="status">
        <span className="spinner dark" />
        <strong>Đang chuẩn bị mạch giảng…</strong>
      </div>
    );
  }

  if (state === 'error' || !project) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Không thể mở bước mạch giảng</strong>
        <p>{error}</p>
        <button type="button" onClick={() => navigate('/')}>
          Về project mới
        </button>
      </div>
    );
  }

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
          Đầu vào đã được lưu. Đây sẽ là nơi AI đề xuất thứ tự các ý và mô hình
          tư duy để bạn review trước khi sang voice–visual.
        </p>
      </header>

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
              <h3>Chưa có mạch giảng được sinh</h3>
              <p>
                PAD Studio chưa được cấu hình AI provider và model. Mình giữ
                trạng thái này minh bạch thay vì tạo một kết quả giả.
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
            <button className="submit-button" type="button" disabled>
              Tạo mạch giảng
              <SparkIcon />
            </button>
          </footer>
        </section>

        <aside className="outline-side-card">
          <span className="preview-label">Thông số đã chốt</span>
          <dl>
            <div>
              <dt>Người xem</dt>
              <dd>{audienceLabels[project.topicInput.audience]}</dd>
            </div>
            <div>
              <dt>Thời lượng</dt>
              <dd>{durationLabels[project.topicInput.duration]}</dd>
            </div>
            <div>
              <dt>Trạng thái</dt>
              <dd>Project draft</dd>
            </div>
          </dl>
          <div className="outline-next-note">
            <LightbulbIcon />
            <p>
              Bước sinh mạch giảng cần một quyết định riêng về AI provider,
              model, prompt contract và giới hạn chi phí.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function App() {
  const route = useAppRoute();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [newProjectKey, setNewProjectKey] = useState(0);
  const [projectReloadKey, setProjectReloadKey] = useState(0);
  const activeStep = route.name === 'project-outline' ? 1 : 0;
  const activeProjectId =
    route.name === 'new-topic' ? undefined : route.projectId;

  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const openLibrary = useCallback(() => setLibraryOpen(true), []);

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
    if (activeProjectId === projectId) navigate('/');
  }

  return (
    <div className="app-shell">
      <PipelineSidebar
        activeStep={activeStep}
        onOpenProjects={openLibrary}
      />
      <MobileHeader activeStep={activeStep} onOpenProjects={openLibrary} />

      <main className="workspace">
        {route.name === 'new-topic' && (
          <TopicPage
            key={`new-topic-${newProjectKey}`}
            autosavePaused={libraryOpen}
            onContinue={(project) =>
              navigate(projectOutlinePath(project.id), true)
            }
          />
        )}
        {route.name === 'project-topic' && (
          <TopicPage
            key={`project-topic-${route.projectId}-${projectReloadKey}`}
            projectId={route.projectId}
            autosavePaused={libraryOpen}
            onContinue={(project) =>
              navigate(projectOutlinePath(project.id), true)
            }
          />
        )}
        {route.name === 'project-outline' && (
          <OutlinePage
            key={`project-outline-${route.projectId}-${projectReloadKey}`}
            projectId={route.projectId}
          />
        )}
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
