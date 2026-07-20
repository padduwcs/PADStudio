import {useState} from 'react';
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
                <section className="outline-ai-revision">
                  <div>
                    <span className="preview-kicker">
                      <SparkIcon />
                      Sinh lại có định hướng
                    </span>
                    <h2>Scene cần điều chỉnh điều gì?</h2>
                    <p>
                      Chỉ khi có góp ý, source hiện tại mới được gửi lại cho
                      Codex.
                    </p>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={4000}
                    value={guidance}
                    placeholder="Ví dụ: Giảm chữ, làm chuyển động chia đôi trực quan hơn và giữ bố cục an toàn cho màn hình dọc."
                    onChange={(event) => setGuidance(event.target.value)}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      motionCanvas.generating ||
                      motionCanvas.conflict ||
                      codexConnection.checking ||
                      !codexConnection.generationReady
                    }
                    onClick={() => void handleGenerate()}
                  >
                    {motionCanvas.generating ? (
                      <>
                        <span className="spinner dark" />
                        Đang sinh lại…
                      </>
                    ) : (
                      <>
                        <SparkIcon />
                        {guidance.trim()
                          ? 'Sinh lại theo góp ý'
                          : 'Sinh lại toàn bộ'}
                      </>
                    )}
                  </button>
                </section>
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
