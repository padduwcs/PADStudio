import {useEffect, useState} from 'react';
import {AdaptiveHeading} from './AdaptiveText.tsx';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  LayersIcon,
  LightbulbIcon,
  SparkIcon,
} from './icons.tsx';
import {
  navigate,
  projectVoicePath,
  projectVoiceVisualPath,
} from './router.ts';
import {ResponsiveAside} from './ResponsiveAside.tsx';
import {useCodexConnection} from './useCodexConnection.ts';
import {motionCanvasReviewerRepair} from './motionCanvasCandidateRepair.ts';
import {useMotionCanvasDraft} from './useMotionCanvasDraft.ts';
import {MotionDesignEditor} from './MotionDesignEditor.tsx';

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function MotionCanvasPage({projectId}: {projectId: string}) {
  const motionCanvas = useMotionCanvasDraft(projectId);
  const codexConnection = useCodexConnection();
  const [guidance, setGuidance] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [checkpointLabel, setCheckpointLabel] = useState('');
  const [candidateElapsedSeconds, setCandidateElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!motionCanvas.candidateGenerating) {
      setCandidateElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const update = () =>
      setCandidateElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)),
      );
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [motionCanvas.candidateGenerating]);

  async function handleGenerate(forcedGuidance?: string) {
    if (
      motionCanvas.generating ||
      codexConnection.checking ||
      !codexConnection.generationReady
    ) return;
    const connectionStatus = await codexConnection.verify();
    if (connectionStatus?.state !== 'connected') return;
    const selection = codexConnection.getGenerationSelection();
    if (!selection) return;

    const generatedProject = await motionCanvas.generate(
      forcedGuidance ?? guidance,
      selection.model,
      selection.reasoningEffort,
    );
    if (generatedProject) setGuidance('');
  }

  async function copyServeCommand() {
    if (!motionCanvas.serveCommand) return;
    try {
      await navigator.clipboard.writeText(motionCanvas.serveCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  async function handleApprove() {
    const approvedProject = await motionCanvas.approve();
    if (approvedProject) {
      navigate(projectVoicePath(approvedProject.id), true);
    }
  }

  function toggleScene(sceneId: string) {
    setSelectedSceneIds(current =>
      current.includes(sceneId)
        ? current.filter(item => item !== sceneId)
        : [...current, sceneId],
    );
  }

  function prepareScopeExpansion() {
    const candidate = motionCanvas.candidate;
    const scenes = motionCanvas.project?.motionCanvasBundle?.scenes ?? [];
    if (!candidate || scenes.length === 0) return;

    const validSceneIds = new Set(scenes.map(scene => scene.id));
    const requestedIds = candidate.coherence.issues
      .filter(issue => issue.requiresScopeExpansion)
      .flatMap(issue => issue.affectedSceneIds)
      .filter(sceneId => validSceneIds.has(sceneId));
    const expandedIds = new Set([
      ...candidate.scope.sceneIds,
      ...requestedIds,
    ]);

    if (expandedIds.size === candidate.scope.sceneIds.length) {
      const selectedIndexes = scenes
        .map((scene, index) =>
          candidate.scope.sceneIds.includes(scene.id) ? index : -1,
        )
        .filter(index => index >= 0);
      for (const index of selectedIndexes) {
        const previous = scenes[index - 1];
        const next = scenes[index + 1];
        if (previous) expandedIds.add(previous.id);
        if (next) expandedIds.add(next.id);
      }
    }

    setSelectedSceneIds([...expandedIds]);
    const fixes = candidate.coherence.issues
      .filter(issue => issue.requiresScopeExpansion)
      .map(issue => issue.suggestedFix.trim())
      .filter(Boolean);
    setGuidance(
      [
        'Tiếp tục từ candidate hiện tại, giữ nguyên mọi phần đã tốt và chỉ xử lý các điểm reviewer nêu.',
        ...new Set(fixes),
      ]
        .join(' '),
    );
  }

  async function handleCreateCandidate() {
    if (
      motionCanvas.candidateGenerating ||
      codexConnection.checking ||
      !codexConnection.generationReady
    ) return;
    const connectionStatus = await codexConnection.verify();
    if (connectionStatus?.state !== 'connected') return;
    const selection = codexConnection.getGenerationSelection();
    if (!selection) return;
    const created = await motionCanvas.createCandidate(
      guidance,
      {sceneIds: selectedSceneIds},
      selection.model,
      selection.reasoningEffort,
    );
    if (created) setGuidance('');
  }

  async function handleRepairCandidate() {
    const currentCandidate = motionCanvas.candidate;
    const repair = currentCandidate
      ? motionCanvasReviewerRepair(currentCandidate)
      : null;
    if (
      !repair ||
      motionCanvas.candidateGenerating ||
      codexConnection.checking ||
      !codexConnection.generationReady
    ) return;
    const connectionStatus = await codexConnection.verify();
    if (connectionStatus?.state !== 'connected') return;
    const selection = codexConnection.getGenerationSelection();
    if (!selection) return;
    const created = await motionCanvas.createCandidate(
      repair.guidance,
      repair.scope,
      selection.model,
      selection.reasoningEffort,
    );
    if (created) {
      setGuidance('');
      setSelectedSceneIds(created.scope.sceneIds);
    }
  }

  async function handleRestore(
    version: NonNullable<typeof motionCanvas.history>['versions'][number],
  ) {
    if (
      project.visualDesignBundle &&
      !window.confirm(
        'Khôi phục code scene sẽ tạo workspace mới và bỏ các override Layout Editor đang gắn với workspace hiện tại. Bạn muốn tiếp tục?',
      )
    ) return;
    await motionCanvas.restoreVersion(version);
  }

  async function handleApplyCandidate() {
    if (
      project.visualDesignBundle &&
      !window.confirm(
        'Áp dụng candidate code scene sẽ bỏ các override Layout Editor đang gắn với workspace hiện tại. Bạn muốn tiếp tục?',
      )
    ) return;
    await motionCanvas.applyCandidate();
  }

  if (motionCanvas.loadState === 'loading') {
    return (
      <div className="page-state" role="status">
        <span className="spinner dark" />
        <strong>Đang chuẩn bị workspace Motion Canvas…</strong>
      </div>
    );
  }

  if (motionCanvas.loadState === 'error' || !motionCanvas.project) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Không thể mở bước Motion Canvas</strong>
        <p>{motionCanvas.loadError}</p>
        <button type="button" onClick={() => navigate('/')}>
          Về project mới
        </button>
      </div>
    );
  }

  const {project} = motionCanvas;
  const plan = project.voiceVisualPlan;
  const outline = project.outline;

  if (!outline || !plan || !motionCanvas.ready) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Kế hoạch voice–visual chưa sẵn sàng</strong>
        <p>
          Hãy tạo lại và chốt kế hoạch voice–visual hiện tại trước khi sinh
          scene Motion Canvas.
        </p>
        <button
          type="button"
          onClick={() => navigate(projectVoiceVisualPath(project.id))}
        >
          Về voice–visual
        </button>
      </div>
    );
  }

  const bundle = project.motionCanvasBundle;
  const usage = bundle?.generation.usage;
  const totalSeconds =
    bundle?.scenes.reduce(
      (total, scene) => total + scene.durationSeconds,
      0,
    ) ?? 0;
  const approved =
    bundle?.status === 'approved' && !motionCanvas.stale;
  const reviewerRepair = motionCanvas.candidate
    ? motionCanvasReviewerRepair(motionCanvas.candidate)
    : null;

  return (
    <div className="motion-canvas-workspace">
      <header className="outline-heading">
        <div className="eyebrow">
          <span>Bước 04</span>
          <span className="eyebrow-line" />
          Motion Canvas
        </div>
        <AdaptiveHeading as="h1">
          Biến kế hoạch đã chốt thành scene chạy được.
        </AdaptiveHeading>
        <p>
          Codex sinh một scene riêng cho từng ý. PAD Studio kiểm soát import,
          kiểm tra TypeScript và chỉ nhận workspace đã biên dịch thành công.
        </p>
      </header>

      <div className="outline-codex motion-canvas-connection">
        <CodexConnectionCard
          connection={codexConnection}
          task="motionCanvas"
          workUnits={outline.sections.length}
        />
      </div>

      {motionCanvas.conflict && (
        <div className="outline-alert is-error" role="alert">
          <span>
            Project đã thay đổi ở nơi khác. Hãy tải lại trước khi tiếp tục.
          </span>
          <button type="button" onClick={motionCanvas.reload}>
            Tải lại
          </button>
        </div>
      )}

      {motionCanvas.stale && (
        <div className="outline-alert" role="status">
          <span>
            Kế hoạch voice–visual đã thay đổi. Workspace scene hiện tại chỉ
            còn để tham khảo.
          </span>
          <button
            type="button"
            disabled={
              motionCanvas.generating ||
              codexConnection.checking ||
              !codexConnection.generationReady
            }
            onClick={() => void handleGenerate('')}
          >
            {motionCanvas.generating ? 'Đang sinh lại…' : 'Sinh lại toàn bộ'}
          </button>
        </div>
      )}

      {motionCanvas.actionError && (
        <div className="outline-alert is-error" role="alert">
          {motionCanvas.actionError}
        </div>
      )}

      {!bundle ? (
        <div className="motion-canvas-empty-grid">
          <section className="outline-primary-card">
            <div className="outline-card-heading">
              <span className="preview-kicker">
                <SparkIcon />
                Voice–visual đã chốt
              </span>
              <span className="draft-status is-saved">
                <span />
                Sẵn sàng
              </span>
            </div>

            <div className="outline-topic">
              <span className="preview-label">Đầu vào scene</span>
              <AdaptiveHeading as="h2">
                {outline.centralMessage}
              </AdaptiveHeading>
              <p>
                {outline.sections.length} scene ·{' '}
                {plan.sections.reduce(
                  (total, section) => total + section.beats.length,
                  0,
                )}{' '}
                beat
              </p>
            </div>

            <div className="motion-canvas-empty-state">
              <span className="outline-empty-icon">
                <LayersIcon />
              </span>
              <div>
                <h3>Chưa có code scene</h3>
                <p>
                  Mỗi section sẽ trở thành một file TSX tự chứa trong workspace
                  riêng của project, đúng thứ tự timeline đã chốt.
                </p>
              </div>
            </div>

            <footer className="outline-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  navigate(projectVoiceVisualPath(project.id))
                }
              >
                <ArrowLeftIcon />
                Xem lại voice–visual
              </button>
              <button
                className="submit-button"
                type="button"
                disabled={
                  motionCanvas.generating ||
                  codexConnection.checking ||
                  !codexConnection.generationReady
                }
                onClick={() => void handleGenerate('')}
              >
                {motionCanvas.generating ? (
                  <>
                    <span className="spinner" />
                    Đang sinh và kiểm tra scene…
                  </>
                ) : (
                  <>
                    Sinh scene Motion Canvas
                    <SparkIcon />
                  </>
                )}
              </button>
            </footer>
          </section>

          <ResponsiveAside label="Ràng buộc an toàn">
            <section className="outline-side-card">
              <span className="preview-label">Ràng buộc an toàn</span>
              <ul className="voice-visual-checklist">
                <li>
                  <CheckIcon />
                  Chỉ dùng package Motion Canvas
                </li>
                <li>
                  <CheckIcon />
                  Không mạng, filesystem hay dynamic import
                </li>
                <li>
                  <CheckIcon />
                  TypeScript phải biên dịch trước khi lưu
                </li>
              </ul>
              <div className="outline-next-note">
                <LightbulbIcon />
                <p>
                  Scene của mỗi video được giữ riêng, chưa ép vào thư viện
                  component dùng chung.
                </p>
              </div>
            </section>
          </ResponsiveAside>
        </div>
      ) : (
        <>
          <div className="motion-canvas-editor-grid">
            <div className="motion-canvas-main">
              <section className="motion-canvas-summary">
                <header>
                  <div>
                    <span className="preview-kicker">
                      <CheckIcon />
                      TypeScript đã kiểm tra
                    </span>
                    <h2>Workspace Motion Canvas</h2>
                  </div>
                  <span
                    className={`draft-status${approved ? ' is-saved' : ''}`}
                  >
                    <span />
                    {approved ? 'Đã chốt' : 'Chờ review'}
                  </span>
                </header>

                <div className="motion-canvas-command">
                  <div>
                    <span>Tùy chọn developer · không cần để xem/chỉnh trên UI</span>
                    <code>{motionCanvas.serveCommand}</code>
                  </div>
                  <button type="button" onClick={() => void copyServeCommand()}>
                    {copied ? 'Đã sao chép' : 'Sao chép lệnh'}
                  </button>
                </div>

                <dl className="motion-canvas-validation">
                  <div>
                    <dt>Khung hình</dt>
                    <dd>
                      {bundle.width} × {bundle.height}
                    </dd>
                  </div>
                  <div>
                    <dt>Frame rate</dt>
                    <dd>{bundle.fps} fps</dd>
                  </div>
                  <div>
                    <dt>Motion Canvas</dt>
                    <dd>{bundle.validation.motionCanvasVersion}</dd>
                  </div>
                  <div>
                    <dt>Timing contract</dt>
                    <dd>
                      {bundle.timingContractVersion === 1
                        ? 'Beat events v1'
                        : 'Legacy · cần sinh lại trước sync'}
                    </dd>
                  </div>
                  <div>
                    <dt>Source hash</dt>
                    <dd title={bundle.validation.sourceHash}>
                      {bundle.validation.sourceHash.slice(0, 12)}
                    </dd>
                  </div>
                </dl>
              </section>

              <MotionDesignEditor motionCanvas={motionCanvas} />

              <div className="motion-canvas-scenes">
                {bundle.scenes.map((scene, index) => {
                  const sourceFile = motionCanvas.files.find(
                    (file) => file.path === scene.filePath,
                  );
                  const outlineSection = outline.sections[index]!;
                  const planSection = plan.sections[index];

                  return (
                    <article
                      className="motion-canvas-scene"
                      key={scene.id}
                    >
                      <header>
                        <span className="outline-section-index">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <h2>{outlineSection.title}</h2>
                          <p>{outlineSection.goal}</p>
                          <span className="motion-canvas-scene-name">
                            Scene source · {scene.name}
                          </span>
                        </div>
                        <label className="motion-canvas-scene-scope">
                          <input
                            type="checkbox"
                            checked={selectedSceneIds.includes(scene.id)}
                            onChange={() => toggleScene(scene.id)}
                          />
                          Cho AI sinh lại scene này
                        </label>
                        <span className="voice-visual-section-duration">
                          <ClockIcon />
                          {formatTime(scene.durationSeconds)}
                          {planSection
                            ? ` · ${planSection.beats.length} beat`
                            : ''}
                        </span>
                      </header>

                      {planSection && (
                        <div className="motion-canvas-timeline">
                          <div className="motion-canvas-timeline-heading">
                            <span>Timeline visual dự kiến</span>
                            <small>
                              {scene.timingEvents?.length
                                ? 'Điều khiển bằng beat events'
                                : 'Timing legacy'}
                            </small>
                          </div>
                          <div
                            className="motion-canvas-timeline-track"
                            aria-label={`Timeline của ${outlineSection.title}`}
                          >
                            {planSection.beats.map((beat, beatIndex) => {
                              const timing = scene.timingEvents?.find(
                                (event) => event.beatId === beat.id,
                              );
                              const duration =
                                timing?.plannedDurationSeconds ??
                                beat.durationSeconds;

                              return (
                                <div
                                  className="motion-canvas-timeline-beat"
                                  style={{flexGrow: duration}}
                                  title={beat.visualDescription}
                                  key={beat.id}
                                >
                                  <span>Beat {beatIndex + 1}</span>
                                  <p>{beat.visualDescription}</p>
                                  <small>{formatTime(duration)}</small>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="motion-canvas-file-row">
                        <code>{scene.filePath}</code>
                        <span>
                          {sourceFile?.source.split('\n').length ?? 0} dòng
                        </span>
                      </div>
                      {sourceFile && (
                        <details>
                          <summary>Xem source scene</summary>
                          <pre>
                            <code>{sourceFile.source}</code>
                          </pre>
                        </details>
                      )}
                    </article>
                  );
                })}
              </div>

              {!motionCanvas.stale && (
                <>
                  {motionCanvas.candidate && (
                    <section className="outline-candidate-review motion-canvas-candidate-review">
                      <header>
                        <div>
                          <span className="preview-kicker">
                            <SparkIcon />
                            Workspace candidate riêng
                          </span>
                          <h2>
                            Đã sinh lại {motionCanvas.candidate.scope.sceneIds.length}{' '}
                            scene, chưa ghi đè bản hiện tại
                          </h2>
                        </div>
                        <span className={`candidate-status is-${motionCanvas.candidate.status}`}>
                          {motionCanvas.candidateRepairing
                            ? 'Đang tự sửa theo reviewer'
                            : motionCanvas.candidate.decision === 'accepted'
                            ? 'Đã áp dụng'
                            : motionCanvas.candidate.decision === 'rejected'
                              ? 'Đã từ chối'
                              : motionCanvas.candidate.status === 'ready'
                                ? 'Compile + review đạt'
                                : motionCanvas.candidate.status === 'coherence_warning'
                                  ? 'Có cảnh báo'
                                  : motionCanvas.candidate.status === 'scope_expansion_required'
                                    ? 'Cần mở phạm vi'
                                    : 'Chưa thể áp dụng'}
                        </span>
                      </header>
                      <p>{motionCanvas.candidate.coherence.summary}</p>
                      {motionCanvas.candidate.coherence.issues.length > 0 && (
                        <ul className="voice-visual-coherence-issues">
                          {motionCanvas.candidate.coherence.issues.map((issue, index) => (
                            <li key={`${issue.category}-${index}`}>
                              <strong>
                                {issue.severity === 'error' ? 'Lỗi' : 'Lưu ý'}
                              </strong>{' '}
                              {issue.message}
                              <small>{issue.suggestedFix}</small>
                            </li>
                          ))}
                        </ul>
                      )}
                      {motionCanvas.candidate.decision === 'pending' &&
                        motionCanvas.candidate.status ===
                          'scope_expansion_required' && (
                          <div className="candidate-scope-expansion">
                            <div>
                              <strong>Reviewer đề nghị chỉnh thêm phần liên quan</strong>
                              <small>
                                Candidate này vẫn được giữ làm nền; scene đã tốt không bị sinh
                                lại nếu không nằm trong phạm vi mới.
                              </small>
                            </div>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={prepareScopeExpansion}
                            >
                              Mở phạm vi theo gợi ý
                            </button>
                          </div>
                        )}
                      <div className="motion-canvas-candidate-scenes">
                        {motionCanvas.candidate.bundle.scenes
                          .filter(scene =>
                            motionCanvas.candidate?.scope.sceneIds.includes(
                              scene.id,
                            ),
                          )
                          .map(scene => {
                            const currentScene = bundle.scenes.find(
                              item => item.id === scene.id,
                            );
                            return (
                              <article key={scene.id}>
                                <strong>{currentScene?.name ?? scene.name}</strong>
                                <span aria-hidden="true">→</span>
                                <strong>{scene.name}</strong>
                                <small>{scene.filePath} · ID được giữ nguyên</small>
                              </article>
                            );
                          })}
                      </div>
                      <small className="motion-canvas-candidate-hash">
                        Candidate source {motionCanvas.candidate.bundle.validation.sourceHash.slice(0, 12)} · workspace hiện tại {bundle.validation.sourceHash.slice(0, 12)}
                      </small>
                      <div className="motion-canvas-candidate-preview">
                        {motionCanvas.candidatePreviewState === 'loading' && (
                          <div className="layout-preview-state" role="status">
                            <span className="spinner dark" />
                            <strong>Đang mở preview candidate…</strong>
                          </div>
                        )}
                        {motionCanvas.candidatePreviewState === 'error' && (
                          <div className="layout-preview-state is-error" role="alert">
                            <strong>Chưa mở được preview candidate</strong>
                            <p>{motionCanvas.candidatePreviewError}</p>
                          </div>
                        )}
                        {motionCanvas.candidatePreviewState === 'ready' &&
                          motionCanvas.candidatePreviewUrl && (
                            <iframe
                              title="Preview workspace candidate Motion Canvas"
                              src={motionCanvas.candidatePreviewUrl}
                              allow="autoplay; fullscreen"
                              sandbox="allow-scripts allow-same-origin"
                              referrerPolicy="no-referrer"
                              allowFullScreen
                            />
                          )}
                      </div>
                      {motionCanvas.candidateFiles
                        .filter(file =>
                          motionCanvas.candidate?.bundle.scenes.some(
                            scene =>
                              motionCanvas.candidate?.scope.sceneIds.includes(
                                scene.id,
                              ) && scene.filePath === file.path,
                          ),
                        )
                        .map(file => (
                          <details key={file.path} className="motion-canvas-candidate-source">
                            <summary>Xem source candidate · {file.path}</summary>
                            <pre><code>{file.source}</code></pre>
                          </details>
                        ))}
                      <footer>
                        {motionCanvas.candidate.decision === 'pending' ? (
                          <>
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={motionCanvas.historyBusy}
                              onClick={() => void motionCanvas.rejectCandidate()}
                            >
                              Giữ workspace cũ
                            </button>
                            {reviewerRepair && (
                              <button
                                className="secondary-button"
                                type="button"
                                disabled={
                                  motionCanvas.candidateGenerating ||
                                  motionCanvas.conflict ||
                                  codexConnection.checking ||
                                  !codexConnection.generationReady
                                }
                                onClick={() => void handleRepairCandidate()}
                              >
                                {motionCanvas.candidateGenerating
                                  ? 'AI đang sửa theo reviewer…'
                                  : `Sửa tự động ${reviewerRepair.scope.sceneIds.length} scene theo reviewer`}
                              </button>
                            )}
                            <button
                              className="submit-button"
                              type="button"
                              disabled={
                                motionCanvas.candidateApplying ||
                                motionCanvas.candidate.status === 'coherence_blocked' ||
                                motionCanvas.candidate.status === 'scope_expansion_required'
                              }
                              onClick={() => void handleApplyCandidate()}
                            >
                              {motionCanvas.candidateApplying
                                ? 'Đang áp dụng…'
                                : 'Áp dụng workspace candidate'}
                            </button>
                          </>
                        ) : (
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={motionCanvas.dismissCandidate}
                          >
                            Đóng
                          </button>
                        )}
                      </footer>
                    </section>
                  )}

                  <section className="outline-ai-revision">
                    <div>
                      <span className="preview-kicker">
                        <SparkIcon />
                        Sinh lại theo phạm vi
                      </span>
                      <h2>Scene được chọn cần điều chỉnh điều gì?</h2>
                      <p>
                        Scene không chọn được chép nguyên source vào workspace
                        candidate; toàn chuỗi được review lại trước khi áp dụng.
                      </p>
                    </div>
                    <div className="ai-scope-presets" aria-label="Chọn nhanh scene">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedSceneIds(
                            motionCanvas.project?.motionCanvasBundle?.scenes.map(
                              scene => scene.id,
                            ) ?? [],
                          )
                        }
                      >
                        Chọn tất cả scene
                      </button>
                      <button type="button" onClick={() => setSelectedSceneIds([])}>
                        Bỏ chọn
                      </button>
                    </div>
                    <div className="voice-visual-scope-summary">
                      <strong>{selectedSceneIds.length} scene được phép sinh lại</strong>
                      <span>ID và filePath của mọi scene vẫn được giữ ổn định.</span>
                    </div>
                    <textarea
                      rows={3}
                      value={guidance}
                      placeholder="Ví dụ: Làm chuyển động chia đôi trực quan hơn ở scene đã chọn, giữ palette và nhịp chuyển tiếp với scene kế bên."
                      onChange={(event) => setGuidance(event.target.value)}
                    />
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={
                        motionCanvas.candidateGenerating ||
                        selectedSceneIds.length === 0 ||
                        guidance.trim().length < 3 ||
                        motionCanvas.conflict ||
                        codexConnection.checking ||
                        !codexConnection.generationReady
                      }
                      onClick={() => void handleCreateCandidate()}
                    >
                      {motionCanvas.candidateGenerating ? (
                        <>
                          <span className="spinner dark" />
                          Đang sinh, compile và review…
                        </>
                      ) : (
                        <>
                          <SparkIcon />
                          {motionCanvas.candidate?.decision === 'pending'
                            ? 'Chỉnh tiếp candidate'
                            : 'Tạo workspace candidate'}
                        </>
                      )}
                    </button>
                    {motionCanvas.candidateGenerating && (
                      <small className="motion-candidate-progress" role="status">
                        {motionCanvas.candidateRepairing
                          ? `Reviewer đã tìm thấy lỗi trong phạm vi cho phép; Codex đang sửa đúng ${reviewerRepair?.scope.sceneIds.length ?? 0} scene liên quan.`
                          : candidateElapsedSeconds < 30
                          ? 'Codex đang dựng source cho scene đã chọn.'
                          : candidateElapsedSeconds < 120
                            ? 'Đang kiểm tra TypeScript, timing và semantic layer.'
                            : 'Source hợp lệ sẽ được giữ ngay cả khi lượt review mạch lạc cần thử lại.'}
                        {' · '}
                        {formatTime(candidateElapsedSeconds)}
                      </small>
                    )}
                  </section>
                </>
              )}
            </div>

            <ResponsiveAside
              className="motion-canvas-side"
              label="Tổng quan scene"
            >
              <section className="outline-side-card">
                <span className="preview-label">Tổng quan</span>
                <dl>
                  <div>
                    <dt>Số scene</dt>
                    <dd>{bundle.scenes.length}</dd>
                  </div>
                  <div>
                    <dt>Thời lượng</dt>
                    <dd>{formatTime(totalSeconds)}</dd>
                  </div>
                  <div>
                    <dt>Trạng thái</dt>
                    <dd>{approved ? 'Đã chốt' : 'Đang review'}</dd>
                  </div>
                  <div>
                    <dt>Workspace</dt>
                    <dd>Generation {bundle.contentRevision}</dd>
                  </div>
                </dl>

                {usage && (
                  <div className="outline-usage">
                    <span>Token lần sinh gần nhất</span>
                    <strong>
                      {usage.totalTokens.toLocaleString('vi-VN')}
                    </strong>
                    <small>
                      Input {usage.inputTokens.toLocaleString('vi-VN')} ·
                      Output {usage.outputTokens.toLocaleString('vi-VN')}
                    </small>
                    <small>
                      {bundle.generation.model}
                      {bundle.generation.reasoningEffort
                        ? ` · reasoning ${bundle.generation.reasoningEffort}`
                        : ''}
                    </small>
                  </div>
                )}

                <div className="outline-next-note">
                  <LightbulbIcon />
                  <p>
                    Workspace generation cũ được giữ nguyên, nên sinh lại
                    không ghi đè code scene trước đó.
                  </p>
                </div>
              </section>

              {!motionCanvas.stale && (
                <section className="outline-history-card motion-canvas-history-card">
                  <header>
                    <div>
                      <span className="preview-label">Lịch sử an toàn</span>
                      <h2>Workspace versions</h2>
                    </div>
                  </header>
                  <div className="outline-checkpoint-action">
                    <input
                      type="text"
                      value={checkpointLabel}
                      placeholder="Tên mốc trước khi chỉnh scene"
                      onChange={event => setCheckpointLabel(event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={motionCanvas.historyBusy}
                      onClick={() =>
                        void motionCanvas.createCheckpoint(checkpointLabel).then(
                          version => {
                            if (version) setCheckpointLabel('');
                          },
                        )
                      }
                    >
                      Lưu mốc
                    </button>
                  </div>
                  {motionCanvas.historyError && (
                    <p className="outline-history-error" role="alert">
                      {motionCanvas.historyError}
                    </p>
                  )}
                  {motionCanvas.history?.candidates.length ? (
                    <div className="outline-candidate-history">
                      <strong>Candidates</strong>
                      {motionCanvas.history.candidates.slice(0, 8).map(item => (
                        <article key={item.candidateId}>
                          <div>
                            <strong>{item.scope.sceneIds.length} scene</strong>
                            <span>
                              {item.decision === 'pending'
                                ? 'Chờ review'
                                : item.decision === 'accepted'
                                  ? 'Đã áp dụng'
                                  : 'Đã từ chối'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => motionCanvas.selectCandidate(item)}
                          >
                            Xem
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <div className="outline-version-list">
                    {motionCanvas.history?.versions.slice(0, 12).map(version => (
                      <article key={version.versionId}>
                        <div>
                          <strong>{version.label ?? 'Workspace đã lưu'}</strong>
                          <span>
                            {new Date(version.createdAt).toLocaleString('vi-VN')}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={
                            motionCanvas.historyBusy ||
                            version.contentHash ===
                              motionCanvas.history?.currentContentHash
                          }
                          onClick={() => void handleRestore(version)}
                        >
                          {version.contentHash ===
                          motionCanvas.history?.currentContentHash
                            ? 'Hiện tại'
                            : 'Khôi phục'}
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </ResponsiveAside>
          </div>

          <footer className="outline-final-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                navigate(projectVoiceVisualPath(project.id))
              }
            >
              <ArrowLeftIcon />
              Xem lại voice–visual
            </button>
            <div>
              <span>
                {approved
                  ? 'Scene Motion Canvas đã được chốt'
                  : 'Mở editor và review chuyển động trước khi chốt'}
              </span>
              <button
                className="submit-button"
                type="button"
                disabled={
                  motionCanvas.approving ||
                  motionCanvas.generating ||
                  motionCanvas.candidateGenerating ||
                  motionCanvas.candidateApplying ||
                  motionCanvas.candidate?.decision === 'pending' ||
                  motionCanvas.designSaveState === 'saving' ||
                  motionCanvas.designSaveState === 'error' ||
                  motionCanvas.stale ||
                  motionCanvas.conflict
                }
                onClick={() =>
                  approved
                    ? navigate(projectVoicePath(project.id))
                    : void handleApprove()
                }
              >
                {motionCanvas.approving ? (
                  <>
                    <span className="spinner" />
                    Đang chốt…
                  </>
                ) : approved ? (
                  <>
                    Sang bước tạo voice
                    <ArrowRightIcon />
                  </>
                ) : (
                  <>
                    Chốt scene Motion Canvas
                    <CheckIcon />
                  </>
                )}
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
