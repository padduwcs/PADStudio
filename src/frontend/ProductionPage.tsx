import {useEffect, useMemo, useState} from 'react';
import type {ElevenLabsCatalog} from '../shared/elevenLabs.ts';
import type {TopicProject} from '../shared/topic.ts';
import {
  animationSyncIsStale,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  approveAnimationSync,
  approveMotionCanvas,
  generateAnimationSync,
  generateMotionCanvas,
  generateVoice,
  getElevenLabsCatalog,
  getProject,
  prepareNarrationProduction,
  voiceAudioUrl,
} from './api.ts';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {ElevenLabsConnectionCard} from './ElevenLabsConnectionCard.tsx';
import {navigate, projectPronunciationPath, projectScenesPath} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {useElevenLabsConnection} from './useElevenLabsConnection.ts';
import {RuntimeDiagnosticsCard} from './RuntimeDiagnosticsCard.tsx';
import {
  notifyTaskCompleted,
  prepareTaskCompletionNotifications,
} from './taskCompletionNotifications.ts';

const defaultSettings = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: true,
  speed: 1,
};

function newGenerationId() {
  return crypto.randomUUID();
}

export function ProductionPage({projectId}: {projectId: string}) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [catalog, setCatalog] = useState<ElevenLabsCatalog | null>(null);
  const [voiceId, setVoiceId] = useState('');
  const [modelId, setModelId] = useState('');
  const [settings, setSettings] = useState(defaultSettings);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyAction, setBusyAction] = useState<'createAudio' | 'regenerateAudio' | 'generateScene' | 'combined' | null>(null);
  const [message, setMessage] = useState('');
  const eleven = useElevenLabsConnection();
  const codex = useCodexConnection();

  useEffect(() => {
    let active = true;
    void getProject(projectId)
      .then(value => {
        if (!active) return;
        setProject(value);
        if (value.voiceBundle) {
          setVoiceId(value.voiceBundle.configuration.voiceId);
          setModelId(value.voiceBundle.configuration.modelId);
          setSettings(value.voiceBundle.configuration.settings);
        }
        setState('ready');
      })
      .catch(error => {
        if (!active) return;
        setState('error');
        setMessage(error instanceof ApiRequestError ? error.message : 'Không thể mở bước audio và scene.');
      });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (!eleven.connected) return;
    let active = true;
    void getElevenLabsCatalog().then(value => {
      if (!active) return;
      setCatalog(value);
      const preferred = value.recentPresets.find(item => item.source === 'pad-studio');
      const voice = value.voices.find(item => item.voiceId === preferred?.voiceId) ?? value.voices[0];
      const model = value.models.find(item => item.modelId === preferred?.modelId && item.languages.includes('vi')) ??
        value.models.find(item => item.languages.includes('vi'));
      setVoiceId(current => current || voice?.voiceId || '');
      setModelId(current => current || model?.modelId || '');
    }).catch(error => {
      if (!active) return;
      setMessage(error instanceof ApiRequestError ? error.message : 'Không thể tải danh mục ElevenLabs.');
    });
    return () => { active = false; };
  }, [eleven.connected]);

  const narrationApproved = Boolean(
    project?.narration?.review &&
      project.narration.approvedAt &&
      project.narration.approvedSourceHash === project.narration.review.sourceHash,
  );
  const selectedModel = useMemo(
    () => catalog?.models.find(item => item.modelId === modelId) ?? null,
    [catalog, modelId],
  );
  const audioReady = Boolean(project?.voiceBundle);
  const sceneReady = Boolean(project?.motionCanvasBundle);
  const syncReady = Boolean(
    project?.animationSyncBundle?.status === 'approved' &&
      !animationSyncIsStale(project),
  );
  const effectiveSettings = {
    ...settings,
    style: selectedModel?.canUseStyle ? settings.style : 0,
    useSpeakerBoost: selectedModel?.canUseSpeakerBoost ? settings.useSpeakerBoost : false,
  };
  const voiceSelectionChanged = Boolean(
    project?.voiceBundle &&
      (project.voiceBundle.configuration.voiceId !== voiceId ||
        project.voiceBundle.configuration.modelId !== modelId ||
        JSON.stringify(project.voiceBundle.configuration.settings) !== JSON.stringify(effectiveSettings)),
  );

  async function generateSelectedAudio(current: TopicProject) {
    const connected = await eleven.verify();
    if (connected?.state !== 'connected') {
      throw new Error('Hãy kết nối ElevenLabs trước khi tạo audio.');
    }
    if (!voiceId || !modelId) {
      throw new Error('Hãy chọn voice và model tiếng Việt của ElevenLabs.');
    }
    setMessage('ElevenLabs đang tạo audio từ bản cách đọc đã duyệt…');
    return generateVoice(current.id, {
      generationId: newGenerationId(),
      voiceId,
      modelId,
      outputFormat: 'mp3_44100_128',
      settings: effectiveSettings,
      seed: null,
    }, current.revision);
  }

  function plannerSelectionFields() {
    const selection = codex.getGenerationSelection('visualPlanner');
    return {
      ...(selection?.model ? {plannerModel: selection.model} : {}),
      ...(selection?.reasoningEffort
        ? {plannerReasoningEffort: selection.reasoningEffort}
        : {}),
    };
  }

  async function regenerateAudio() {
    if (!project || busyAction || !voiceId || !modelId) return;
    const confirmed = window.confirm(
      'Tạo lại audio sẽ dùng quota ElevenLabs và làm bản đồng bộ/render cũ hết hiệu lực. Tiếp tục?',
    );
    if (!confirmed) return;
    const taskId = newGenerationId();
    prepareTaskCompletionNotifications();
    setBusyAction('regenerateAudio');
    setMessage('');
    try {
      let current = project;
      setMessage('Đang chuẩn bị cấu trúc scene từ lời thoại đã duyệt…');
      current = await prepareNarrationProduction(
        current.id,
        {generationId: newGenerationId(), ...plannerSelectionFields()},
        current.revision,
      );
      current = await generateSelectedAudio(current);
      setProject(current);
      setVoiceId(current.voiceBundle!.configuration.voiceId);
      setModelId(current.voiceBundle!.configuration.modelId);
      setMessage('Audio mới đã sẵn sàng. Scene hiện tại được giữ lại; đồng bộ và render sẽ được tạo lại ở các bước sau.');
      setState('ready');
      notifyTaskCompleted({
        id: `regenerate-audio:${taskId}`,
        title: 'Audio mới đã tạo xong',
        message: 'Bạn có thể nghe lại audio ngay trong bước Giọng đọc & scene.',
      });
    } catch (error) {
      setState('error');
      setMessage(error instanceof ApiRequestError || error instanceof Error ? error.message : 'Không thể tạo lại audio.');
    } finally {
      setBusyAction(null);
    }
  }

  async function createAudio() {
    if (!project || busyAction || !voiceId || !modelId) return;
    const taskId = newGenerationId();
    prepareTaskCompletionNotifications();
    setBusyAction('createAudio');
    setMessage('');
    try {
      setMessage('Đang chuẩn bị cấu trúc scene từ lời thoại đã duyệt…');
      let current = await prepareNarrationProduction(
        project.id,
        {generationId: newGenerationId(), ...plannerSelectionFields()},
        project.revision,
      );
      current = await generateSelectedAudio(current);
      setProject(current);
      setVoiceId(current.voiceBundle!.configuration.voiceId);
      setModelId(current.voiceBundle!.configuration.modelId);
      setMessage('Audio đã sẵn sàng. Bước tiếp theo: bấm “Sinh scene” ở khung Codex.');
      setState('ready');
      notifyTaskCompleted({
        id: `create-audio:${taskId}`,
        title: 'Audio đã tạo xong',
        message: 'Giọng đọc đã sẵn sàng để nghe thử và dùng khi sinh scene.',
      });
    } catch (error) {
      setState('error');
      setMessage(error instanceof ApiRequestError || error instanceof Error ? error.message : 'Không thể tạo audio.');
    } finally {
      setBusyAction(null);
    }
  }

  async function runProduction(source: 'generateScene' | 'combined' = 'combined') {
    if (!project || busyAction) return;
    const taskId = newGenerationId();
    prepareTaskCompletionNotifications();
    setBusyAction(source);
    setMessage('');
    try {
      let current = project;
      setMessage('Đang chuẩn bị cấu trúc scene từ lời thoại đã duyệt…');
      current = await prepareNarrationProduction(current.id, {generationId: newGenerationId(), ...plannerSelectionFields()}, current.revision);
      setProject(current);
      if (!current.voiceBundle) {
        current = await generateSelectedAudio(current);
        setProject(current);
      }
      if (!current.motionCanvasBundle) {
        const selection = codex.getGenerationSelection('motionCanvas');
        if (!selection) {
          throw new Error('Hãy kết nối Codex và chọn model trước khi sinh scene.');
        }
        setMessage('Codex đang phân tích lời thoại và sinh scene trực tiếp…');
        current = await generateMotionCanvas(current.id, {
          generationId: newGenerationId(),
          ...selection,
        }, current.revision);
        setProject(current);
      }
      if (!current.motionCanvasBundle) {
        throw new Error('Scene vừa sinh không có dữ liệu hợp lệ để đồng bộ.');
      }
      if (current.motionCanvasBundle.status !== 'approved') {
        setMessage('Đang chuẩn bị scene để ghép theo timing giọng đọc…');
        current = await approveMotionCanvas(current.id, current.revision);
        setProject(current);
      }
      if (!current.animationSyncBundle || animationSyncIsStale(current)) {
        setMessage('Đang đồng bộ scene theo timing thật của giọng đọc…');
        current = await generateAnimationSync(
          current.id,
          {generationId: newGenerationId()},
          current.revision,
        );
        setProject(current);
      }
      if (current.animationSyncBundle?.status !== 'approved') {
        current = await approveAnimationSync(current.id, current.revision);
        setProject(current);
      }
      setState('ready');
      notifyTaskCompleted({
        id: `production:${taskId}`,
        title: 'Scene và đồng bộ đã sẵn sàng',
        message: 'PAD Studio đã hoàn tất lượt tạo. Bạn có thể bắt đầu kiểm tra scene.',
      });
      navigate(projectScenesPath(current.id));
    } catch (error) {
      setState('error');
      setMessage(error instanceof ApiRequestError || error instanceof Error ? error.message : 'Không thể hoàn tất lượt tạo này.');
    } finally {
      setBusyAction(null);
    }
  }

  if (state === 'loading') return <div className="page-state" role="status"><span className="spinner dark" /><strong>Đang mở bước audio và scene…</strong></div>;
  if (!project) return <div className="page-state is-error" role="alert"><strong>Không thể mở project</strong><p>{message}</p></div>;
  if (!narrationApproved) return <div className="page-state is-error" role="alert"><strong>Voice chưa được duyệt</strong><p>Chỉ bản cách đọc đã duyệt mới được gửi tới ElevenLabs.</p><button type="button" onClick={() => navigate(projectPronunciationPath(projectId))}>Quay lại duyệt voice</button></div>;

  const firstSection = project.voiceBundle?.sections[0];
  return (
    <main className="production-workspace">
      <div className="page-heading">
        <div className="eyebrow">
          <span>Bước 03 · Giọng đọc & scene</span>
          <div className="eyebrow-line" />
        </div>
        <h1>Chọn giọng ElevenLabs rồi sinh scene</h1>
        <p>Chọn voice và model tiếng Việt cho bản cách đọc đã duyệt. Codex dùng cùng lời thoại đó để dựng scene ở bước kế tiếp.</p>
      </div>
      <RuntimeDiagnosticsCard />
      <div className="production-grid">
        <section className="production-card">
          <header>
            <span>ElevenLabs</span>
            <h2>Giọng đọc tiếng Việt</h2>
          </header>
          <ElevenLabsConnectionCard connection={eleven} />
          <div className="production-fields">
            <label>
              <span>Voice</span>
              <select
                value={voiceId}
                onChange={event => setVoiceId(event.currentTarget.value)}
                disabled={!eleven.connected || busyAction !== null}
              >
                <option value="">Chọn voice</option>
                {project.voiceBundle && !catalog?.voices.some(voice => voice.voiceId === project.voiceBundle!.configuration.voiceId) && (
                  <option value={project.voiceBundle.configuration.voiceId}>
                    {project.voiceBundle.configuration.voiceName} (đang dùng)
                  </option>
                )}
                {catalog?.voices.map(voice => <option value={voice.voiceId} key={voice.voiceId}>{voice.name}</option>)}
              </select>
            </label>
            <label>
              <span>Model tiếng Việt</span>
              <select
                value={modelId}
                onChange={event => setModelId(event.currentTarget.value)}
                disabled={!eleven.connected || busyAction !== null}
              >
                <option value="">Chọn model</option>
                {project.voiceBundle && !catalog?.models.some(model => model.modelId === project.voiceBundle!.configuration.modelId) && (
                  <option value={project.voiceBundle.configuration.modelId}>
                    {project.voiceBundle.configuration.modelName} (đang dùng)
                  </option>
                )}
                {catalog?.models.filter(model => model.languages.includes('vi')).map(model => <option value={model.modelId} key={model.modelId}>{model.name}</option>)}
              </select>
            </label>
          </div>
          <details className="production-voice-settings">
            <summary>Thông số giọng đọc</summary>
            <label>
              <span>Ổn định giọng <small>{settings.stability.toFixed(2)}</small></span>
              <input type="range" min={0} max={1} step={0.05} value={settings.stability} disabled={busyAction !== null} onChange={event => setSettings(current => ({...current, stability: Number(event.currentTarget.value)}))} />
            </label>
            <label>
              <span>Độ giống giọng gốc <small>{settings.similarityBoost.toFixed(2)}</small></span>
              <input type="range" min={0} max={1} step={0.05} value={settings.similarityBoost} disabled={busyAction !== null} onChange={event => setSettings(current => ({...current, similarityBoost: Number(event.currentTarget.value)}))} />
            </label>
            <label>
              <span>Tốc độ đọc <small>{settings.speed.toFixed(2)}×</small></span>
              <input type="range" min={0.7} max={1.2} step={0.05} value={settings.speed} disabled={busyAction !== null} onChange={event => setSettings(current => ({...current, speed: Number(event.currentTarget.value)}))} />
            </label>
            {selectedModel?.canUseStyle && (
              <label>
                <span>Biểu cảm (style) <small>{settings.style.toFixed(2)}</small></span>
                <input type="range" min={0} max={1} step={0.05} value={settings.style} disabled={busyAction !== null} onChange={event => setSettings(current => ({...current, style: Number(event.currentTarget.value)}))} />
              </label>
            )}
            {selectedModel?.canUseSpeakerBoost && (
              <label className="production-voice-toggle">
                <input type="checkbox" checked={settings.useSpeakerBoost} disabled={busyAction !== null} onChange={event => setSettings(current => ({...current, useSpeakerBoost: event.currentTarget.checked}))} />
                <span>Speaker boost</span>
              </label>
            )}
          </details>
          {!audioReady && (
            <div className="production-action">
              <button
                className="secondary-button"
                type="button"
                disabled={!eleven.connected || !voiceId || !modelId || busyAction !== null}
                onClick={() => void createAudio()}
              >
                {busyAction === 'createAudio' ? 'Đang tạo audio…' : 'Tạo audio'}
              </button>
              <small>
                {!eleven.connected
                  ? 'Kết nối ElevenLabs để bắt đầu.'
                  : !voiceId || !modelId
                    ? 'Chọn voice và model tiếng Việt trước.'
                    : 'Chỉ tạo giọng đọc; scene sẽ được tạo ở khung bên cạnh.'}
              </small>
            </div>
          )}
          {audioReady && (
            <>
              <div className={`production-selection-note${voiceSelectionChanged ? ' is-changed' : ''}`}>
                <span>{voiceSelectionChanged ? 'Lựa chọn mới chưa áp dụng' : 'Đang dùng lựa chọn này'}</span>
                <button
                  type="button"
                  onClick={() => void regenerateAudio()}
                  disabled={!eleven.connected || !voiceId || !modelId || busyAction !== null}
                >
                  {busyAction === 'regenerateAudio' ? 'Đang tạo…' : voiceSelectionChanged ? 'Đổi giọng & tạo lại' : 'Tạo lại audio'}
                </button>
              </div>
              <div className="production-result">
                <strong>Audio đã tạo</strong>
                <p>{project.voiceBundle!.configuration.voiceName} · {Math.round(project.voiceBundle!.totalDurationSeconds)} giây</p>
                {firstSection && <audio controls src={voiceAudioUrl(project.id, firstSection.outlineSectionId, project.voiceBundle!.generation.generationId)} />}
              </div>
            </>
          )}
        </section>
        <section className="production-card">
          <header>
            <span>Codex</span>
            <h2>Lập kế hoạch & dựng scene</h2>
          </header>
          <CodexConnectionCard
            connection={codex}
            task="visualPlanner"
            extraTasks={[{task: 'motionCanvas', label: 'Scene Motion Canvas'}]}
          />
          <div className="production-result">
            <strong>AI Visual Planner</strong>
            <p>Chọn model/reasoning riêng cho bước lập kế hoạch hình ảnh (title, mục tiêu, visual bible từng scene). Nếu không chọn hoặc AI lỗi, hệ thống tự dùng bộ lập kế hoạch tất định thay thế.</p>
          </div>
          <div className="production-result">
            <strong>{syncReady ? 'Scene và audio đã đồng bộ' : sceneReady ? 'Scene đang cần đồng bộ' : 'Sẵn sàng phân tích trực tiếp'}</strong>
            <p>{syncReady ? `${project.motionCanvasBundle!.scenes.length} scene đã được ánh xạ theo timing giọng đọc thật.` : sceneReady ? 'Hệ thống sẽ tự chuẩn bị và ghép scene theo audio trước khi mở editor.' : 'Codex sinh scene, sau đó hệ thống tự ghép timing ElevenLabs.'}</p>
            {sceneReady && !syncReady && (
              <div className="production-action">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyAction !== null}
                  onClick={() => void runProduction('combined')}
                >
                  {busyAction === 'combined' ? 'Đang chuẩn bị…' : 'Chuẩn bị editor có tiếng'}
                </button>
                <small>Không cần duyệt preview trung gian; editor sẽ mở trên bản đã đồng bộ.</small>
              </div>
            )}
            {syncReady && (
              <div className="production-action">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => navigate(projectScenesPath(project.id))}
                >
                  Mở editor có tiếng
                </button>
                <small>Mở workspace để kiểm tra hoặc chỉnh sửa scene.</small>
              </div>
            )}
            {!sceneReady && (
              <div className="production-action">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!audioReady || !codex.isTaskReady('motionCanvas') || busyAction !== null}
                  onClick={() => void runProduction('generateScene')}
                >
                  {busyAction === 'generateScene' ? 'Đang sinh scene…' : 'Sinh scene'}
                </button>
                <small>
                  {!audioReady
                    ? 'Tạo audio trước khi sinh scene.'
                    : !codex.isTaskReady('motionCanvas')
                      ? 'Kết nối Codex để sinh scene.'
                      : 'Scene sẽ được đồng bộ trước khi mở editor.'}
                </small>
              </div>
            )}
          </div>
        </section>
      </div>
      <footer className="production-footer">
        <div>
          <strong>{syncReady ? 'Bản đồng bộ đã sẵn sàng chỉnh' : sceneReady ? 'Scene cần đồng bộ với audio' : audioReady ? 'Audio đã sẵn sàng, tiếp tục sinh scene' : 'Sẵn sàng sản xuất'}</strong>
          <p>{message || 'Mỗi dịch vụ chỉ được gọi khi phần trước đã sẵn sàng.'}</p>
        </div>
        {syncReady ? (
          <button className="submit-button" type="button" onClick={() => navigate(projectScenesPath(project.id))}>Mở editor có tiếng</button>
        ) : (
          <button className="submit-button" type="button" disabled={busyAction !== null || (!audioReady && (!eleven.connected || !voiceId || !modelId))} onClick={() => void runProduction('combined')}>
            {busyAction === 'combined' ? 'Đang xử lý…' : sceneReady ? 'Mở editor có tiếng' : audioReady ? 'Sinh scene & mở editor' : 'Tạo audio, scene & mở editor'}
          </button>
        )}
      </footer>
    </main>
  );
}
