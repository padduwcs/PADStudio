import {useState} from 'react';
import {animationSyncIsStale} from '../shared/projectPipeline.ts';
import {
  approveAnimationSync,
  generateAnimationSync,
  getProject,
} from './api.ts';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {MotionDesignEditor} from './MotionDesignEditor.tsx';
import {navigate, projectProductionPath} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {useMotionCanvasDraft} from './useMotionCanvasDraft.ts';

function isDirect(project: NonNullable<ReturnType<typeof useMotionCanvasDraft>['project']>) {
  return project.outline?.generation.promptVersion === 'direct-narration-v1' &&
    project.voiceVisualPlan?.generation.promptVersion === 'direct-narration-v1';
}

export function SceneReviewPage({projectId}: {projectId: string}) {
  const motion = useMotionCanvasDraft(projectId);
  const codex = useCodexConnection();
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [guidance, setGuidance] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [completionMessage, setCompletionMessage] = useState('');

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

  async function approveAndSynchronize() {
    if (syncing) return;
    setSyncing(true);
    setCompletionMessage('');
    try {
      let current = await getProject(projectId);
      if (!current.motionCanvasBundle || !current.voiceBundle) {
        throw new Error('Audio hoặc scene hiện tại chưa sẵn sàng.');
      }
      if (current.motionCanvasBundle.status !== 'approved') {
        const approved = await motion.approve();
        if (!approved) throw new Error('Không thể chốt scene hiện tại.');
        current = approved;
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
      setCompletionMessage('Scene đã được chốt và đồng bộ tự động với audio thật.');
      motion.reload();
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
  if (!isDirect(project) || !bundle) return <div className="page-state is-error" role="alert"><strong>Scene chưa sẵn sàng</strong><p>Hãy tạo audio và scene từ bản voice đã duyệt trước.</p><button type="button" onClick={() => navigate(projectProductionPath(projectId))}>Quay lại Audio & scene</button></div>;
  const synchronized = project.animationSyncBundle?.status === 'approved' && !animationSyncIsStale(project);

  return (
    <main className="scene-review-workspace">
      <header className="scene-review-heading"><span>Bước 04 · Chỉnh scene</span><h1>Review và chỉnh sửa scene</h1><p>Chọn phần cần đổi để tạo một candidate riêng; bản scene hiện tại luôn được giữ nguyên cho đến khi bạn áp dụng.</p></header>
      {motion.actionError && <p className="submit-error" role="alert">{motion.actionError}</p>}
      <section className="scene-review-preview">
        <header><div><span>Preview scene</span><strong>{bundle.scenes.length} scene · {bundle.width} × {bundle.height}</strong></div><small>{bundle.timingContractVersion === 1 ? 'Timing contract đã sẵn sàng để đồng bộ audio.' : 'Scene thiếu timing contract.'}</small></header>
        {motion.previewState === 'loading' && <div className="page-state"><span className="spinner dark" /><strong>Đang mở preview…</strong></div>}
        {motion.previewState === 'error' && <div className="page-state is-error"><strong>Chưa mở được preview</strong><p>{motion.previewError}</p><button type="button" onClick={motion.retryPreview}>Thử lại</button></div>}
        {motion.previewState === 'ready' && motion.previewUrl && <iframe title="Preview scene" src={motion.previewUrl} />}
      </section>
      <div className="scene-review-grid">
        <section className="scene-review-card">
          <header><span>Chỉnh bằng AI</span><h2>Chỉ sửa scene bạn chọn</h2></header>
          <div className="scene-review-list">{bundle.scenes.map((scene, index) => <label key={scene.id}><input type="checkbox" checked={selectedSceneIds.includes(scene.id)} onChange={() => toggle(scene.id)} /><span>{String(index + 1).padStart(2, '0')}</span><strong>{scene.name}</strong><small>{Math.round(scene.durationSeconds)} giây</small></label>)}</div>
          <textarea rows={4} value={guidance} onChange={event => setGuidance(event.currentTarget.value)} placeholder="Ví dụ: Làm phần minh họa mảng trực quan hơn, giữ palette và nhịp chuyển động hiện có." />
          <button className="secondary-button" type="button" disabled={motion.candidateGenerating || selectedSceneIds.length === 0 || guidance.trim().length < 3 || !codex.generationReady} onClick={() => void createCandidate()}>{motion.candidateGenerating ? 'Đang tạo candidate…' : 'Tạo candidate để so sánh'}</button>
          {motion.candidate && <section className="scene-review-candidate"><strong>Candidate mới</strong><p>{motion.candidate.coherence.summary}</p>{motion.candidatePreviewState === 'ready' && motion.candidatePreviewUrl && <iframe title="Preview candidate scene" src={motion.candidatePreviewUrl} />}{motion.candidate.decision === 'pending' && <div><button type="button" disabled={motion.candidateApplying || motion.candidate.status === 'coherence_blocked' || motion.candidate.status === 'scope_expansion_required'} onClick={() => void motion.applyCandidate()}>Áp dụng candidate</button><button type="button" disabled={motion.historyBusy} onClick={() => void motion.rejectCandidate()}>Bỏ candidate</button></div>}</section>}
        </section>
        <aside className="scene-review-side"><CodexConnectionCard connection={codex} task="motionCanvas" workUnits={selectedSceneIds.length || bundle.scenes.length} /><p>Bạn cũng có thể chỉnh trực tiếp màu sắc, chữ, vị trí và chuyển động ở editor bên dưới.</p></aside>
      </div>
      <MotionDesignEditor motionCanvas={motion} />
      <footer className="scene-review-footer"><div><strong>{synchronized ? 'Đã đồng bộ' : 'Chốt scene để tự động đồng bộ'}</strong><p>{completionMessage || 'Khi chốt, hệ thống dùng timing audio thật để đồng bộ ngay; không có bước review đồng bộ riêng.'}</p></div><button className="submit-button" type="button" disabled={syncing || synchronized || motion.candidate?.decision === 'pending'} onClick={() => void approveAndSynchronize()}>{syncing ? 'Đang chốt và đồng bộ…' : synchronized ? 'Đã hoàn tất' : 'Chốt scene & đồng bộ audio'}</button></footer>
    </main>
  );
}
