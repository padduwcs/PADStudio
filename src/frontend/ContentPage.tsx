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
import {navigate, projectNarrationPath, projectTopicPath} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';

type ContentForm = {
  topic: string;
  narrationSourceText: string;
  backgroundColor: string;
  frame: VideoFrame;
  duration: TopicInput['duration'];
  targetDurationMinutes: number;
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

function codexAccountLabel(connection: ReturnType<typeof useCodexConnection>) {
  if (connection.checking) return 'Đang kiểm tra kết nối Codex';
  if (connection.status?.state !== 'connected') return 'Codex chưa kết nối';
  const account = connection.status.account;
  const accountLabel = account.type === 'chatgpt'
    ? account.email || 'Tài khoản ChatGPT'
    : 'OpenAI API key';
  const model = (
    connection.selectedModelSummary?.displayName ?? connection.selectedModel
  ) || 'Chưa chọn model';
  const reasoning = connection.selectedReasoningEffort || 'Chưa chọn reasoning';
  return `Đã kết nối: ${accountLabel} · ${model} · ${reasoning}`;
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
  const creationId = useRef(createNewTopicCreationId());
  const codex = useCodexConnection();
  const aiConnectionLabel = codexAccountLabel(codex);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setForm(initialForm());
      setState('ready');
      return;
    }
    let active = true;
    setState('loading');
    void getProject(projectId).then((loaded) => {
      if (!active) return;
      setProject(loaded);
      setForm(initialForm(loaded));
      setState('ready');
    }).catch((reason) => {
      if (!active) return;
      setState('error');
      setError(reason instanceof ApiRequestError ? reason.message : 'Không thể mở project.');
    });
    return () => { active = false; };
  }, [projectId]);

  function update<K extends keyof ContentForm>(key: K, value: ContentForm[K]) {
    setForm(current => ({...current, [key]: value}));
    setError('');
    if (state === 'saved') setState('ready');
  }

  async function createNarrationDraft() {
    if (narrationGenerating) return;
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
    setNarrationGenerating(true);
    setNarrationGenerationError('');
    try {
      const status = await codex.verify();
      if (status?.state !== 'connected') {
        throw new Error('Hãy kết nối Codex trước khi tạo lời thoại.');
      }
      const selection = codex.getGenerationSelection();
      if (!selection) {
        throw new Error('Hãy chọn model và mức reasoning trước khi tạo lời thoại.');
      }
      const response = await generateNarrationDraft({
        generationId: crypto.randomUUID(),
        topicInput: topicInput.data,
        ...(narrationGuidance.trim()
          ? {userGuidance: narrationGuidance.trim()}
          : {}),
        ...selection,
      });
      update('narrationSourceText', response.draft.text);
    } catch (reason) {
      setNarrationGenerationError(
        reason instanceof ApiRequestError || reason instanceof Error
          ? reason.message
          : 'Không thể tạo lời thoại lúc này.',
      );
    } finally {
      setNarrationGenerating(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const topicInput = buildTopicInput(form);
    if (!topicInput.success || !form.narrationSourceText.trim()) {
      const invalidTopicMessage = topicInput.success
        ? 'Thông tin đầu vào chưa hợp lệ.'
        : topicInput.error.issues[0]?.message ?? 'Thông tin đầu vào chưa hợp lệ.';
      setError(!form.narrationSourceText.trim()
        ? 'Hãy nhập lời thoại trước khi lưu project.'
        : invalidTopicMessage);
      setState('error');
      return;
    }
    setState('saving');
    setError('');
    try {
      let saved: TopicProject;
      if (!project) {
        saved = await createTopicProject({
          creationId: creationId.current,
          topicInput: topicInput.data,
          narrationSourceText: form.narrationSourceText.trim(),
          currentStep: 'topic',
        });
        navigate(projectTopicPath(saved.id), true);
      } else {
        const topicChanged = JSON.stringify(topicInput.data) !== JSON.stringify(project.topicInput);
        const narrationChanged = form.narrationSourceText.trim() !== project.narration?.sourceText;
        saved = topicChanged
          ? await updateTopicProject(project.id, {topicInput: topicInput.data, currentStep: 'topic'}, project.revision)
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
      setProject(saved);
      setForm(initialForm(saved));
      setState('saved');
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
      <header className="content-heading">
        <span>Bước 01 · Nội dung gốc</span>
        <h1>{projectId ? 'Chỉnh đầu vào video' : 'Bắt đầu từ nội dung của bạn'}</h1>
        <p>Chỉ cần chủ đề, background, khung hình và lời thoại. Bạn có thể tự chuẩn bị, hoặc dùng AI tạo một bản nháp rồi chỉnh theo ý mình.</p>
      </header>
      <form className="content-form" onSubmit={submit} noValidate>
        <section className="content-field">
          <span>Chủ đề</span>
          <textarea autoFocus rows={2} value={form.topic} placeholder="Ví dụ: Vì sao tìm kiếm nhị phân nhanh hơn?" onChange={event => update('topic', event.currentTarget.value)} />
        </section>
        <section className="content-field">
          <span>Lời thoại gốc</span>
          <small>Đây là nội dung bạn muốn nói. Bước tiếp theo chỉ chuẩn hóa cách ElevenLabs đọc nó.</small>
          <details className="content-narration-assist">
            <summary><span><strong>Chưa có lời thoại? Tạo nháp bằng AI</strong><small>Tùy chọn — nếu đã chuẩn bị kỹ, chỉ cần dán lời thoại của bạn và bỏ qua phần này.</small></span><em className={codex.status?.state === 'connected' ? 'is-connected' : ''}>{aiConnectionLabel}</em></summary>
            <label><span>Gợi ý cho AI <small>Không bắt buộc</small></span><textarea rows={3} value={narrationGuidance} disabled={narrationGenerating} placeholder="Ví dụ: giải thích cho người mới, ưu tiên ví dụ đời thường, khoảng ba phút." onChange={event => setNarrationGuidance(event.currentTarget.value)} /></label>
            <CodexConnectionCard connection={codex} task="narration" />
            <button className="secondary-button" type="button" disabled={narrationGenerating || !codex.generationReady || form.topic.trim().length < 6} onClick={() => void createNarrationDraft()}>{narrationGenerating ? 'Đang soạn lời thoại…' : form.narrationSourceText.trim() ? 'Tạo bản nháp thay thế' : 'Để AI soạn lời thoại'}</button>
            {narrationGenerationError && <p className="field-error" role="alert">{narrationGenerationError}</p>}
          </details>
          <textarea className="narration-input" rows={15} value={form.narrationSourceText} placeholder="Dán hoặc viết toàn bộ lời thoại tại đây…" onChange={event => update('narrationSourceText', event.currentTarget.value)} />
          <em>{form.narrationSourceText.trim().length.toLocaleString('vi-VN')} ký tự</em>
        </section>
        <div className="content-settings">
          <label className="content-field color-field">
            <span>Background</span>
            <div><input type="color" value={form.backgroundColor} onChange={event => update('backgroundColor', event.currentTarget.value.toUpperCase())} /><code>{form.backgroundColor.toUpperCase()}</code></div>
          </label>
          <fieldset className="content-field frame-field">
            <legend>Khung hình</legend>
            <div className="frame-presets">
              {framePresets.map(preset => <button key={preset.label} type="button" className={sameFrame(form.frame, preset.frame) ? 'is-selected' : ''} onClick={() => update('frame', preset.frame)}>{preset.label}</button>)}
              <button type="button" className={!isPresetFrame(form.frame) ? 'is-selected' : ''} onClick={() => update('frame', {...form.frame, aspectRatio: 'custom'})}>Tùy chỉnh</button>
            </div>
            <div className="frame-details">
              {form.frame.aspectRatio === 'custom' ? <><label>Rộng <input type="number" min={480} max={3840} step={2} value={form.frame.width} onChange={event => update('frame', {...form.frame, width: event.currentTarget.valueAsNumber})} /></label><span>×</span><label>Cao <input type="number" min={480} max={3840} step={2} value={form.frame.height} onChange={event => update('frame', {...form.frame, height: event.currentTarget.valueAsNumber})} /></label></> : <span>{form.frame.width} × {form.frame.height}</span>}
              <label>FPS <select value={form.frame.fps} onChange={event => update('frame', {...form.frame, fps: Number(event.currentTarget.value) as VideoFrame['fps']})}><option value={24}>24</option><option value={30}>30</option><option value={60}>60</option></select></label>
            </div>
          </fieldset>
          <fieldset className="content-field duration-field">
            <legend>Thời lượng lời thoại</legend>
            <div className="frame-presets">
              {durationOptions.map(option => <button key={option.value} type="button" className={form.duration === option.value ? 'is-selected' : ''} onClick={() => update('duration', option.value)}>{option.label}</button>)}
            </div>
            {form.duration === 'custom' && <label className="custom-duration-control">Mục tiêu <input type="number" min={pipelineSafetyLimits.minimumCustomDurationMinutes} max={pipelineSafetyLimits.maximumCustomDurationMinutes} step="0.1" value={Number.isFinite(form.targetDurationMinutes) ? form.targetDurationMinutes : ''} onChange={event => update('targetDurationMinutes', event.currentTarget.valueAsNumber)} /> phút <small>Mục tiêu linh hoạt ±15% để lời thoại tự nhiên.</small></label>}
            <small>AI dùng thời lượng này để điều chỉnh độ dài và nhịp của bản nháp.</small>
          </fieldset>
        </div>
        {error && <p className="submit-error" role="alert">{error}</p>}
        <footer className="content-actions">
          <p>{state === 'saved' ? 'Đã lưu. Bước tiếp theo sẽ là duyệt cách đọc.' : 'Lời thoại được lưu cục bộ trong project của bạn.'}</p>
          <div className="content-action-buttons">
            <button className="submit-button" type="submit" disabled={state === 'saving'}>{state === 'saving' ? 'Đang lưu…' : project ? 'Lưu đầu vào' : 'Tạo project'}</button>
            {project && <button className="secondary-button" type="button" onClick={() => navigate(projectNarrationPath(project.id))}>Chuẩn hóa cách đọc</button>}
          </div>
        </footer>
      </form>
    </main>
  );
}
