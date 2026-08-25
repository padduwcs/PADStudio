import {type FormEvent, useEffect, useRef, useState} from 'react';
import {
  TopicInputSchema,
  defaultVideoBackground,
  type TopicInput,
  type TopicProject,
} from '../shared/topic.ts';
import {
  defaultVideoFrame,
  type VideoFrame,
} from '../shared/videoFormat.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {estimateNarrationSeconds} from '../shared/narrationTiming.ts';
import {textEncodingIssue} from '../shared/vietnameseSpeech.ts';
import {
  ApiRequestError,
  createTopicProject,
  generateNarrationDraft,
  getProject,
  saveProjectNarration,
  updateTopicProject,
} from './api.ts';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {createNewTopicCreationId} from './newTopicSession.ts';
import {
  navigate,
  projectPronunciationPath,
  projectContentPath,
  registerNavigationGuard,
} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {useWorkflowOperationGuard} from './useWorkflowOperationGuard.ts';
import {
  notifyTaskCompleted,
  notifyTaskFailed,
  prepareTaskCompletionNotifications,
} from './taskCompletionNotifications.ts';
import {
  clearPageDraft,
  readPageDraft,
  savePageDraft,
} from './pageDraft.ts';

type ContentForm = {
  topic: string;
  narrationSourceText: string;
  backgroundColor: string;
  frame: VideoFrame;
  duration: TopicInput['duration'];
  targetDurationMinutes: number;
};

type ContentPageDraft = {
  form: ContentForm;
  narrationGuidance: string;
};

const framePresets: Array<{label: string; frame: VideoFrame}> = [
  {label: 'Dọc 9:16', frame: defaultVideoFrame},
  {
    label: 'Ngang 16:9',
    frame: {aspectRatio: 'landscape', width: 1920, height: 1080, fps: 30},
  },
  {
    label: 'Vuông 1:1',
    frame: {aspectRatio: 'square', width: 1080, height: 1080, fps: 30},
  },
];

const durationOptions: Array<{
  value: TopicInput['duration'];
  label: string;
}> = [
  {value: 'concise', label: 'Ngắn gọn · 1–2 phút'},
  {value: 'standard', label: 'Tiêu chuẩn · 3–5 phút'},
  {value: 'deep', label: 'Chuyên sâu · 6–8 phút'},
  {value: 'custom', label: 'Tùy chỉnh'},
];

function initialForm(project?: TopicProject): ContentForm {
  return {
    topic: project?.topicInput.topic ?? '',
    narrationSourceText: project?.narration?.sourceText ?? '',
    backgroundColor: project?.topicInput.background.color ?? defaultVideoBackground.color,
    frame: project?.topicInput.videoFrame ?? defaultVideoFrame,
    duration: project?.topicInput.duration ?? 'standard',
    targetDurationMinutes: project?.topicInput.targetDurationMinutes ?? 10,
  };
}

function isContentPageDraft(value: ContentPageDraft | null): value is ContentPageDraft {
  return Boolean(
    value &&
      typeof value.narrationGuidance === 'string' &&
      value.form &&
      typeof value.form.topic === 'string' &&
      typeof value.form.narrationSourceText === 'string' &&
      typeof value.form.backgroundColor === 'string' &&
      typeof value.form.duration === 'string' &&
      typeof value.form.targetDurationMinutes === 'number' &&
      value.form.frame &&
      typeof value.form.frame.width === 'number' &&
      typeof value.form.frame.height === 'number' &&
      typeof value.form.frame.fps === 'number',
  );
}

function buildTopicInput(form: ContentForm) {
  return TopicInputSchema.safeParse({
    topic: form.topic,
    background: {
      mode: 'custom',
      color: form.backgroundColor,
    },
    videoFrame: form.frame,
    duration: form.duration,
    targetDurationMinutes:
      form.duration === 'custom' ? form.targetDurationMinutes : undefined,
  });
}

function sameFrame(left: VideoFrame, right: VideoFrame) {
  return left.aspectRatio === right.aspectRatio &&
    left.width === right.width &&
    left.height === right.height &&
    left.fps === right.fps;
}

function isPresetFrame(frame: VideoFrame) {
  return framePresets.some(preset => sameFrame(frame, preset.frame));
}

function formatEstimatedDuration(seconds: number) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes === 0) return `${remainingSeconds} giây`;
  if (remainingSeconds === 0) return `${minutes} phút`;
  return `${minutes} phút ${remainingSeconds} giây`;
}

