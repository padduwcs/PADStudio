import {useEffect, useState, type CSSProperties} from 'react';
import {RenderWatermarkSchema, type RenderWatermark} from '../shared/render.ts';
import {
  animationSyncIsStale,
  layoutIsReady,
  motionCanvasIsStale,
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
import {
  deriveSceneReviewPhase,
  sceneReviewOperationIsBusy,
  sceneReviewOutputIsReady,
  sceneReviewPhaseHasSynchronizedPreview,
  sceneReviewPrimaryAction,
  synchronizedPreviewKey,
} from './sceneReviewFlow.ts';

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
  const [syncPreviewReadyKey, setSyncPreviewReadyKey] = useState('');
  const [syncPreviewError, setSyncPreviewError] = useState('');
  const [syncPreviewRetryKey, setSyncPreviewRetryKey] = useState(0);
  const [editingVisual, setEditingVisual] = useState(false);
  const [watermark, setWatermark] = useState<RenderWatermark>({type: 'none'});
  const [watermarkUploading, setWatermarkUploading] = useState(false);
  const [watermarkUploadError, setWatermarkUploadError] = useState('');
  const syncGenerationId = motion.project?.animationSyncBundle?.generation.generationId ?? '';
  const syncPreviewIsCurrent = Boolean(
    motion.project?.animationSyncBundle &&
      !animationSyncIsStale(motion.project),
  );
  const visualDesignSignature = synchronizedPreviewKey(
    syncGenerationId,
    motion.project?.visualDesignBundle ?? null,
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
      setSyncPreviewReadyKey('');
      setSyncPreviewError('');
      return () => { active = false; };
    }
    setSyncPreviewState('loading');
    setSyncPreviewUrl('');
    setSyncPreviewReadyKey('');
    setSyncPreviewError('');
    void getAnimationSyncPreview(projectId, syncGenerationId)
      .then(preview => {
        if (!active || preview.generationId !== syncGenerationId) return;
        setSyncPreviewUrl(preview.url);
        setSyncPreviewReadyKey(visualDesignSignature);
        setSyncPreviewState('ready');
      })
      .catch(error => {
        if (!active) return;
        setSyncPreviewReadyKey('');
        setSyncPreviewError(error instanceof ApiRequestError ? error.message : 'Không thể mở preview đã đồng bộ.');
        setSyncPreviewState('error');
      });
    return () => { active = false; };
  }, [
    projectId,
    syncGenerationId,
    syncPreviewIsCurrent,
    syncPreviewRetryKey,
    visualDesignSignature,
  ]);

  function toggle(sceneId: string) {
    setSelectedSceneIds(current => current.includes(sceneId)
      ? current.filter(item => item !== sceneId)
      : [...current, sceneId]);
  }

  async function createCandidate() {
    if (!guidance.trim() || selectedSceneIds.length === 0) return;
    const status = await codex.verify();
    if (status?.state !== 'connected') return;
    const selection = codex.getGenerationSelection('motionCanvas');
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

  async function approveMotionAndGenerateSync() {
    if (sceneReviewOperationIsBusy({
      syncing,
      designSaveState: motion.designSaveState,
      candidateGenerating: motion.candidateGenerating,
      candidateRepairing: motion.candidateRepairing,
      candidateApplying: motion.candidateApplying,
      candidatePending: motion.candidate?.decision === 'pending',
      historyBusy: motion.historyBusy,
    })) return;
    setSyncing(true);
    setCompletionMessage('');
    try {
      let current = await getProject(projectId);
      if (!current.motionCanvasBundle) {
        throw new Error('Scene hiện tại chưa sẵn sàng.');
      }
      if (motionCanvasIsStale(current)) {
        motion.adoptProject(current);
        throw new Error('Scene không còn khớp với nguồn hiện tại. Hãy sinh lại ở bước sản xuất trước khi duyệt.');
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
        motion.adoptProject(current);
        setEditingVisual(false);
        setCompletionMessage('Bản nháp đồng bộ đã sẵn sàng. Hãy xem hình và tiếng trước khi tiếp tục.');
        return;
      }
      motion.adoptProject(current);
      setEditingVisual(false);
      setCompletionMessage('Bản đồng bộ hiện hành đã sẵn sàng để review.');
    } catch (error) {
      setCompletionMessage(error instanceof Error ? error.message : 'Không thể đồng bộ scene và audio lúc này.');
    } finally {
      setSyncing(false);
    }
  }

  if (motion.loadState === 'loading') return <div className="page-state" role="status"><span className="spinner dark" /><strong>Đang mở scene để review…</strong></div>;
  if (!motion.project || motion.loadState === 'error') return <div className="page-state is-error" role="alert"><strong>Không thể mở scene</strong><p>{motion.loadError}</p></div>;
  async function approveSyncAndContinue() {
    if (sceneReviewOperationIsBusy({
      syncing,
      designSaveState: motion.designSaveState,
      candidateGenerating: motion.candidateGenerating,
      candidateRepairing: motion.candidateRepairing,
      candidateApplying: motion.candidateApplying,
      candidatePending: motion.candidate?.decision === 'pending',
      historyBusy: motion.historyBusy,
    })) return;
    setSyncing(true);
    setCompletionMessage('');
    try {
      let current = await getProject(projectId);
      if (!current.animationSyncBundle || animationSyncIsStale(current)) {
        throw new Error('Bản đồng bộ hiện tại chưa sẵn sàng. Hãy tạo lại và xem preview trước.');
      }
      if (current.animationSyncBundle.status !== 'approved') {
        current = await approveAnimationSync(current.id, current.revision);
      }
      current = await prepareProjectOutput(
        current.id,
        {generationId: crypto.randomUUID(), renderSettings: {watermark}},
        current.revision,
      );
      motion.adoptProject(current);
      navigate(projectRenderPath(current.id));
    } catch (error) {
      setCompletionMessage(error instanceof Error ? error.message : 'Không thể chuẩn bị đầu ra từ bản đồng bộ hiện tại.');
    } finally {
      setSyncing(false);
    }
  }

  const project = motion.project;
  const bundle = project.motionCanvasBundle;
  if (!bundle) return <div className="page-state is-error" role="alert"><strong>Scene chưa sẵn sàng</strong><p>Hãy hoàn tất bước sinh scene trước khi review.</p><button type="button" onClick={() => navigate(projectProductionPath(projectId))}>Quay lại bước trước</button></div>;
  const syncStale = Boolean(
    project.animationSyncBundle && animationSyncIsStale(project),
  );
  const outputArtifactReady = layoutIsReady(project);
  const watermarkValid = RenderWatermarkSchema.safeParse(watermark).success;
  const exportReady = sceneReviewOutputIsReady(
    project.layoutBundle,
    outputArtifactReady,
    watermark,
  );
  const phase = deriveSceneReviewPhase({
    motion: bundle,
    motionStale: motion.stale,
    sync: project.animationSyncBundle,
    syncStale,
    layoutReady: exportReady,
  });
  const canReviewSync = sceneReviewPhaseHasSynchronizedPreview(phase);
  const showSyncPreview = canReviewSync && !editingVisual && !motion.candidate;
  const syncPreviewReady = Boolean(
    syncPreviewState === 'ready' &&
      syncPreviewUrl &&
      syncPreviewReadyKey === visualDesignSignature,
  );
  const syncPreviewLoading = Boolean(
    syncPreviewIsCurrent && !syncPreviewReady && syncPreviewState !== 'error',
  );
  const watermarkImageUrl = watermark.type === 'image' && watermark.assetId
    ? watermarkAssetUrl(projectId, watermark.assetId)
    : '';
  const layoutNeedsWatermarkRefresh = outputArtifactReady && !exportReady;
  const sceneOperationBusy = sceneReviewOperationIsBusy({
    syncing,
    designSaveState: motion.designSaveState,
    candidateGenerating: motion.candidateGenerating,
    candidateRepairing: motion.candidateRepairing,
    candidateApplying: motion.candidateApplying,
    candidatePending: motion.candidate?.decision === 'pending',
    historyBusy: motion.historyBusy,
  });
  const footerTitle = phase === 'motion-stale'
    ? 'Scene không còn khớp với nguồn hiện tại'
    : phase === 'motion-draft'
    ? 'Scene chưa được đồng bộ với audio'
    : phase === 'sync-required'
      ? 'Scene đã duyệt nhưng cần tạo bản đồng bộ'
      : phase === 'sync-draft'
        ? 'Bản nháp hình và tiếng sẵn sàng để duyệt'
        : phase === 'sync-approved'
          ? layoutNeedsWatermarkRefresh
            ? 'Watermark đã đổi, cần cập nhật đầu ra'
            : 'Bản đồng bộ đã duyệt, chưa chuẩn bị đầu ra'
          : 'Sẵn sàng xuất video';
  const footerDescription = completionMessage || (
    phase === 'motion-stale'
      ? 'Scene đã stale so với voice–visual source hiện tại. Hãy quay lại bước sản xuất để sinh lại.'
      : phase === 'motion-draft' || phase === 'sync-required'
      ? 'Visual editor này chỉ xem hình; audio chỉ xuất hiện trong bản preview đồng bộ.'
      : 'Preview này chạy hình và narration từ cùng một Animation Sync workspace.'
  );
  const primaryLabel = phase === 'motion-stale'
    ? 'Quay lại bước sản xuất'
    : phase === 'motion-draft'
    ? 'Duyệt scene & tạo bản đồng bộ'
    : phase === 'sync-required'
      ? project.animationSyncBundle ? 'Đồng bộ lại' : 'Tạo bản đồng bộ'
      : phase === 'sync-draft'
        ? 'Duyệt bản đồng bộ & tiếp tục'
        : phase === 'sync-approved'
          ? 'Chuẩn bị đầu ra & tiếp tục'
          : 'Xuất video';
  const footerTitleText = footerTitle;
  const primaryButtonLabel = phase === 'sync-approved' && layoutNeedsWatermarkRefresh
    ? 'Cập nhật đầu ra với watermark mới & tiếp tục'
    : primaryLabel;
  const previewReviewRequired = phase === 'sync-draft' || phase === 'sync-approved';
  const primaryDisabled = sceneOperationBusy || watermarkUploading || !watermarkValid || (previewReviewRequired && (editingVisual || !syncPreviewReady));

  function handlePrimaryAction() {
    const action = sceneReviewPrimaryAction(phase);
    if (action === 'back-to-production') {
      navigate(projectProductionPath(project.id));
      return;
    }
    if (action === 'navigate-to-render') {
      navigate(projectRenderPath(project.id));
      return;
    }
    if (action === 'approve-sync-and-prepare-output') {
      void approveSyncAndContinue();
      return;
    }
    void approveMotionAndGenerateSync();
  }

  return (
    <main className="scene-review-workspace">
      <div className="page-heading">
        <div className="eyebrow">
          <span>Bước 04 · Chỉnh scene</span>
          <div className="eyebrow-line" />
        </div>
        <h1>Chỉnh scene theo giọng đọc</h1>
        <p>Chỉnh hình ở Motion Canvas trước, rồi review hình và tiếng từ bản Animation Sync đã retime trước khi xuất video.</p>
      </div>
      {motion.actionError && <p className="submit-error" role="alert">{motion.actionError}</p>}
      {motion.designSaveState === 'error' && <p className="submit-error" role="alert">Không lưu được chỉnh sửa visual mới nhất. Preview đồng bộ chỉ phản ánh bản đã lưu trước đó.</p>}
      {!showSyncPreview && (phase === 'motion-draft' || phase === 'motion-stale' || phase === 'sync-required') && <p className="scene-review-sync-status" role="status">{phase === 'motion-stale' ? 'Scene không còn khớp với nguồn hiện tại; không thể duyệt hoặc đồng bộ từ bản này.' : 'Scene chưa được đồng bộ với audio. Visual editor bên dưới chỉ preview hình.'}</p>}
      <div className="scene-review-grid">
        <section className="scene-review-card">
          <header><span>Chỉnh bằng AI</span><h2>Chỉ sửa scene bạn chọn</h2></header>
          <div className="scene-review-list">{bundle.scenes.map((scene, index) => <label key={scene.id}><input type="checkbox" checked={selectedSceneIds.includes(scene.id)} onChange={() => toggle(scene.id)} /><span>{String(index + 1).padStart(2, '0')}</span><strong>{scene.name}</strong><small>{Math.round(scene.durationSeconds)} giây</small></label>)}</div>
          <textarea rows={4} value={guidance} onChange={event => setGuidance(event.currentTarget.value)} placeholder="Ví dụ: Làm phần minh họa mảng trực quan hơn, giữ palette và nhịp chuyển động hiện có." />
          <button className="secondary-button" type="button" disabled={motion.candidateGenerating || selectedSceneIds.length === 0 || guidance.trim().length < 3 || !codex.isTaskReady('motionCanvas')} onClick={() => void createCandidate()}>{motion.candidateGenerating ? 'Đang tạo candidate…' : 'Tạo candidate để so sánh'}</button>
          {motion.candidate && <section className="scene-review-candidate"><strong>Candidate mới</strong><p>{motion.candidate.coherence.summary}</p>{motion.candidatePreviewState === 'ready' && motion.candidatePreviewUrl && <iframe title="Preview candidate scene" src={motion.candidatePreviewUrl} />}{motion.candidate.decision === 'pending' && <div><button type="button" disabled={motion.candidateApplying || motion.candidate.status === 'coherence_blocked' || motion.candidate.status === 'scope_expansion_required'} onClick={() => void motion.applyCandidate()}>Áp dụng candidate</button><button type="button" disabled={motion.historyBusy} onClick={() => void motion.rejectCandidate()}>Bỏ candidate</button></div>}</section>}
        </section>
        <aside className="scene-review-side"><CodexConnectionCard connection={codex} task="motionCanvas" workUnits={selectedSceneIds.length || bundle.scenes.length} /><WatermarkSettings watermark={watermark} uploading={watermarkUploading} error={watermarkUploadError} onChange={next => { setWatermarkUploadError(''); setWatermark(next); }} onUpload={uploadWatermark} /><p>Bạn cũng có thể chỉnh trực tiếp màu sắc, chữ, vị trí và chuyển động ở editor bên dưới.</p></aside>
      </div>
      {showSyncPreview ? (
        <section className="scene-review-sync-preview" aria-label="Bản nháp Animation Sync">
          <header>
            <span>Animation Sync</span>
            <h2>Review hình và tiếng</h2>
            <p>Player này sử dụng scene đã retime và narration.wav của cùng một Sync generation.</p>
          </header>
          {syncPreviewLoading && <div className="scene-review-sync-state" role="status"><span className="spinner dark" /><strong>Đang mở bản preview đã đồng bộ…</strong></div>}
          {syncPreviewState === 'error' && <div className="scene-review-sync-state is-error" role="alert"><strong>Không thể mở bản preview đồng bộ</strong><p>{syncPreviewError}</p><button className="secondary-button" type="button" onClick={() => setSyncPreviewRetryKey(current => current + 1)}>Thử lại</button></div>}
          {syncPreviewReady && <div className="scene-review-sync-frame"><iframe title="Preview Animation Sync có hình và tiếng" src={syncPreviewUrl} allow="autoplay; fullscreen" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" allowFullScreen />{watermark.type === 'text' && <div className="motion-design-watermark" style={{'--watermark-x': `${watermark.xPercent}%`, '--watermark-y': `${watermark.yPercent}%`, '--watermark-opacity': watermark.opacity, '--watermark-size': `${watermark.fontSize}px`, color: watermark.color} as CSSProperties}>{watermark.text}</div>}{watermark.type === 'image' && watermarkImageUrl && <div className="motion-design-watermark is-image" style={{'--watermark-x': `${watermark.xPercent}%`, '--watermark-y': `${watermark.yPercent}%`, '--watermark-opacity': watermark.opacity, '--watermark-width': `${watermark.widthPercent}%`} as CSSProperties}><img src={watermarkImageUrl} alt="Watermark" /></div>}</div>}
          <button className="secondary-button" type="button" disabled={sceneOperationBusy} onClick={() => setEditingVisual(true)}>Chỉnh lại hình</button>
        </section>
      ) : (
        <>
          {canReviewSync && <button className="secondary-button scene-review-return-sync" type="button" disabled={sceneOperationBusy} onClick={() => setEditingVisual(false)}>Xem lại bản đồng bộ</button>}
          <MotionDesignEditor motionCanvas={motion} watermark={watermark} watermarkImageUrl={watermarkImageUrl} />
        </>
      )}
      <footer className="scene-review-footer"><div><strong>{footerTitleText}</strong><p>{footerDescription}</p></div><button className="submit-button" type="button" disabled={primaryDisabled} onClick={handlePrimaryAction}>{syncing ? 'Đang xử lý…' : primaryButtonLabel}</button></footer>
    </main>
  );
}
