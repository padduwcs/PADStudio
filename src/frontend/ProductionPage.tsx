import {useEffect, useMemo, useState} from 'react';
import type {ElevenLabsCatalog} from '../shared/elevenLabs.ts';
import type {TopicProject} from '../shared/topic.ts';
import {
  ApiRequestError,
  generateMotionCanvas,
  generateVoice,
  getElevenLabsCatalog,
  getProject,
  prepareDirectProduction,
  voiceAudioUrl,
} from './api.ts';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {ElevenLabsConnectionCard} from './ElevenLabsConnectionCard.tsx';
import {navigate, projectNarrationPath} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {useElevenLabsConnection} from './useElevenLabsConnection.ts';

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

function isDirect(project: TopicProject) {
  return project.outline?.generation.promptVersion === 'direct-narration-v1' &&
    project.voiceVisualPlan?.generation.promptVersion === 'direct-narration-v1';
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
  const audioReady = Boolean(project?.voiceBundle && isDirect(project));
  const sceneReady = Boolean(project?.motionCanvasBundle && isDirect(project));

  async function runProduction() {
    if (!project || state === 'working') return;
    setState('working');
    setMessage('');
    try {
      let current = project;
      if (!isDirect(current)) {
        setMessage('Đang cố định lời thoại đã duyệt cho audio…');
        current = await prepareDirectProduction(current.id, {generationId: newGenerationId()}, current.revision);
        setProject(current);
      }
      if (!current.voiceBundle) {
        const connected = await eleven.verify();
        if (connected?.state !== 'connected') {
          throw new Error('Hãy kết nối ElevenLabs trước khi tạo audio.');
        }
        if (!voiceId || !modelId) {
          throw new Error('Hãy chọn voice và model tiếng Việt của ElevenLabs.');
        }
        setMessage('ElevenLabs đang tạo audio từ bản voice đã duyệt…');
        current = await generateVoice(current.id, {
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
      setMessage('Audio và scene đã sẵn sàng để sang bước chỉnh scene.');
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage(error instanceof ApiRequestError || error instanceof Error ? error.message : 'Không thể hoàn tất lượt tạo này.');
    }
  }

  if (state === 'loading') return <div className="page-state" role="status"><span className="spinner dark" /><strong>Đang mở bước audio và scene…</strong></div>;
  if (!project) return <div className="page-state is-error" role="alert"><strong>Không thể mở project</strong><p>{message}</p></div>;
  if (!narrationApproved) return <div className="page-state is-error" role="alert"><strong>Voice chưa được duyệt</strong><p>Chỉ bản cách đọc đã duyệt mới được gửi tới ElevenLabs.</p><button type="button" onClick={() => navigate(projectNarrationPath(projectId))}>Quay lại duyệt voice</button></div>;

  const firstSection = project.voiceBundle?.sections[0];
  return (
    <main className="production-workspace">
      <header className="production-heading"><span>Bước 03 · Audio & scene</span><h1>Tạo audio rồi sinh scene trực tiếp</h1><p>Hệ thống chỉ dùng đúng snapshot voice đã duyệt. Codex nhận lời thoại đó để dựng scene; bạn sẽ chỉnh scene ở bước kế tiếp.</p></header>
      <div className="production-grid">
        <section className="production-card">
          <header><span>ElevenLabs</span><h2>Audio tiếng Việt</h2></header>
          <ElevenLabsConnectionCard connection={eleven} />
          {audioReady ? <div className="production-result"><strong>Audio đã tạo</strong><p>{project.voiceBundle!.configuration.voiceName} · {Math.round(project.voiceBundle!.totalDurationSeconds)} giây</p>{firstSection && <audio controls src={voiceAudioUrl(project.id, firstSection.outlineSectionId, project.voiceBundle!.generation.generationId)} />}</div> : <div className="production-fields"><label><span>Voice</span><select value={voiceId} onChange={event => setVoiceId(event.currentTarget.value)} disabled={!eleven.connected}><option value="">Chọn voice</option>{catalog?.voices.map(voice => <option value={voice.voiceId} key={voice.voiceId}>{voice.name}</option>)}</select></label><label><span>Model tiếng Việt</span><select value={modelId} onChange={event => setModelId(event.currentTarget.value)} disabled={!eleven.connected}><option value="">Chọn model</option>{catalog?.models.filter(model => model.languages.includes('vi')).map(model => <option value={model.modelId} key={model.modelId}>{model.name}</option>)}</select></label></div>}
        </section>
        <section className="production-card">
          <header><span>Codex</span><h2>Scene theo lời thoại</h2></header>
          <CodexConnectionCard connection={codex} task="motionCanvas" />
          <div className="production-result"><strong>{sceneReady ? 'Scene đã sinh' : 'Sẵn sàng phân tích trực tiếp'}</strong><p>{sceneReady ? `${project.motionCanvasBundle!.scenes.length} scene đã chờ bạn review và chỉnh sửa.` : 'Không tạo outline hoặc voice–visual riêng cho người dùng.'}</p></div>
        </section>
      </div>
      <footer className="production-footer"><div><strong>{sceneReady ? 'Hoàn tất lượt tạo' : audioReady ? 'Audio đã sẵn sàng, tiếp tục sinh scene' : 'Sẵn sàng sản xuất'}</strong><p>{message || 'Mỗi dịch vụ chỉ được gọi khi phần trước đã sẵn sàng.'}</p></div><button className="submit-button" type="button" disabled={state === 'working' || sceneReady || (!audioReady && (!eleven.connected || !voiceId || !modelId))} onClick={() => void runProduction()}>{state === 'working' ? 'Đang xử lý…' : sceneReady ? 'Đã tạo xong' : audioReady ? 'Sinh scene' : 'Tạo audio và scene'}</button></footer>
    </main>
  );
}
