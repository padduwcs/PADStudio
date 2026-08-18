import {useEffect, useState} from 'react';
import {RenderWatermarkSchema, type RenderWatermark} from '../shared/render.ts';
import {
  animationSyncIsStale,
  layoutIsReady,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  approveAnimationSync,
  generateAnimationSync,
  getAnimationSyncPreview,
  getProject,
  prepareProjectOutput,
  uploadWatermarkImage,
  watermarkAssetUrl,
} from './api.ts';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {MotionDesignEditor} from './MotionDesignEditor.tsx';
import {
  navigate,
  projectProductionPath,
  projectRenderPath,
} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {useMotionCanvasDraft} from './useMotionCanvasDraft.ts';

function defaultWatermark(type: RenderWatermark['type']): RenderWatermark {
  if (type === 'text') return {type, text: 'Tên kênh', opacity: 0.35, xPercent: 88, yPercent: 92, fontSize: 42, color: '#ffffff'};
  if (type === 'image') return {type, assetId: '', opacity: 0.35, xPercent: 88, yPercent: 92, widthPercent: 22, tintColor: '#FFFFFF', tintStrength: 0};
  return {type: 'none'};
}

function WatermarkSettings({
  watermark,
  uploading,
  error,
  onChange,
  onUpload,
}: {
  watermark: RenderWatermark;
  uploading: boolean;
  error: string;
  onChange: (watermark: RenderWatermark) => void;
  onUpload: (file: File) => void;
}) {
  const label = watermark.type === 'none' ? 'Không dùng' : watermark.type === 'text' ? 'Chữ' : 'Ảnh';
  return <details className="scene-review-watermark" open>
    <summary><span>Đầu ra</span><strong>Watermark</strong><small>{label}</small></summary>
    <div>
      <label><span>Loại</span><select value={watermark.type} onChange={event => onChange(defaultWatermark(event.currentTarget.value as RenderWatermark['type']))}><option value="none">Không dùng</option><option value="text">Chữ</option><option value="image">Ảnh</option></select></label>
      {watermark.type === 'text' && <><label><span>Nội dung</span><input value={watermark.text} onChange={event => onChange({...watermark, text: event.currentTarget.value})} placeholder="Tên kênh" /></label><label><span>Màu</span><input type="color" value={watermark.color} onChange={event => onChange({...watermark, color: event.currentTarget.value})} /></label></>}
      {watermark.type === 'image' && <label><span>Ảnh PNG, JPEG hoặc WebP</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onUpload(file); }} /><small>{uploading ? 'Đang tải ảnh…' : watermark.assetId ? 'Ảnh đã sẵn sàng.' : 'Chưa chọn ảnh.'}</small></label>}
      {watermark.type !== 'none' && <><label><span>Độ mờ</span><input type="range" min={0} max={1} step={0.05} value={watermark.opacity} onChange={event => onChange({...watermark, opacity: Number(event.currentTarget.value)})} /></label><label><span>Vị trí ngang</span><input type="range" min={0} max={100} step={1} value={watermark.xPercent} onChange={event => onChange({...watermark, xPercent: Number(event.currentTarget.value)})} /></label><label><span>Vị trí dọc</span><input type="range" min={0} max={100} step={1} value={watermark.yPercent} onChange={event => onChange({...watermark, yPercent: Number(event.currentTarget.value)})} /></label></>}
      {error && <p className="submit-error" role="alert">{error}</p>}
    </div>
  </details>;
}