function codexAssistStatus(connection: ReturnType<typeof useCodexConnection>) {
  if (connection.checking) return 'Đang kiểm tra';
  if (connection.status?.state === 'connected') return 'Codex sẵn sàng';
  if (connection.status?.state === 'disconnected') return 'Chưa kết nối';
  return 'Cần kiểm tra Codex';
}

export function ContentPage({projectId}: {projectId?: string}) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [form, setForm] = useState<ContentForm>(() => initialForm());
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>(
    projectId ? 'loading' : 'ready',
  );
  const [error, setError] = useState('');
  const [narrationGuidance, setNarrationGuidance] = useState('');
  const [narrationGenerating, setNarrationGenerating] = useState(false);
  const [narrationGenerationError, setNarrationGenerationError] = useState('');
  const [openingPronunciation, setOpeningPronunciation] = useState(false);
  const creationId = useRef(createNewTopicCreationId());
  const skipNextNavigationGuardRef = useRef(false);
  const codex = useCodexConnection();
  const aiConnectionLabel = codexAssistStatus(codex);

  useEffect(() => {
    if (!projectId) {
      const storedDraft = readPageDraft<ContentPageDraft>('content');
      setProject(null);
      setForm(isContentPageDraft(storedDraft) ? storedDraft.form : initialForm());
      setNarrationGuidance(
        isContentPageDraft(storedDraft) ? storedDraft.narrationGuidance : '',
      );
      setState('ready');
      return;
    }
    let active = true;
    setState('loading');
    void getProject(projectId).then((loaded) => {
      if (!active) return;
      const storedDraft = readPageDraft<ContentPageDraft>('content', projectId);
      setProject(loaded);
      setForm(isContentPageDraft(storedDraft) ? storedDraft.form : initialForm(loaded));
      setNarrationGuidance(
        isContentPageDraft(storedDraft) ? storedDraft.narrationGuidance : '',
      );
      setState('ready');
    }).catch((reason) => {
      if (!active) return;
      setState('error');
      setError(reason instanceof ApiRequestError ? reason.message : 'Không thể mở project.');
    });
    return () => { active = false; };
  }, [projectId]);

  const savedForm = initialForm(project ?? undefined);
  const hasUnsavedChanges =
    state !== 'loading' &&
    (JSON.stringify(form) !== JSON.stringify(savedForm) ||
      narrationGuidance.trim().length > 0);
  const contentOperationBusy =
    state === 'saving' || narrationGenerating || openingPronunciation;
  const allowNextWorkflowNavigation = useWorkflowOperationGuard(
    contentOperationBusy,
    'PAD Studio đang lưu hoặc tạo nội dung. Hãy chờ tác vụ hoàn tất trước khi chuyển bước hay đổi project.',
  );

  useEffect(() => {
    if (state === 'loading') return;
    if (!hasUnsavedChanges) {
      clearPageDraft('content', projectId);
      return;
    }
    savePageDraft(
      'content',
      {form, narrationGuidance} satisfies ContentPageDraft,
      projectId,
    );
  }, [form, hasUnsavedChanges, narrationGuidance, projectId, state]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    return registerNavigationGuard(() => {
      if (contentOperationBusy) return true;
      if (skipNextNavigationGuardRef.current) {
        skipNextNavigationGuardRef.current = false;
        return true;
      }
      return window.confirm(
        'Nội dung đang nhập chưa được lưu vào project. Bản nháp đã được giữ trong tab này. Bạn có muốn rời trang?',
      );
    });
  }, [contentOperationBusy, hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const preventUnsavedUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventUnsavedUnload);
    return () => window.removeEventListener('beforeunload', preventUnsavedUnload);
  }, [hasUnsavedChanges]);

  function update<K extends keyof ContentForm>(key: K, value: ContentForm[K]) {
    setForm(current => ({...current, [key]: value}));
    setError('');
    if (state === 'saved') setState('ready');
  }

  async function openPronunciation() {
    if (!project || contentOperationBusy) return;
    if (hasUnsavedChanges) {
      setError('Hãy lưu nội dung đang chỉnh sửa trước khi chuyển sang bước cách đọc.');
      return;
    }
    setOpeningPronunciation(true);
    setError('');
    try {
      let current = project;
      if (!current.narration?.review) {
        current = await saveProjectNarration(
          current.id,
          {
            sourceText: current.narration!.sourceText,
            projectRules: current.narration!.projectRules,
          },
          current.revision,
        );
        setProject(current);
      }
      allowNextWorkflowNavigation();
      navigate(projectPronunciationPath(current.id));
    } catch (reason) {
      setError(reason instanceof ApiRequestError
        ? reason.message
        : 'Không thể chuẩn bị bản nền cho bước cách đọc.');
    } finally {
      setOpeningPronunciation(false);
    }
  }

  async function createNarrationDraft() {
    if (contentOperationBusy) return;
    const topicInput = buildTopicInput(form);
    if (!topicInput.success) {
      setNarrationGenerationError(
        topicInput.error.issues[0]?.message ?? 'Thông tin đầu vào chưa hợp lệ.',
      );
      return;
    }
    if (
      form.narrationSourceText.trim() &&
      !window.confirm('Thay lời thoại hiện tại bằng bản nháp mới? Bạn có thể hủy để giữ nguyên.')
    ) return;
    const generationId = crypto.randomUUID();
    prepareTaskCompletionNotifications();
    setNarrationGenerating(true);
    setNarrationGenerationError('');
    try {
      const status = await codex.verify();
      if (status?.state !== 'connected') {
        throw new Error('Hãy kết nối Codex trước khi tạo lời thoại.');
      }
      const selection = codex.getGenerationSelection('narration');
      if (!selection) {
        throw new Error('Hãy chọn model và mức reasoning trước khi tạo lời thoại.');
      }
      const response = await generateNarrationDraft({
        generationId,
        topicInput: topicInput.data,
        ...(narrationGuidance.trim()
          ? {userGuidance: narrationGuidance.trim()}
          : {}),
        ...selection,
      });
      update('narrationSourceText', response.draft.text);
      notifyTaskCompleted({
        id: `narration-draft:${generationId}`,
        title: 'Lời thoại đã soạn xong',
        message: 'Bản nháp mới đã sẵn sàng để bạn đọc và chỉnh sửa.',
      });
    } catch (reason) {
      const errorMessage = reason instanceof ApiRequestError || reason instanceof Error
        ? reason.message
        : 'Không thể tạo lời thoại lúc này.';
      setNarrationGenerationError(errorMessage);
      notifyTaskFailed({
        id: `narration-draft:${generationId}`,
        title: 'Không thể soạn lời thoại',
        message: errorMessage,
      });
    } finally {
      setNarrationGenerating(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (contentOperationBusy) return;
    const topicInput = buildTopicInput(form);
    const encodingIssue =
      textEncodingIssue(form.topic) ??
      textEncodingIssue(form.narrationSourceText);
    if (!topicInput.success || !form.narrationSourceText.trim() || encodingIssue) {
      const invalidTopicMessage = topicInput.success
        ? 'Thông tin đầu vào chưa hợp lệ.'
        : topicInput.error.issues[0]?.message ?? 'Thông tin đầu vào chưa hợp lệ.';
      setError(
        encodingIssue
          ? `${encodingIssue} Hãy dán lại nội dung đúng Unicode trước khi lưu.`
          : !form.narrationSourceText.trim()
            ? 'Hãy nhập lời thoại trước khi lưu project.'
            : invalidTopicMessage,
      );
      setState('error');
      return;
    }
    const topicChanged = Boolean(
      project &&
      JSON.stringify(topicInput.data) !== JSON.stringify(project.topicInput),
    );
    const narrationChanged = Boolean(
      project &&
      form.narrationSourceText.trim() !== project.narration?.sourceText,
    );
    const hasGeneratedOutput = Boolean(
      project?.voiceBundle ||
      project?.motionCanvasBundle ||
      project?.animationSyncBundle ||
      project?.layoutBundle ||
      project?.renderBundle,
    );
    if (
      project &&
      hasGeneratedOutput &&
      (topicChanged || narrationChanged) &&
      !window.confirm(
        narrationChanged
          ? 'Lưu lời thoại mới sẽ yêu cầu duyệt lại cách đọc và làm audio, scene, đồng bộ, bản chỉnh sửa cùng video hiện tại hết hiệu lực. Các file cũ vẫn được giữ trong workspace. Tiếp tục?'
          : 'Lưu thiết lập đầu vào mới sẽ làm kế hoạch hình ảnh, scene, đồng bộ, bản chỉnh sửa và video hiện tại hết hiệu lực. Audio được giữ nếu lời thoại và timeline không đổi. Tiếp tục?',
      )
    ) return;
    setState('saving');
    setError('');
    try {
      let saved: TopicProject;
      if (!project) {
        saved = await createTopicProject({
          creationId: creationId.current,
          topicInput: topicInput.data,
          narrationSourceText: form.narrationSourceText.trim(),
        });
      } else {
        saved = topicChanged
          ? await updateTopicProject(project.id, {topicInput: topicInput.data}, project.revision)
          : project;
        // Keep the latest revision locally before the separate narration
        // write. If that request is interrupted, retry remains conflict-safe.
        if (topicChanged) setProject(saved);
        if (narrationChanged) {
          saved = await saveProjectNarration(
            saved.id,
            {sourceText: form.narrationSourceText.trim(), projectRules: saved.narration?.projectRules ?? []},
            saved.revision,
          );
        }
      }
      clearPageDraft('content', projectId);
      setProject(saved);
      setForm(initialForm(saved));
      setNarrationGuidance('');
      setState('saved');
      if (!project) {
        skipNextNavigationGuardRef.current = true;
        allowNextWorkflowNavigation();
        navigate(projectContentPath(saved.id), true);
      }
    } catch (reason) {
      setState('error');
      setError(reason instanceof ApiRequestError ? reason.message : 'Không thể lưu project lúc này.');
    }
  }

  if (state === 'loading') {
    return <div className="page-state" role="status"><span className="spinner dark" /><strong>Đang mở project…</strong></div>;
  }

  return (
    <main className="content-workspace">
      <div className="page-heading">
        <div className="eyebrow">
          <span>Bước 01 · Nội dung gốc</span>
          <div className="eyebrow-line" />
        </div>
        <h1>{projectId ? 'Chỉnh đầu vào video' : 'Bắt đầu từ nội dung của bạn'}</h1>
        <p>Chỉ cần chủ đề, background, khung hình và lời thoại. Bạn có thể tự chuẩn bị, hoặc dùng AI tạo một bản nháp rồi chỉnh theo ý mình.</p>
      </div>
      <form className="content-form" onSubmit={submit} noValidate>
        <section className="content-field">
          <span>Chủ đề</span>
          <textarea autoFocus rows={2} value={form.topic} disabled={contentOperationBusy} placeholder="Ví dụ: Vì sao tìm kiếm nhị phân nhanh hơn?" onChange={event => update('topic', event.currentTarget.value)} />
        </section>
        <div className="content-settings">
          <label className="content-field color-field">
            <span>Background</span>
            <div><input type="color" value={form.backgroundColor} disabled={contentOperationBusy} onChange={event => update('backgroundColor', event.currentTarget.value.toUpperCase())} /><code>{form.backgroundColor.toUpperCase()}</code></div>
            <small>{form.backgroundColor.toUpperCase() === defaultVideoBackground.color ? 'Đây là màu mặc định đã chọn sẵn (đen), không phải ô trống — bấm để đổi.' : 'Màu nền cho toàn bộ video.'}</small>
          </label>
          <fieldset className="content-field frame-field">
            <legend>Khung hình</legend>
            <div className="frame-presets">
              {framePresets.map(preset => <button key={preset.label} type="button" disabled={contentOperationBusy} className={sameFrame(form.frame, preset.frame) ? 'is-selected' : ''} onClick={() => update('frame', preset.frame)}>{preset.label}</button>)}
              <button type="button" disabled={contentOperationBusy} className={!isPresetFrame(form.frame) ? 'is-selected' : ''} onClick={() => update('frame', {...form.frame, aspectRatio: 'custom'})}>Tùy chỉnh</button>
            </div>
            <div className="frame-details">
              {form.frame.aspectRatio === 'custom' ? <><label>Rộng <input type="number" min={480} max={3840} step={2} value={form.frame.width} disabled={contentOperationBusy} onChange={event => update('frame', {...form.frame, width: event.currentTarget.valueAsNumber})} /></label><span>×</span><label>Cao <input type="number" min={480} max={3840} step={2} value={form.frame.height} disabled={contentOperationBusy} onChange={event => update('frame', {...form.frame, height: event.currentTarget.valueAsNumber})} /></label></> : <span>{form.frame.width} × {form.frame.height}</span>}
              <label>FPS <select value={form.frame.fps} disabled={contentOperationBusy} onChange={event => update('frame', {...form.frame, fps: Number(event.currentTarget.value) as VideoFrame['fps']})}><option value={24}>24</option><option value={30}>30</option><option value={60}>60</option></select></label>
            </div>
          </fieldset>
          <fieldset className="content-field duration-field">
            <legend>Thời lượng mục tiêu</legend>
            <div className="frame-presets">
              {durationOptions.map(option => <button key={option.value} type="button" disabled={contentOperationBusy} className={form.duration === option.value ? 'is-selected' : ''} onClick={() => update('duration', option.value)}>{option.label}</button>)}
            </div>
            {form.duration === 'custom' && <label className="custom-duration-control">Mục tiêu <input type="number" min={pipelineSafetyLimits.minimumCustomDurationMinutes} max={pipelineSafetyLimits.maximumCustomDurationMinutes} step="0.1" value={Number.isFinite(form.targetDurationMinutes) ? form.targetDurationMinutes : ''} disabled={contentOperationBusy} onChange={event => update('targetDurationMinutes', event.currentTarget.valueAsNumber)} /> phút <small>Mục tiêu linh hoạt ±15% để lời thoại tự nhiên.</small></label>}
            <small>Chỉ dùng để định hướng AI soạn lời thoại bên dưới. Nếu bạn tự viết hoặc dán lời thoại, độ dài thật của video sẽ theo đúng nội dung đó, không theo lựa chọn này.</small>
          </fieldset>
        </div>
        <section className="content-field">
          <span>Lời thoại gốc</span>
          <small>Đây là nội dung bạn muốn nói. Khi sang bước tiếp theo, hệ thống chỉ tự dọn dòng trống và khoảng trắng; mọi quy tắc cách đọc vẫn chờ bạn áp dụng.</small>
          <details className="content-narration-assist">
            <summary><span><strong>Chưa có lời thoại? Tạo nháp bằng AI</strong><small>Tùy chọn — nếu đã chuẩn bị kỹ, chỉ cần dán lời thoại của bạn và bỏ qua phần này.</small></span><em className={codex.status?.state === 'connected' ? 'is-connected' : ''}>{aiConnectionLabel}</em></summary>
            <label><span>Gợi ý cho AI <small>Không bắt buộc</small></span><textarea rows={3} value={narrationGuidance} disabled={contentOperationBusy} placeholder="Ví dụ: giải thích cho người mới, ưu tiên ví dụ đời thường, khoảng ba phút." onChange={event => setNarrationGuidance(event.currentTarget.value)} /></label>
            <CodexConnectionCard connection={codex} task="narration" />
            <div className="narration-assist-actions">
              <button className="secondary-button" type="button" disabled={narrationGenerating || !codex.isTaskReady('narration') || form.topic.trim().length < 6} onClick={() => void createNarrationDraft()}>{narrationGenerating ? 'Đang soạn lời thoại…' : form.narrationSourceText.trim() ? 'Tạo bản nháp thay thế' : 'Để AI soạn lời thoại'}</button>
            </div>
            {narrationGenerationError && <p className="field-error" role="alert">{narrationGenerationError}</p>}
          </details>
          <textarea className="narration-input" rows={15} value={form.narrationSourceText} disabled={contentOperationBusy} placeholder="Dán hoặc viết toàn bộ lời thoại tại đây…" onChange={event => update('narrationSourceText', event.currentTarget.value)} />
          <em>
            {form.narrationSourceText.trim().length.toLocaleString('vi-VN')} ký tự
            {form.narrationSourceText.trim() && ` · ước tính video dài ~${formatEstimatedDuration(estimateNarrationSeconds(form.narrationSourceText))}`}
          </em>
        </section>
        {error && <p className="submit-error" role="alert">{error}</p>}
        <footer className="content-actions">
          <p>{state === 'saved' ? 'Đã lưu. Bước tiếp theo sẽ là duyệt cách đọc.' : 'Lời thoại được lưu cục bộ trong project của bạn.'}</p>
          <div className="content-action-buttons">
            <button className="submit-button" type="submit" disabled={contentOperationBusy || Boolean(project && !hasUnsavedChanges)}>{state === 'saving' ? 'Đang lưu…' : project ? 'Lưu đầu vào' : 'Tạo project'}</button>
            {project && <button className="secondary-button" type="button" disabled={contentOperationBusy} onClick={() => void openPronunciation()}>{openingPronunciation ? 'Đang chuẩn bị…' : 'Chuẩn hóa cách đọc'}</button>}
          </div>
        </footer>
      </form>
    </main>
  );
}
