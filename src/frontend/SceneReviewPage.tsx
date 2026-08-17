import {useEffect, useRef, useState} from 'react';
import {RenderWatermarkSchema, type RenderWatermark} from '../shared/render.ts';
import {
  animationSyncIsStale,
  isDirectNarrationProject,
  layoutIsReady,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  approveAnimationSync,
  approveMotionCanvas,
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
  projectVoicePath,
  projectVoiceVisualPath,
} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {useMotionCanvasDraft} from './useMotionCanvasDraft.ts';

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
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [watermark, setWatermark] = useState<RenderWatermark>({type: 'none'});
  const [watermarkUploading, setWatermarkUploading] = useState(false);
  const [watermarkUploadError, setWatermarkUploadError] = useState('');
  const autoSyncedRevision = useRef<number | null>(null);
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

  // Chỉnh trực tiếp trong editor chỉ tạo visual override. Khi người dùng dừng
  // chỉnh, cập nhật preview hình + tiếng ngay tại đây thay vì đẩy họ sang một
  // bước Sync riêng. Đây là tác vụ cục bộ, không gọi Codex hay ElevenLabs.
  useEffect(() => {
    const current = motion.project;
    const needsRefresh = Boolean(
      current &&
        isDirectNarrationProject(current) &&
        current.motionCanvasBundle &&
        current.voiceBundle &&
        (!current.animationSyncBundle || animationSyncIsStale(current)) &&
        motion.candidate?.decision !== 'pending',
    );
    if (
      !needsRefresh ||
      !current ||
      autoSyncing ||
      autoSyncedRevision.current === current.revision
    ) {
      return;
    }
    let active = true;
    const scheduledRevision = current.revision;
    const timer = window.setTimeout(() => {
      void (async () => {
        autoSyncedRevision.current = scheduledRevision;
        setAutoSyncing(true);
        try {
          let latest = await getProject(projectId);
          if (
            !isDirectNarrationProject(latest) ||
            !latest.motionCanvasBundle ||
            !latest.voiceBundle ||
            (latest.animationSyncBundle && !animationSyncIsStale(latest))
          ) {
            return;
          }
          if (latest.motionCanvasBundle?.status !== 'approved') {
            latest = await approveMotionCanvas(latest.id, latest.revision);
          }
          latest = await generateAnimationSync(
            latest.id,
            {generationId: crypto.randomUUID()},
            latest.revision,
          );
          if (!active) return;
          setCompletionMessage('Preview hình + tiếng đã được cập nhật theo chỉnh sửa mới.');
          motion.reload();
        } catch (error) {
          if (!active) return;
          setCompletionMessage(error instanceof Error ? error.message : 'Không thể cập nhật preview hình + tiếng.');
        } finally {
          if (active) setAutoSyncing(false);
        }
      })();
    }, 900);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [autoSyncing, motion.candidate?.decision, motion.project, motion.reload, projectId]);

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

  function selectWatermarkType(type: RenderWatermark['type']) {
    setWatermarkUploadError('');
    setWatermark(type === 'text'
      ? {type: 'text', text: 'Tên kênh', opacity: 0.35, xPercent: 88, yPercent: 92, fontSize: 42, color: '#ffffff'}
      : type === 'image'
        ? {type: 'image', assetId: '', opacity: 0.35, xPercent: 88, yPercent: 92, widthPercent: 22, tintColor: '#FFFFFF', tintStrength: 0}
        : {type: 'none'});
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
      if (!isDirectNarrationProject(current)) {
        setCompletionMessage('Scene đã được chốt. Tiếp tục tạo voice ElevenLabs.');
        navigate(projectVoicePath(current.id));
        return;
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
  if (!bundle) return <div className="page-state is-error" role="alert"><strong>Scene chưa sẵn sàng</strong><p>Hãy hoàn tất bước sinh scene trước khi review.</p><button type="button" onClick={() => navigate(isDirectNarrationProject(project) ? projectProductionPath(projectId) : projectVoiceVisualPath(projectId))}>Quay lại bước trước</button></div>;
  const direct = isDirectNarrationProject(project);
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
      {(autoSyncing || syncPreviewState === 'loading' || syncPreviewState === 'error') && <p className={syncPreviewState === 'error' ? 'submit-error' : 'scene-review-sync-status'} role={syncPreviewState === 'error' ? 'alert' : 'status'}>{syncPreviewState === 'error' ? `${syncPreviewError} Editor vẫn sẵn sàng để chỉnh hình.` : autoSyncing ? 'Đang cập nhật hình và tiếng theo chỉnh sửa mới…' : 'Đang nối giọng ElevenLabs vào editor…'}</p>}
      <div className="scene-review-grid">
        <section className="scene-review-card">
          <header><span>Chỉnh bằng AI</span><h2>Chỉ sửa scene bạn chọn</h2></header>
          <div className="scene-review-list">{bundle.scenes.map((scene, index) => <label key={scene.id}><input type="checkbox" checked={selectedSceneIds.includes(scene.id)} onChange={() => toggle(scene.id)} /><span>{String(index + 1).padStart(2, '0')}</span><strong>{scene.name}</strong><small>{Math.round(scene.durationSeconds)} giây</small></label>)}</div>
          <textarea rows={4} value={guidance} onChange={event => setGuidance(event.currentTarget.value)} placeholder="Ví dụ: Làm phần minh họa mảng trực quan hơn, giữ palette và nhịp chuyển động hiện có." />
          <button className="secondary-button" type="button" disabled={motion.candidateGenerating || selectedSceneIds.length === 0 || guidance.trim().length < 3 || !codex.generationReady} onClick={() => void createCandidate()}>{motion.candidateGenerating ? 'Đang tạo candidate…' : 'Tạo candidate để so sánh'}</button>
          {motion.candidate && <section className="scene-review-candidate"><strong>Candidate mới</strong><p>{motion.candidate.coherence.summary}</p>{motion.candidatePreviewState === 'ready' && motion.candidatePreviewUrl && <iframe title="Preview candidate scene" src={motion.candidatePreviewUrl} />}{motion.candidate.decision === 'pending' && <div><button type="button" disabled={motion.candidateApplying || motion.candidate.status === 'coherence_blocked' || motion.candidate.status === 'scope_expansion_required'} onClick={() => void motion.applyCandidate()}>Áp dụng candidate</button><button type="button" disabled={motion.historyBusy} onClick={() => void motion.rejectCandidate()}>Bỏ candidate</button></div>}</section>}
        </section>
        <aside className="scene-review-side"><CodexConnectionCard connection={codex} task="motionCanvas" workUnits={selectedSceneIds.length || bundle.scenes.length} /><details className="scene-review-watermark" open><summary><span>Đầu ra</span><strong>Watermark</strong><small>{watermark.type === 'none' ? 'Không dùng' : watermark.type === 'text' ? 'Chữ' : 'Ảnh'}</small></summary><div><label><span>Loại</span><select value={watermark.type} onChange={event => selectWatermarkType(event.currentTarget.value as RenderWatermark['type'])}><option value="none">Không dùng</option><option value="text">Chữ</option><option value="image">Ảnh</option></select></label>{watermark.type === 'text' && <><label><span>Nội dung</span><input value={watermark.text} onChange={event => setWatermark({...watermark, text: event.currentTarget.value})} placeholder="Tên kênh" /></label><label><span>Màu</span><input type="color" value={watermark.color} onChange={event => setWatermark({...watermark, color: event.currentTarget.value})} /></label></>}{watermark.type === 'image' && <label><span>Ảnh PNG, JPEG hoặc WebP</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={watermarkUploading} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) uploadWatermark(file); }} /><small>{watermarkUploading ? 'Đang tải ảnh…' : watermark.assetId ? 'Ảnh đã sẵn sàng.' : 'Chưa chọn ảnh.'}</small></label>}{watermark.type !== 'none' && <><label><span>Độ mờ</span><input type="range" min={0} max={1} step={0.05} value={watermark.opacity} onChange={event => setWatermark({...watermark, opacity: Number(event.currentTarget.value)})} /></label><label><span>Vị trí ngang</span><input type="range" min={0} max={100} step={1} value={watermark.xPercent} onChange={event => setWatermark({...watermark, xPercent: Number(event.currentTarget.value)})} /></label><label><span>Vị trí dọc</span><input type="range" min={0} max={100} step={1} value={watermark.yPercent} onChange={event => setWatermark({...watermark, yPercent: Number(event.currentTarget.value)})} /></label></>}{watermarkUploadError && <p className="submit-error" role="alert">{watermarkUploadError}</p>}</div></details><p>Bạn cũng có thể chỉnh trực tiếp màu sắc, chữ, vị trí và chuyển động ở editor bên dưới.</p></aside>
      </div>
      <MotionDesignEditor motionCanvas={motion} narrationAudioUrl={narrationAudioUrl} watermark={watermark} watermarkImageUrl={watermarkImageUrl} />
      <footer className="scene-review-footer"><div><strong>{direct ? exportReady ? 'Sẵn sàng xuất video' : autoSyncing ? 'Đang cập nhật hình và tiếng' : synchronized ? 'Hình và tiếng đã đồng bộ' : 'Thay đổi sẽ được đồng bộ lại' : 'Chốt scene để tạo voice'}</strong><p>{completionMessage || (direct ? 'Hoàn tất sẽ chốt scene, cập nhật đồng bộ nếu cần và chuẩn bị đầu ra tự động.' : 'Scene đã được review trong cùng màn hình này. Sau khi chốt, bạn sẽ tiếp tục tạo voice ElevenLabs.')}</p></div><button className="submit-button" type="button" disabled={syncing || autoSyncing || !watermarkValid || motion.candidate?.decision === 'pending'} onClick={() => exportReady ? navigate(projectRenderPath(project.id)) : void approveAndContinue()}>{syncing ? direct ? 'Đang chuẩn bị đầu ra…' : 'Đang chốt…' : autoSyncing ? 'Đang cập nhật preview…' : direct ? exportReady ? 'Xuất video' : 'Hoàn tất & xuất video' : 'Chốt scene & tạo voice'}</button></footer>
    </main>
  );
}
