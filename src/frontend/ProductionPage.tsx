import {useEffect, useMemo, useState} from 'react';
import type {ElevenLabsCatalog} from '../shared/elevenLabs.ts';
import type {TopicProject} from '../shared/topic.ts';
import {
  animationSyncIsStale,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
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
  const [state, setState] = useState<'loading' | 'ready' | 'working' | 'error'>('loading');
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
    project?.animationSyncBundle && !animationSyncIsStale(project),
  );
  const voiceSelectionChanged = Boolean(
    project?.voiceBundle &&
      (project.voiceBundle.configuration.voiceId !== voiceId ||
        project.voiceBundle.configuration.modelId !== modelId),
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
      settings: {
        ...defaultSettings,
        style: selectedModel?.canUseStyle ? defaultSettings.style : 0,
        useSpeakerBoost: Boolean(selectedModel?.canUseSpeakerBoost),
      },
      seed: null,
    }, current.revision);
  }

  async function regenerateAudio() {
    if (!project || state === 'working' || !voiceId || !modelId) return;
    const confirmed = window.confirm(
      'Tạo lại audio sẽ dùng quota ElevenLabs và làm bản đồng bộ/render cũ hết hiệu lực. Tiếp tục?',
    );
    if (!confirmed) return;
    setState('working');
    setMessage('');
    try {
      let current = project;
      setMessage('Đang chuẩn bị cấu trúc scene từ lời thoại đã duyệt…');
      current = await prepareNarrationProduction(
        current.id,
        {generationId: newGenerationId()},
        current.revision,
      );
      current = await generateSelectedAudio(current);
      setProject(current);
      setVoiceId(current.voiceBundle!.configuration.voiceId);
      setModelId(current.voiceBundle!.configuration.modelId);
      setMessage('Audio mới đã sẵn sàng. Scene hiện tại được giữ lại; đồng bộ và render sẽ được tạo lại ở các bước sau.');
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage(error instanceof ApiRequestError || error instanceof Error ? error.message : 'Không thể tạo lại audio.');
    }
  }

  async function runProduction() {
    if (!project || state === 'working') return;
    setState('working');
    setMessage('');
    try {
      let current = project;
      setMessage('Đang chuẩn bị cấu trúc scene từ lời thoại đã duyệt…');
      current = await prepareNarrationProduction(current.id, {generationId: newGenerationId()}, current.revision);
      setProject(current);
      if (!current.voiceBundle) {
        current = await generateSelectedAudio(current);
        setProject(current);
      }
      if (!current.motionCanvasBundle) {
        const selection = codex.getGenerationSelection();
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
        setMessage('Scene đã qua kiểm tra source/workspace nhưng chưa được bạn duyệt. Mở preview ở bước Scenes để xác nhận trước khi đồng bộ audio. Pixel được kiểm tra ở Final Render; manifest layout được kiểm tra trong Layout Preview.');
        setState('ready');
        return;
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
      setMessage('Audio và scene đã đồng bộ, sẵn sàng để kiểm tra và chỉnh lệch.');
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage(error instanceof ApiRequestError || error instanceof Error ? error.message : 'Không thể hoàn tất lượt tạo này.');
    }
  }

  if (state === 'loading') return <div className="page-state" role="status"><span className="spinner dark" /><strong>Đang mở bước audio và scene…</strong></div>;
  if (!project) return <div className="page-state is-error" role="alert"><strong>Không thể mở project</strong><p>{message}</p></div>;
  if (!narrationApproved) return <div className="page-state is-error" role="alert"><strong>Voice chưa được duyệt</strong><p>Chỉ bản cách đọc đã duyệt mới được gửi tới ElevenLabs.</p><button type="button" onClick={() => navigate(projectPronunciationPath(projectId))}>Quay lại duyệt voice</button></div>;

  const firstSection = project.voiceBundle?.sections[0];
  return (
    <main className="production-workspace">
      <header className="production-heading">
        <span>Bước 03 · Giọng đọc & scene</span>
        <h1>Chọn giọng ElevenLabs rồi sinh scene</h1>
        <p>Chọn voice và model tiếng Việt cho bản cách đọc đã duyệt. Codex dùng cùng lời thoại đó để dựng scene ở bước kế tiếp.</p>
      </header>
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
                disabled={!eleven.connected || state === 'working'}
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
                disabled={!eleven.connected || state === 'working'}
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
          {audioReady && (
            <>
              <div className={`production-selection-note${voiceSelectionChanged ? ' is-changed' : ''}`}>
                <span>{voiceSelectionChanged ? 'Lựa chọn mới chưa áp dụng' : 'Đang dùng lựa chọn này'}</span>
                <button
                  type="button"
                  onClick={() => void regenerateAudio()}
                  disabled={!eleven.connected || !voiceId || !modelId || state === 'working'}
                >
                  {state === 'working' ? 'Đang tạo…' : voiceSelectionChanged ? 'Đổi giọng & tạo lại' : 'Tạo lại audio'}
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
            <h2>Scene đã khớp giọng đọc</h2>
          </header>
          <CodexConnectionCard connection={codex} task="motionCanvas" />
          <div className="production-result">
            <strong>{syncReady ? 'Scene và audio đã đồng bộ' : sceneReady ? 'Scene cần đồng bộ lại' : 'Sẵn sàng phân tích trực tiếp'}</strong>
            <p>{syncReady ? `${project.motionCanvasBundle!.scenes.length} scene đã được ánh xạ theo timing giọng đọc thật.` : sceneReady ? 'Bấm đồng bộ để cập nhật scene theo audio hiện tại.' : 'Codex sinh scene, sau đó hệ thống tự ghép timing ElevenLabs.'}</p>
          </div>
        </section>
      </div>
      <RuntimeDiagnosticsCard />
      <footer className="production-footer">
        <div>
          <strong>{syncReady ? 'Bản đồng bộ đã sẵn sàng chỉnh' : sceneReady ? 'Scene cần đồng bộ với audio' : audioReady ? 'Audio đã sẵn sàng, tiếp tục sinh scene' : 'Sẵn sàng sản xuất'}</strong>
          <p>{message || 'Mỗi dịch vụ chỉ được gọi khi phần trước đã sẵn sàng.'}</p>
        </div>
        {syncReady ? (
          <button className="submit-button" type="button" onClick={() => navigate(projectScenesPath(project.id))}>Review & chỉnh scene</button>
        ) : sceneReady && project.motionCanvasBundle?.status !== 'approved' ? (
          <button className="submit-button" type="button" onClick={() => navigate(projectScenesPath(project.id))}>Xem preview & duyệt scene</button>
        ) : (
          <button className="submit-button" type="button" disabled={state === 'working' || (!audioReady && (!eleven.connected || !voiceId || !modelId))} onClick={() => void runProduction()}>
            {state === 'working' ? 'Đang xử lý…' : sceneReady ? 'Đồng bộ lại scene' : audioReady ? 'Sinh scene & đồng bộ' : 'Tạo audio, scene & đồng bộ'}
          </button>
        )}
      </footer>
    </main>
  );
}
