import {useState} from 'react';
import {
  narrationMetrics,
  targetNarrationTokenCount,
} from '../shared/narrationTiming.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {AdaptiveHeading} from './AdaptiveText.tsx';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  LayersIcon,
  LightbulbIcon,
  SparkIcon,
} from './icons.tsx';
import {
  navigate,
  projectMotionCanvasPath,
  projectOutlinePath,
} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {useVoiceVisualDraft} from './useVoiceVisualDraft.ts';

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function VoiceVisualPage({projectId}: {projectId: string}) {
  const plan = useVoiceVisualDraft(projectId);
  const codexConnection = useCodexConnection();
  const [guidance, setGuidance] = useState('');

  async function handleGenerate(forcedGuidance?: string) {
    if (
      plan.generating ||
      codexConnection.checking ||
      !codexConnection.generationReady
    ) return;
    const connectionStatus = await codexConnection.verify();
    if (connectionStatus?.state !== 'connected') return;
    const selection = codexConnection.getGenerationSelection();
    if (!selection) return;

    const generatedProject = await plan.generate(
      forcedGuidance ?? guidance,
      selection.model,
      selection.reasoningEffort,
    );
    if (generatedProject) setGuidance('');
  }

  async function handleApprove() {
    const approvedProject = await plan.approve();
    if (approvedProject) {
      navigate(projectMotionCanvasPath(approvedProject.id), true);
    }
  }

  if (plan.loadState === 'loading') {
    return (
      <div className="page-state" role="status">
        <span className="spinner dark" />
        <strong>Đang chuẩn bị kế hoạch voice–visual…</strong>
      </div>
    );
  }

  if (plan.loadState === 'error' || !plan.project) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Không thể mở bước voice–visual</strong>
        <p>{plan.loadError}</p>
        <button type="button" onClick={() => navigate('/')}>
          Về project mới
        </button>
      </div>
    );
  }

  const {project, draft} = plan;
  const outline = project.outline;

  if (!outline || !plan.ready) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Mạch giảng chưa sẵn sàng</strong>
        <p>
          Hãy tạo lại và chốt mạch giảng hiện tại trước khi lập kế hoạch
          voice–visual.
        </p>
        <button
          type="button"
          onClick={() => navigate(projectOutlinePath(project.id))}
        >
          Về mạch giảng
        </button>
      </div>
    );
  }

  const totalSeconds =
    draft?.sections.reduce(
      (sectionTotal, section) =>
        sectionTotal +
        section.beats.reduce(
          (beatTotal, beat) => beatTotal + beat.durationSeconds,
          0,
        ),
      0,
    ) ?? 0;
  const outlineSeconds = outline.sections.reduce(
    (total, section) => total + section.estimatedSeconds,
    0,
  );
  const beatCount =
    draft?.sections.reduce(
      (total, section) => total + section.beats.length,
      0,
    ) ?? 0;
  const planNarration =
    draft?.sections
      .flatMap((section) => section.beats.map((beat) => beat.voiceover))
      .join('\n\n') ?? '';
  const planNarrationMetrics = narrationMetrics(
    planNarration,
    draft?.timingCalibration,
  );
  const usage = project.voiceVisualPlan?.generation.usage;
  const approved =
    project.voiceVisualPlan?.status === 'approved' &&
    plan.saveState === 'saved' &&
    !plan.stale;
  let runningSeconds = 0;

  return (
    <div className="voice-visual-workspace">
      <header className="outline-heading">
        <div className="eyebrow">
          <span>Bước 03</span>
          <span className="eyebrow-line" />
          Voice–visual
        </div>
        <AdaptiveHeading as="h1">
          Khớp lời kể với điều người xem nhìn thấy.
        </AdaptiveHeading>
        <p>
          Mỗi beat nối một đoạn voice với visual và chuyển động. Timing được
          tính từ chính lời kể; bạn chỉ thêm thời gian giữ hình khi thật sự
          cần.
        </p>
      </header>

      <div className="outline-codex">
        <CodexConnectionCard
          connection={codexConnection}
          task="voiceVisual"
          workUnits={outline.sections.length}
        />
      </div>

      {plan.saveState === 'conflict' && (
        <div className="outline-alert is-error" role="alert">
          <span>
            Project đã thay đổi ở nơi khác. Hãy tải lại trước khi tiếp tục.
          </span>
          <button type="button" onClick={plan.reload}>
            Tải lại
          </button>
        </div>
      )}

      {plan.stale && (
        <div className="outline-alert" role="status">
          <span>
            Mạch giảng đã thay đổi. Kế hoạch hiện tại chỉ còn để tham khảo.
          </span>
          <button
            type="button"
            disabled={
              plan.generating ||
              codexConnection.checking ||
              !codexConnection.generationReady
            }
            onClick={() => void handleGenerate('')}
          >
            {plan.generating ? 'Đang tạo lại…' : 'Tạo lại theo mạch giảng'}
          </button>
        </div>
      )}

      {plan.actionError && (
        <div className="outline-alert is-error" role="alert">
          {plan.actionError}
        </div>
      )}

      {draft && plan.validationErrors.length > 0 && (
        <div className="outline-alert draft-validation-alert" role="status">
          <strong>Cần bổ sung trước khi chốt:</strong>
          <ul>
            {plan.validationErrors.map(message => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {!draft ? (
        <div className="voice-visual-empty-grid">
          <section className="outline-primary-card">
            <div className="outline-card-heading">
              <span className="preview-kicker">
                <SparkIcon />
                Mạch giảng đã chốt
              </span>
              <span className="draft-status is-saved">
                <span />
                Sẵn sàng
              </span>
            </div>

            <div className="outline-topic">
              <span className="preview-label">Thông điệp trung tâm</span>
              <AdaptiveHeading as="h2">
                {outline.centralMessage}
              </AdaptiveHeading>
              <p>
                {outline.sections.length} ý · {formatTime(outlineSeconds)} dự
                kiến
              </p>
            </div>

            <div className="voice-visual-empty-state">
              <span className="outline-empty-icon">
                <LayersIcon />
              </span>
              <div>
                <h3>Chưa có kế hoạch voice–visual</h3>
                <p>
                  Codex sẽ chia từng ý thành các beat ngắn và đề xuất lời kể,
                  visual, chuyển động cùng thời lượng tương ứng.
                </p>
              </div>
            </div>

            <footer className="outline-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => navigate(projectOutlinePath(project.id))}
              >
                <ArrowLeftIcon />
                Xem lại mạch giảng
              </button>
              <button
                className="submit-button"
                type="button"
                disabled={
                  plan.generating ||
                  codexConnection.checking ||
                  !codexConnection.generationReady
                }
                onClick={() => void handleGenerate('')}
              >
                {plan.generating ? (
                  <>
                    <span className="spinner" />
                    Đang lập kế hoạch…
                  </>
                ) : (
                  <>
                    Tạo kế hoạch voice–visual
                    <SparkIcon />
                  </>
                )}
              </button>
            </footer>
          </section>

          <aside className="outline-side-card">
            <span className="preview-label">AI sẽ đề xuất</span>
            <ul className="voice-visual-checklist">
              <li>
                <CheckIcon />
                Lời thuyết minh sẵn sàng cho TTS
              </li>
              <li>
                <CheckIcon />
                Visual truyền đạt đúng ý đang kể
              </li>
              <li>
                <CheckIcon />
                Chuyển động và thời lượng từng beat
              </li>
            </ul>
            <div className="outline-next-note">
              <LightbulbIcon />
              <p>
                Bước này chỉ lập kế hoạch. Chưa gọi dịch vụ tạo voice hoặc
                sinh code scene.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <>
          <div className="voice-visual-editor-grid">
            <div className="voice-visual-main">
              <section className="voice-visual-directions">
                <header>
                  <div>
                    <span className="preview-kicker">
                      <SparkIcon />
                      Định hướng chung
                    </span>
                    <h2>Cách kể và ngôn ngữ hình ảnh</h2>
                  </div>
                  <span
                    className={`draft-status${approved ? ' is-saved' : ''}`}
                  >
                    <span />
                    {approved ? 'Đã chốt' : 'Bản nháp'}
                  </span>
                </header>
                <div className="voice-visual-direction-grid">
                  <label className="outline-field">
                    <span>Giọng kể</span>
                    <textarea
                      rows={3}
                      maxLength={320}
                      disabled={plan.stale}
                      value={draft.voiceDirection}
                      onChange={(event) =>
                        plan.updateDirection(
                          'voiceDirection',
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="outline-field">
                    <span>Ngôn ngữ hình ảnh</span>
                    <textarea
                      rows={3}
                      maxLength={420}
                      disabled={plan.stale}
                      value={draft.visualDirection}
                      onChange={(event) =>
                        plan.updateDirection(
                          'visualDirection',
                          event.target.value,
                        )
                      }
                    />
                  </label>
                </div>
              </section>

              <div className="voice-visual-sections">
                {draft.sections.map((planSection, sectionIndex) => {
                  const outlineSection = outline.sections[sectionIndex]!;
                  const sectionSeconds = planSection.beats.reduce(
                    (total, beat) => total + beat.durationSeconds,
                    0,
                  );
                  const sectionNarration = planSection.beats
                    .map((beat) => beat.voiceover)
                    .join('\n\n');
                  const sectionMetrics = narrationMetrics(
                    sectionNarration,
                    draft.timingCalibration,
                  );
                  const sectionTokenTarget = targetNarrationTokenCount(
                    outlineSection.estimatedSeconds,
                  );

                  return (
                    <section
                      className="voice-visual-section"
                      key={planSection.outlineSectionId}
                    >
                      <header className="voice-visual-section-header">
                        <span className="outline-section-index">
                          {String(sectionIndex + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <h2>{outlineSection.title}</h2>
                          <p>{outlineSection.goal}</p>
                        </div>
                        <span className="voice-visual-section-duration">
                          <ClockIcon />
                          {formatTime(sectionSeconds)} ·{' '}
                          {sectionMetrics.whitespaceTokenCount}/
                          {sectionTokenTarget} đơn vị
                        </span>
                      </header>

                      <div className="voice-visual-beats">
                        {planSection.beats.map((beat, beatIndex) => {
                          const startSeconds = runningSeconds;
                          runningSeconds += beat.durationSeconds;

                          return (
                            <article
                              className="voice-visual-beat"
                              key={beat.id}
                            >
                              <header>
                                <div>
                                  <span className="voice-visual-beat-index">
                                    Beat {beatIndex + 1}
                                  </span>
                                  <strong>{formatTime(startSeconds)}</strong>
                                </div>
                                <div className="outline-section-controls">
                                  <button
                                    type="button"
                                    disabled={beatIndex === 0 || plan.stale}
                                    aria-label={`Đưa beat ${beatIndex + 1} lên`}
                                    onClick={() =>
                                      plan.moveBeat(
                                        planSection.outlineSectionId,
                                        beat.id,
                                        -1,
                                      )
                                    }
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      beatIndex ===
                                        planSection.beats.length - 1 ||
                                      plan.stale
                                    }
                                    aria-label={`Đưa beat ${beatIndex + 1} xuống`}
                                    onClick={() =>
                                      plan.moveBeat(
                                        planSection.outlineSectionId,
                                        beat.id,
                                        1,
                                      )
                                    }
                                  >
                                    ↓
                                  </button>
                                  <button
                                    className="is-danger"
                                    type="button"
                                    disabled={
                                      planSection.beats.length <= 1 ||
                                      plan.stale
                                    }
                                    onClick={() =>
                                      plan.removeBeat(
                                        planSection.outlineSectionId,
                                        beat.id,
                                      )
                                    }
                                  >
                                    Xóa
                                  </button>
                                </div>
                              </header>

                              <div className="voice-visual-beat-fields">
                                <label className="outline-field voice-field">
                                  <span>Lời thuyết minh</span>
                                  <textarea
                                    rows={4}
                                    maxLength={4000}
                                    disabled={plan.stale}
                                    value={beat.voiceover}
                                    onChange={(event) =>
                                      plan.updateBeat(
                                        planSection.outlineSectionId,
                                        beat.id,
                                        'voiceover',
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <label className="outline-field">
                                  <span>Visual cần thấy</span>
                                  <textarea
                                    rows={3}
                                    maxLength={2000}
                                    disabled={plan.stale}
                                    value={beat.visualDescription}
                                    onChange={(event) =>
                                      plan.updateBeat(
                                        planSection.outlineSectionId,
                                        beat.id,
                                        'visualDescription',
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <label className="outline-field">
                                  <span>Chuyển động</span>
                                  <textarea
                                    rows={2}
                                    maxLength={2000}
                                    disabled={plan.stale}
                                    value={beat.animationDescription}
                                    onChange={(event) =>
                                      plan.updateBeat(
                                        planSection.outlineSectionId,
                                        beat.id,
                                        'animationDescription',
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <label className="outline-time-field">
                                  <span>Timing từ lời kể</span>
                                  <span>
                                    <strong>
                                      {formatTime(beat.durationSeconds)}
                                    </strong>
                                    <small>
                                      {
                                        narrationMetrics(
                                          beat.voiceover,
                                          draft.timingCalibration,
                                        )
                                          .whitespaceTokenCount
                                      }{' '}
                                      đơn vị
                                    </small>
                                  </span>
                                </label>
                                <label className="outline-time-field">
                                  <span>Giữ hình thêm</span>
                                  <span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={
                                        pipelineSafetyLimits.maximumVisualHoldSeconds
                                      }
                                      disabled={plan.stale}
                                      value={beat.visualHoldSeconds}
                                      onChange={(event) =>
                                        plan.updateBeat(
                                          planSection.outlineSectionId,
                                          beat.id,
                                          'visualHoldSeconds',
                                          Number(event.target.value),
                                        )
                                      }
                                    />
                                    giây
                                  </span>
                                </label>
                              </div>
                            </article>
                          );
                        })}
                      </div>

                      <button
                        className="voice-visual-add-beat"
                        type="button"
                        disabled={
                          planSection.beats.length >=
                            pipelineSafetyLimits.maximumBeatsPerSection ||
                          beatCount >=
                            pipelineSafetyLimits.maximumTotalBeats ||
                          plan.stale
                        }
                        onClick={() =>
                          plan.addBeat(planSection.outlineSectionId)
                        }
                      >
                        + Thêm beat
                      </button>
                    </section>
                  );
                })}
              </div>

              {!plan.stale && (
                <section className="outline-ai-revision">
                  <div>
                    <span className="preview-kicker">
                      <SparkIcon />
                      Nhờ AI chỉnh lại
                    </span>
                    <h2>Bạn muốn thay đổi điều gì?</h2>
                    <p>
                      Khi có góp ý, kế hoạch hiện tại mới được gửi lại cho AI.
                    </p>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={4000}
                    value={guidance}
                    placeholder="Ví dụ: Rút gọn lời kể, giảm số beat và làm visual dễ dựng hơn."
                    onChange={(event) => setGuidance(event.target.value)}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      plan.generating ||
                      plan.saveState === 'conflict' ||
                      codexConnection.checking ||
                      !codexConnection.generationReady
                    }
                    onClick={() => void handleGenerate()}
                  >
                    {plan.generating ? (
                      <>
                        <span className="spinner dark" />
                        AI đang chỉnh…
                      </>
                    ) : (
                      <>
                        <SparkIcon />
                        {guidance.trim()
                          ? 'Chỉnh theo góp ý'
                          : 'Tạo lại toàn bộ'}
                      </>
                    )}
                  </button>
                </section>
              )}
            </div>

            <aside className="voice-visual-side">
              <section className="outline-side-card">
                <span className="preview-label">Tổng quan</span>
                <dl>
                  <div>
                    <dt>Số beat</dt>
                    <dd>{beatCount}</dd>
                  </div>
                  <div>
                    <dt>Timing narration</dt>
                    <dd>{formatTime(totalSeconds)}</dd>
                  </div>
                  <div>
                    <dt>Ngân sách lời</dt>
                    <dd>
                      {planNarrationMetrics.whitespaceTokenCount}/
                      {targetNarrationTokenCount(outlineSeconds)}
                    </dd>
                  </div>
                  <div>
                    <dt>Trạng thái</dt>
                    <dd>{approved ? 'Đã chốt' : 'Đang review'}</dd>
                  </div>
                  <div>
                    <dt>Tự lưu</dt>
                    <dd>
                      {plan.saveState === 'saving'
                        ? 'Đang lưu…'
                        : plan.saveState === 'error'
                          ? 'Lưu lỗi'
                          : plan.saveState === 'idle'
                            ? 'Chưa hợp lệ'
                            : 'Đã lưu'}
                    </dd>
                  </div>
                </dl>

                {usage && (
                  <div className="outline-usage">
                    <span>Token lần tạo gần nhất</span>
                    <strong>
                      {usage.totalTokens.toLocaleString('vi-VN')}
                    </strong>
                    <small>
                      Input {usage.inputTokens.toLocaleString('vi-VN')} ·
                      Output {usage.outputTokens.toLocaleString('vi-VN')}
                    </small>
                    <small>
                      {project.voiceVisualPlan?.generation.model}
                      {project.voiceVisualPlan?.generation.reasoningEffort
                        ? ` · reasoning ${project.voiceVisualPlan.generation.reasoningEffort}`
                        : ''}
                    </small>
                  </div>
                )}

                <div className="outline-next-note">
                  <LightbulbIcon />
                  <p>
                    Timing dự kiến kết hợp số đơn vị tiếng Việt và số ký tự.
                    Voice thật sẽ thay bằng timestamp chính xác của ElevenLabs.
                    {draft.timingCalibration.source === 'voice-history'
                      ? ` Hiện đang hiệu chỉnh theo ${draft.timingCalibration.voiceName ?? 'voice gần nhất'} từ ${draft.timingCalibration.sampleCount} generation.`
                      : ' Hiện đang dùng tốc độ mặc định cho narration tiếng Việt.'}
                  </p>
                </div>
              </section>
            </aside>
          </div>

          <footer className="outline-final-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => navigate(projectOutlinePath(project.id))}
            >
              <ArrowLeftIcon />
              Xem lại mạch giảng
            </button>
            <div>
              <span>
                {approved
                  ? 'Kế hoạch voice–visual đã được chốt'
                  : plan.validationErrors[0] ??
                    'Review kỹ trước khi sinh scene và voice'}
              </span>
              <button
                className="submit-button"
                type="button"
                disabled={
                  plan.approving ||
                  plan.generating ||
                  (!approved && plan.stale) ||
                  plan.saveState === 'conflict'
                }
                onClick={() =>
                  approved
                    ? navigate(projectMotionCanvasPath(project.id))
                    : void handleApprove()
                }
              >
                {plan.approving ? (
                  <>
                    <span className="spinner" />
                    Đang chốt…
                  </>
                ) : approved ? (
                  <>
                    Tiếp tục Motion Canvas
                    <CheckIcon />
                  </>
                ) : (
                  <>
                    Chốt kế hoạch voice–visual
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
