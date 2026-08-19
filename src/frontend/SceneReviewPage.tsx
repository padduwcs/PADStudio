import {useEffect, useRef, useState} from 'react';
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
  getProject,
  uploadWatermarkImage,
  watermarkAssetUrl,
} from './api.ts';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {SceneSyncEditor} from './SceneSyncEditor.tsx';
import {
  navigate,
  projectProductionPath,
  projectRenderPath,
} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {useMotionCanvasDraft} from './useMotionCanvasDraft.ts';
import {useSyncSceneEditor} from './useSyncSceneEditor.ts';
import {
  deriveSceneReviewPhase,
  sceneReviewOperationIsBusy,
  sceneReviewPrimaryAction,
  type SceneReviewPhase,
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
  const syncEditor = useSyncSceneEditor(projectId, motion);
  const codex = useCodexConnection();
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [guidance, setGuidance] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [completionMessage, setCompletionMessage] = useState('');
  const [watermark, setWatermark] = useState<RenderWatermark>({type: 'none'});
  const [watermarkUploading, setWatermarkUploading] = useState(false);
  const [watermarkUploadError, setWatermarkUploadError] = useState('');
  const synchronizationAttemptRevision = useRef<number | null>(null);

  useEffect(() => {
    const existing = motion.project?.layoutBundle?.renderSettings.watermark;
    if (!existing) return;
    setWatermark(current =>
      JSON.stringify(current) === JSON.stringify(existing) ? current : existing,
    );
  }, [motion.project?.layoutBundle?.renderSettings.watermark]);

  function toggle(sceneId: string) {
    setSelectedSceneIds(current => current.includes(sceneId)
      ? current.filter(item => item !== sceneId)
      : [...current, sceneId]);
  }

  function applyCandidateWithGuard(phase: SceneReviewPhase) {
    if (
      (phase === 'editing' || phase === 'layout-ready') &&
      !window.confirm(
        'Áp dụng candidate sẽ xóa toàn bộ chỉnh sửa Layout hiện có. Scene sẽ được tự đồng bộ lại với giọng đọc trước khi bạn chỉnh tiếp. Tiếp tục?',
      )
    ) {
      return;
    }
    void motion.applyCandidate();
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

  function operationState() {
    return {
      syncing,
      layoutSaveState: syncEditor.saveState,
      candidateGenerating: motion.candidateGenerating,
      candidateRepairing: motion.candidateRepairing,
      candidateApplying: motion.candidateApplying,
      candidatePending: motion.candidate?.decision === 'pending',
      historyBusy: motion.historyBusy,
    };
  }

  async function prepareSyncedEditor() {
    if (sceneReviewOperationIsBusy(operationState())) return;
    setSyncing(true);
    setCompletionMessage('');
    try {
      let current = await getProject(projectId);
      if (!current.motionCanvasBundle) {
        throw new Error('Scene hiện tại chưa sẵn sàng.');
      }
      if (motionCanvasIsStale(current)) {
        motion.adoptProject(current);
        throw new Error('Scene không còn khớp với nguồn hiện tại. Hãy quay lại bước sản xuất để sinh lại.');
      }
      motion.adoptProject(current);
      if (current.motionCanvasBundle.status !== 'approved') {
        const approved = await motion.approve();
        if (!approved) throw new Error('Không thể chuẩn bị scene hiện tại.');
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
      motion.adoptProject(current);
      setCompletionMessage('Editor đã sẵn sàng với scene và giọng đọc đồng bộ.');
    } catch (error) {
      setCompletionMessage(error instanceof Error ? error.message : 'Không thể chuẩn bị editor có tiếng lúc này.');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    const project = motion.project;
    const sync = project?.animationSyncBundle;
    const needsPreparation = Boolean(
      project?.motionCanvasBundle &&
        !motion.stale &&
        (project.motionCanvasBundle.status !== 'approved' ||
          !sync ||
          sync.status !== 'approved' ||
          animationSyncIsStale(project)),
    );
    if (
      !needsPreparation ||
      synchronizationAttemptRevision.current === project?.revision ||
      sceneReviewOperationIsBusy(operationState())
    ) return;
    synchronizationAttemptRevision.current = project!.revision;
    void prepareSyncedEditor();
  }, [
    motion.candidate?.decision,
    motion.candidateApplying,
    motion.candidateGenerating,
    motion.candidateRepairing,
    motion.historyBusy,
    motion.project?.revision,
    motion.stale,
    projectId,
    syncing,
  ]);

  if (motion.loadState === 'loading') return <div className="page-state" role="status"><span className="spinner dark" /><strong>Đang mở scene để review…</strong></div>;
  if (!motion.project || motion.loadState === 'error') return <div className="page-state is-error" role="alert"><strong>Không thể mở scene</strong><p>{motion.loadError}</p></div>;

  async function approveLayoutAndContinue() {
    if (sceneReviewOperationIsBusy(operationState())) return;
    setSyncing(true);
    setCompletionMessage('');
    try {
      const approved = await syncEditor.approve();
      if (!approved) {
        throw new Error(syncEditor.saveError || 'Không thể duyệt bản chỉnh sửa hiện tại.');
      }
      navigate(projectRenderPath(approved.id));
    } catch (error) {
      setCompletionMessage(error instanceof Error ? error.message : 'Không thể duyệt bản chỉnh sửa hiện tại.');
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
  const layoutReady = layoutIsReady(project);
  const watermarkValid = RenderWatermarkSchema.safeParse(watermark).success;
  const phase = deriveSceneReviewPhase({
    motion: bundle,
    motionStale: motion.stale,
    sync: project.animationSyncBundle,
    syncStale,
    layoutReady,
  });
  const showEditor = phase === 'editing' || phase === 'layout-ready';
  const watermarkImageUrl = watermark.type === 'image' && watermark.assetId
    ? watermarkAssetUrl(projectId, watermark.assetId)
    : '';
  const sceneOperationBusy = sceneReviewOperationIsBusy(operationState());
  const footerTitle = phase === 'motion-stale'
    ? 'Scene không còn khớp với nguồn hiện tại'
    : phase === 'preparing-sync'
      ? 'Đang chuẩn bị editor có tiếng'
        : phase === 'editing'
          ? 'Đang chỉnh scene — chưa duyệt bản chỉnh sửa'
          : 'Sẵn sàng xuất video';
  const footerDescription = completionMessage || (
    phase === 'motion-stale'
      ? 'Scene đã stale so với voice–visual source hiện tại. Hãy quay lại bước sản xuất để sinh lại.'
      : phase === 'preparing-sync'
        ? 'Scene đang được tự động ghép theo timing giọng đọc trước khi mở editor.'
        : 'Editor bên dưới chạy trên scene đã đồng bộ với giọng đọc thật. Chỉnh xong hãy duyệt để xuất video.'
  );
  const primaryLabel = phase === 'motion-stale'
    ? 'Quay lại bước sản xuất'
    : phase === 'preparing-sync'
      ? 'Đang chuẩn bị editor…'
        : phase === 'editing'
          ? 'Duyệt bản chỉnh sửa & tiếp tục'
          : 'Xuất video';
  const primaryDisabled = phase === 'preparing-sync' || sceneOperationBusy || watermarkUploading || !watermarkValid || (phase === 'editing' && (!project.layoutBundle || syncEditor.hasUnsavedChanges));

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
    if (action === 'approve-layout-and-continue') {
      void approveLayoutAndContinue();
      return;
    }
  }

  return (
    <main className="scene-review-workspace">
      <div className="page-heading">
        <div className="eyebrow">
          <span>Bước 04 · Chỉnh scene</span>
          <div className="eyebrow-line" />
        </div>
        <h1>Chỉnh scene theo giọng đọc</h1>
        <p>Chỉnh layer, chữ, vị trí và chuyển động ngay trên scene đã đồng bộ — nghe giọng đọc thật trong lúc chỉnh, rồi duyệt một lần khi hoàn tất.</p>
      </div>
      {motion.actionError && <p className="submit-error" role="alert">{motion.actionError}</p>}
      {syncEditor.saveError && <p className="submit-error" role="alert">Không lưu được chỉnh sửa scene mới nhất: {syncEditor.saveError}</p>}
      {!showEditor && (phase === 'preparing-sync' || phase === 'motion-stale') && <p className="scene-review-sync-status" role="status">{phase === 'motion-stale' ? 'Scene không còn khớp với nguồn hiện tại; hãy sinh lại ở bước sản xuất.' : 'Đang tự động chuẩn bị scene với giọng đọc đồng bộ. Editor sẽ mở ngay khi hoàn tất.'}</p>}
      <div className="scene-review-grid">
        <section className="scene-review-card">
          <header><span>Chỉnh bằng AI</span><h2>Chỉ sửa scene bạn chọn</h2></header>
          <div className="scene-review-list">{bundle.scenes.map((scene, index) => <label key={scene.id}><input type="checkbox" disabled={!showEditor} checked={selectedSceneIds.includes(scene.id)} onChange={() => toggle(scene.id)} /><span>{String(index + 1).padStart(2, '0')}</span><strong>{scene.name}</strong><small>{Math.round(scene.durationSeconds)} giây</small></label>)}</div>
          <textarea rows={4} value={guidance} disabled={!showEditor} onChange={event => setGuidance(event.currentTarget.value)} placeholder="Ví dụ: Làm phần minh họa mảng trực quan hơn, giữ palette và nhịp chuyển động hiện có." />
          <button className="secondary-button" type="button" disabled={!showEditor || motion.candidateGenerating || selectedSceneIds.length === 0 || guidance.trim().length < 3 || !codex.isTaskReady('motionCanvas')} onClick={() => void createCandidate()}>{motion.candidateGenerating ? 'Đang tạo candidate…' : 'Tạo candidate để so sánh'}</button>
          {motion.candidate && <section className="scene-review-candidate"><strong>Candidate mới</strong><p>{motion.candidate.coherence.summary}</p>{motion.candidatePreviewState === 'ready' && motion.candidatePreviewUrl && <iframe title="Preview candidate scene" src={motion.candidatePreviewUrl} />}{motion.candidate.decision === 'pending' && <div><button type="button" disabled={motion.candidateApplying || motion.candidate.status === 'coherence_blocked' || motion.candidate.status === 'scope_expansion_required'} onClick={() => applyCandidateWithGuard(phase)}>Áp dụng candidate</button><button type="button" disabled={motion.historyBusy} onClick={() => void motion.rejectCandidate()}>Bỏ candidate</button></div>}</section>}
        </section>
        <aside className="scene-review-side"><CodexConnectionCard connection={codex} task="motionCanvas" workUnits={selectedSceneIds.length || bundle.scenes.length} /><WatermarkSettings watermark={watermark} uploading={watermarkUploading} error={watermarkUploadError} onChange={next => { setWatermarkUploadError(''); setWatermark(next); }} onUpload={uploadWatermark} /><p>{showEditor ? 'Chỉnh trực tiếp màu sắc, chữ, vị trí và chuyển động ở editor bên dưới — thay đổi được tự lưu.' : 'Watermark sẽ áp dụng khi editor có tiếng sẵn sàng.'}</p></aside>
      </div>
      {showEditor ? (
        <SceneSyncEditor motionCanvas={motion} syncEditor={syncEditor} watermark={watermark} watermarkImageUrl={watermarkImageUrl} />
      ) : <section className="scene-review-sync-status" aria-live="polite"><span className="spinner dark" /><strong>{phase === 'motion-stale' ? 'Scene cần được sinh lại trước khi mở editor.' : 'Đang mở editor với scene và giọng đọc đồng bộ…'}</strong>{phase === 'preparing-sync' && !syncing && completionMessage && <button className="secondary-button" type="button" onClick={() => { synchronizationAttemptRevision.current = motion.project?.revision ?? null; void prepareSyncedEditor(); }}>Thử lại</button>}</section>}
      <footer className="scene-review-footer"><div><strong>{footerTitle}</strong><p>{footerDescription}</p></div><button className="submit-button" type="button" disabled={primaryDisabled} onClick={handlePrimaryAction}>{syncing ? 'Đang xử lý…' : primaryLabel}</button></footer>
    </main>
  );
}