export function SceneReviewPage({projectId}: {projectId: string}) {
  const motion = useMotionCanvasDraft(projectId);
  const codex = useCodexConnection();
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [guidance, setGuidance] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [completionMessage, setCompletionMessage] = useState('');
  const [syncPreviewState, setSyncPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [syncPreviewUrl, setSyncPreviewUrl] = useState('');
  const [syncPreviewError, setSyncPreviewError] = useState('');
  const [watermark, setWatermark] = useState<RenderWatermark>({type: 'none'});
  const [watermarkUploading, setWatermarkUploading] = useState(false);
  const [watermarkUploadError, setWatermarkUploadError] = useState('');
  const syncGenerationId = motion.project?.animationSyncBundle?.generation.generationId ?? '';
  const syncPreviewIsCurrent = Boolean(
    motion.project?.animationSyncBundle &&
      !animationSyncIsStale(motion.project),
  );

  useEffect(() => {
    const existing = motion.project?.layoutBundle?.renderSettings.watermark;
    if (existing) setWatermark(existing);
  }, [motion.project?.layoutBundle?.renderSettings.watermark]);

  useEffect(() => {
    let active = true;
    if (!syncGenerationId || !syncPreviewIsCurrent) {
      setSyncPreviewState('idle');
      setSyncPreviewUrl('');
      setSyncPreviewError('');
      return () => { active = false; };
    }
    setSyncPreviewState('loading');
    setSyncPreviewUrl('');
    setSyncPreviewError('');
    void getAnimationSyncPreview(projectId, syncGenerationId)
      .then(preview => {
        if (!active || preview.generationId !== syncGenerationId) return;
        setSyncPreviewUrl(preview.url);
        setSyncPreviewState('ready');
      })
      .catch(error => {
        if (!active) return;
        setSyncPreviewError(error instanceof ApiRequestError ? error.message : 'Không thể mở preview đã đồng bộ.');
        setSyncPreviewState('error');
      });
    return () => { active = false; };
  }, [projectId, syncGenerationId, syncPreviewIsCurrent]);

  function toggle(sceneId: string) {
    setSelectedSceneIds(current => current.includes(sceneId)
      ? current.filter(item => item !== sceneId)
      : [...current, sceneId]);
  }

  async function createCandidate() {
    if (!guidance.trim() || selectedSceneIds.length === 0) return;
    const status = await codex.verify();
    if (status?.state !== 'connected') return;
    const selection = codex.getGenerationSelection();
    if (!selection) return;
    const candidate = await motion.createCandidate(
      guidance,
      {sceneIds: selectedSceneIds},
      selection.model,
      selection.reasoningEffort,
    );
    if (candidate) setGuidance('');
  }

  function uploadWatermark(file: File) {
    setWatermarkUploading(true);
    setWatermarkUploadError('');
    void uploadWatermarkImage(projectId, file)
      .then(asset => setWatermark(current => current.type === 'image' ? {...current, assetId: asset.assetId} : current))
      .catch(error => setWatermarkUploadError(error instanceof ApiRequestError ? error.message : 'Không thể tải ảnh watermark.'))
      .finally(() => setWatermarkUploading(false));
  }

  async function approveAndContinue() {
    if (syncing) return;
    setSyncing(true);
    setCompletionMessage('');
    try {
      let current = await getProject(projectId);
      if (!current.motionCanvasBundle) {
        throw new Error('Scene hiện tại chưa sẵn sàng.');
      }
      if (current.motionCanvasBundle.status !== 'approved') {
        const approved = await motion.approve();
        if (!approved) throw new Error('Không thể chốt scene hiện tại.');
        current = approved;
      }
      if (!current.voiceBundle) {
        throw new Error('Audio hiện tại chưa sẵn sàng.');
      }
      if (!current.animationSyncBundle || animationSyncIsStale(current)) {
        current = await generateAnimationSync(
          current.id,
          {generationId: crypto.randomUUID()},
          current.revision,
        );
      }
      if (current.animationSyncBundle?.status !== 'approved') {
        current = await approveAnimationSync(current.id, current.revision);
      }
      current = await prepareProjectOutput(
        current.id,
        {generationId: crypto.randomUUID(), renderSettings: {watermark}},
        current.revision,
      );
      setCompletionMessage('Scene đã được chốt và đồng bộ tự động với audio thật.');
      navigate(projectRenderPath(current.id));
    } catch (error) {
      setCompletionMessage(error instanceof Error ? error.message : 'Không thể đồng bộ scene và audio lúc này.');
    } finally {
      setSyncing(false);
    }
  }

  if (motion.loadState === 'loading') return <div className="page-state" role="status"><span className="spinner dark" /><strong>Đang mở scene để review…</strong></div>;
  if (!motion.project || motion.loadState === 'error') return <div className="page-state is-error" role="alert"><strong>Không thể mở scene</strong><p>{motion.loadError}</p></div>;
  const project = motion.project;
  const bundle = project.motionCanvasBundle;
  if (!bundle) return <div className="page-state is-error" role="alert"><strong>Scene chưa sẵn sàng</strong><p>Hãy hoàn tất bước sinh scene trước khi review.</p><button type="button" onClick={() => navigate(projectProductionPath(projectId))}>Quay lại bước trước</button></div>;
  const synchronized = Boolean(project.animationSyncBundle && !animationSyncIsStale(project));
  const outputReady = layoutIsReady(project);
  let narrationAudioUrl = '';
  try {
    narrationAudioUrl = syncPreviewUrl
      ? new URL('audio/narration.wav', syncPreviewUrl).toString()
      : '';
  } catch {
    narrationAudioUrl = '';
  }
  const watermarkImageUrl = watermark.type === 'image' && watermark.assetId
    ? watermarkAssetUrl(projectId, watermark.assetId)
    : '';
  const watermarkValid = RenderWatermarkSchema.safeParse(watermark).success;
  const exportReady = Boolean(
    outputReady &&
      project.layoutBundle &&
      JSON.stringify(project.layoutBundle.renderSettings.watermark) === JSON.stringify(watermark),
  );

  return (
    <main className="scene-review-workspace">
      <header className="scene-review-heading"><span>Bước 04 · Chỉnh scene</span><h1>Chỉnh scene theo giọng đọc</h1><p>Một editor duy nhất: phát hình và tiếng cùng lúc, rồi chỉ sửa các điểm còn lệch. Thay đổi sẽ được đồng bộ lại trước khi xuất video.</p></header>
      {motion.actionError && <p className="submit-error" role="alert">{motion.actionError}</p>}
      {(syncPreviewState === 'loading' || syncPreviewState === 'error') && <p className={syncPreviewState === 'error' ? 'submit-error' : 'scene-review-sync-status'} role={syncPreviewState === 'error' ? 'alert' : 'status'}>{syncPreviewState === 'error' ? `${syncPreviewError} Editor vẫn sẵn sàng để chỉnh hình.` : 'Đang nối giọng ElevenLabs vào editor…'}</p>}
      <div className="scene-review-grid">
        <section className="scene-review-card">
          <header><span>Chỉnh bằng AI</span><h2>Chỉ sửa scene bạn chọn</h2></header>
          <div className="scene-review-list">{bundle.scenes.map((scene, index) => <label key={scene.id}><input type="checkbox" checked={selectedSceneIds.includes(scene.id)} onChange={() => toggle(scene.id)} /><span>{String(index + 1).padStart(2, '0')}</span><strong>{scene.name}</strong><small>{Math.round(scene.durationSeconds)} giây</small></label>)}</div>
          <textarea rows={4} value={guidance} onChange={event => setGuidance(event.currentTarget.value)} placeholder="Ví dụ: Làm phần minh họa mảng trực quan hơn, giữ palette và nhịp chuyển động hiện có." />
          <button className="secondary-button" type="button" disabled={motion.candidateGenerating || selectedSceneIds.length === 0 || guidance.trim().length < 3 || !codex.generationReady} onClick={() => void createCandidate()}>{motion.candidateGenerating ? 'Đang tạo candidate…' : 'Tạo candidate để so sánh'}</button>
          {motion.candidate && <section className="scene-review-candidate"><strong>Candidate mới</strong><p>{motion.candidate.coherence.summary}</p>{motion.candidatePreviewState === 'ready' && motion.candidatePreviewUrl && <iframe title="Preview candidate scene" src={motion.candidatePreviewUrl} />}{motion.candidate.decision === 'pending' && <div><button type="button" disabled={motion.candidateApplying || motion.candidate.status === 'coherence_blocked' || motion.candidate.status === 'scope_expansion_required'} onClick={() => void motion.applyCandidate()}>Áp dụng candidate</button><button type="button" disabled={motion.historyBusy} onClick={() => void motion.rejectCandidate()}>Bỏ candidate</button></div>}</section>}
        </section>
        <aside className="scene-review-side"><CodexConnectionCard connection={codex} task="motionCanvas" workUnits={selectedSceneIds.length || bundle.scenes.length} /><WatermarkSettings watermark={watermark} uploading={watermarkUploading} error={watermarkUploadError} onChange={next => { setWatermarkUploadError(''); setWatermark(next); }} onUpload={uploadWatermark} /><p>Bạn cũng có thể chỉnh trực tiếp màu sắc, chữ, vị trí và chuyển động ở editor bên dưới.</p></aside>
      </div>
      <MotionDesignEditor motionCanvas={motion} narrationAudioUrl={narrationAudioUrl} watermark={watermark} watermarkImageUrl={watermarkImageUrl} />
      <footer className="scene-review-footer"><div><strong>{exportReady ? 'Sẵn sàng xuất video' : synchronized ? 'Chỉnh sửa hình đã lưu' : 'Hình và tiếng đã đồng bộ'}</strong><p>{completionMessage || 'Các chỉnh sửa hình được giữ riêng; voice và timing đã chốt không bị tạo lại.'}</p></div><button className="submit-button" type="button" disabled={syncing || !watermarkValid || motion.candidate?.decision === 'pending'} onClick={() => exportReady ? navigate(projectRenderPath(project.id)) : void approveAndContinue()}>{syncing ? 'Đang chuẩn bị đầu ra…' : exportReady ? 'Xuất video' : 'Hoàn tất & xuất video'}</button></footer>
    </main>
  );
}
