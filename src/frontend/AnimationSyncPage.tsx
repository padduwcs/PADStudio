import {useEffect, useRef, useState} from 'react';
import {AdaptiveHeading} from './AdaptiveText.tsx';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  LayersIcon,
  LightbulbIcon,
  SparkIcon,
} from './icons.tsx';
import {animationSyncAudioUrl} from './api.ts';
import {
  navigate,
  projectLayoutPath,
  projectMotionCanvasPath,
  projectVoicePath,
} from './router.ts';
import {ResponsiveAside} from './ResponsiveAside.tsx';
import {useAnimationSyncDraft} from './useAnimationSyncDraft.ts';

function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function formatSeconds(seconds: number) {
  return `${seconds.toLocaleString('vi-VN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })}s`;
}

function formatDelta(seconds: number) {
  const rounded = Math.abs(seconds) < 0.005 ? 0 : seconds;
  const prefix = rounded > 0 ? '+' : '';
  return `${prefix}${rounded.toLocaleString('vi-VN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })}s`;
}

export function AnimationSyncPage({projectId}: {projectId: string}) {
  const sync = useAnimationSyncDraft(projectId);
  const [copied, setCopied] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewPlayed, setPreviewPlayed] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const previewGenerationId =
    sync.project?.animationSyncBundle?.generation.generationId ?? '';

  useEffect(() => {
    setPreviewReady(false);
    setPreviewPlayed(false);
    setPlayerError('');
  }, [previewGenerationId]);

  useEffect(() => {
    function receivePreviewMessage(event: MessageEvent) {
      if (
        event.source !== previewFrameRef.current?.contentWindow ||
        !sync.previewUrl
      ) {
        return;
      }
      let previewOrigin = '';
      try {
        previewOrigin = new URL(sync.previewUrl).origin;
      } catch {
        return;
      }
      if (event.origin !== previewOrigin) return;
      const message = event.data as {
        source?: string;
        type?: string;
        generationId?: string;
        message?: string;
      };
      if (
        message?.source !== 'pad-studio-sync-preview' ||
        message.generationId !== previewGenerationId
      ) {
        return;
      }
      if (message.type === 'ready') {
        setPreviewReady(true);
        setPlayerError('');
      } else if (message.type === 'played') {
        setPreviewPlayed(true);
      } else if (message.type === 'error') {
        setPlayerError(
          message.message || 'Player không thể phát bản nháp này.',
        );
      }
    }

    window.addEventListener('message', receivePreviewMessage);
    return () =>
      window.removeEventListener('message', receivePreviewMessage);
  }, [previewGenerationId, sync.previewUrl]);

  async function copyServeCommand() {
    if (!sync.serveCommand) return;
    try {
      await navigator.clipboard.writeText(sync.serveCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  if (sync.loadState === 'loading') {
    return (
      <div className="page-state" role="status">
        <span className="spinner dark" />
        <strong>Đang đọc timing scene và voice…</strong>
      </div>
    );
  }

  if (sync.loadState === 'error' || !sync.project) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Không thể mở bước đồng bộ</strong>
        <p>{sync.loadError}</p>
        <button type="button" onClick={() => navigate('/')}>
          Về project mới
        </button>
      </div>
    );
  }

  const {project} = sync;
  const motion = project.motionCanvasBundle;
  const voice = project.voiceBundle;
  const outline = project.outline;

  if (!sync.upstreamReady || !motion || !voice || !outline) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Pipeline chưa sẵn sàng đồng bộ</strong>
        <p>
          Motion Canvas và voice phải được chốt, đồng thời cùng tham chiếu kế
          hoạch voice–visual hiện tại.
        </p>
        <button
          type="button"
          onClick={() => navigate(projectVoicePath(project.id))}
        >
          Về bước voice
        </button>
      </div>
    );
  }

  if (sync.legacy) {
    return (
      <div className="sync-workspace">
        <header className="outline-heading">
          <div className="eyebrow">
            <span>Bước 06</span>
            <span className="eyebrow-line" />
            Đồng bộ
          </div>
          <AdaptiveHeading as="h1">
            Scene cần timing contract trước khi ghép voice.
          </AdaptiveHeading>
          <p>
            Workspace hiện tại là bản legacy nên không có đủ time-event theo
            beat để điều khiển animation một cách an toàn.
          </p>
        </header>
        <section className="sync-blocked-card" role="alert">
          <span className="sync-blocked-icon">
            <ClockIcon />
          </span>
          <div>
            <span className="preview-kicker">Cần sinh lại scene</span>
            <h2>Không đoán timing từ source cũ</h2>
            <p>
              PAD Studio chỉ đồng bộ khi mỗi beat có đúng event start/end và
              dùng <code>useDuration</code>. Sinh lại Motion Canvas sẽ tạo
              contract này mà không thay đổi voice đã có.
            </p>
          </div>
          <button
            className="submit-button"
            type="button"
            onClick={() => navigate(projectMotionCanvasPath(project.id))}
          >
            Sinh lại Motion Canvas
            <SparkIcon />
          </button>
        </section>
      </div>
    );
  }

  const bundle = project.animationSyncBundle;
  const approved =
    bundle?.status === 'approved' && !sync.stale;
  const totalPlanned =
    bundle?.sections.reduce(
      (total, section) => total + section.plannedDurationSeconds,
      0,
    ) ??
    motion.scenes.reduce(
      (total, scene) => total + scene.durationSeconds,
      0,
    );
  const totalDrift = (bundle?.totalDurationSeconds ?? 0) - totalPlanned;

  return (
    <div className="sync-workspace">
      <header className="outline-heading">
        <div className="eyebrow">
          <span>Bước 06</span>
          <span className="eyebrow-line" />
          Đồng bộ animation
        </div>
        <AdaptiveHeading as="h1">
          Cho animation đi đúng nhịp của giọng đọc thật.
        </AdaptiveHeading>
        <p>
          PAD Studio ánh xạ timing ElevenLabs vào time-event của từng beat,
          ghép narration và tạo một workspace Motion Canvas bất biến để review.
        </p>
      </header>

      {sync.conflict && (
        <div className="outline-alert is-error" role="alert">
          <span>Project vừa thay đổi ở nơi khác.</span>
          <button type="button" onClick={sync.reload}>
            Tải lại
          </button>
        </div>
      )}
      {sync.stale && (
        <div className="outline-alert" role="status">
          Scene hoặc voice đã thay đổi. Bản đồng bộ hiện tại cần được tạo lại.
        </div>
      )}
      {sync.actionError && (
        <div className="outline-alert is-error" role="alert">
          {sync.actionError}
        </div>
      )}

      {!bundle ? (
        <div className="sync-empty-grid">
          <section className="sync-ready-card">
            <div className="outline-card-heading">
              <span className="preview-kicker">
                <SparkIcon />
                Đủ dữ liệu để đồng bộ
              </span>
              <span className="draft-status is-saved">
                <span />
                Voice đã chốt
              </span>
            </div>
            <div className="sync-flow-visual" aria-hidden="true">
              <span className="sync-flow-source">Animation</span>
              <span className="sync-flow-line">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="sync-flow-target">Voice timing</span>
            </div>
            <div className="sync-ready-copy">
              <h2>Tạo timeline từ {voice.sections.length} section voice</h2>
              <p>
                Thao tác chạy cục bộ, không gọi AI và không tiêu thêm token hay
                credit ElevenLabs. FFmpeg chỉ trim/ghép các audio đã có.
              </p>
            </div>
            <footer className="outline-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => navigate(projectVoicePath(project.id))}
              >
                <ArrowLeftIcon />
                Nghe lại voice
              </button>
              <button
                className="submit-button"
                type="button"
                disabled={sync.generating || sync.conflict}
                onClick={() => void sync.generate()}
              >
                {sync.generating ? (
                  <>
                    <span className="spinner" />
                    Đang ghép và validate…
                  </>
                ) : (
                  <>
                    Đồng bộ animation
                    <SparkIcon />
                  </>
                )}
              </button>
            </footer>
          </section>
          <ResponsiveAside label="Nguồn đã khóa">
            <section className="outline-side-card sync-prerequisite-card">
              <span className="preview-label">Nguồn đã khóa</span>
              <dl>
                <div>
                  <dt>Scene</dt>
                  <dd>{motion.scenes.length}</dd>
                </div>
                <div>
                  <dt>Beat timing</dt>
                  <dd>
                    {motion.scenes.reduce(
                      (total, scene) =>
                        total + (scene.timingEvents?.length ?? 0),
                      0,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Voice</dt>
                  <dd>{formatTime(voice.totalDurationSeconds)}</dd>
                </div>
                <div>
                  <dt>Contract</dt>
                  <dd>Timing v1</dd>
                </div>
              </dl>
              <div className="outline-next-note">
                <LightbulbIcon />
                <p>
                  Generation Motion Canvas và voice nguồn không bị sửa. Bản đồng
                  bộ được lưu trong workspace riêng.
                </p>
              </div>
            </section>
          </ResponsiveAside>
        </div>
      ) : (
        <>
          <section className="sync-preview-review">
            <header>
              <div>
                <span className="preview-kicker">
                  <LayersIcon />
                  Bản nháp cần xem trước khi chốt
                </span>
                <h2>Xem animation và voice chạy cùng nhau</h2>
                <p>
                  Phát từ đầu, tua qua các section và nghe tại những điểm chuyển
                  beat. Đây là preview trực tiếp của đúng workspace đã đồng bộ.
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={sync.generating || sync.conflict}
                onClick={() => void sync.generate()}
              >
                {sync.generating ? (
                  <>
                    <span className="spinner dark" />
                    Đang đồng bộ lại…
                  </>
                ) : (
                  <>
                    <SparkIcon />
                    Đồng bộ lại
                  </>
                )}
              </button>
            </header>

            <div className="sync-preview-player">
              {sync.previewState === 'loading' && (
                <div className="sync-preview-state" role="status">
                  <span className="spinner" />
                  <strong>Đang khởi động player Motion Canvas…</strong>
                  <p>Scene và narration đang được nạp vào cùng một playhead.</p>
                </div>
              )}
              {sync.previewState === 'error' && (
                <div className="sync-preview-state is-error" role="alert">
                  <strong>Chưa mở được bản nháp</strong>
                  <p>{sync.previewError}</p>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={sync.retryPreview}
                  >
                    Thử mở lại player
                  </button>
                </div>
              )}
              {sync.previewState === 'ready' && sync.previewUrl && (
                <iframe
                  ref={previewFrameRef}
                  key={previewGenerationId}
                  title="Bản nháp animation và voice đã đồng bộ"
                  src={sync.previewUrl}
                  allow="autoplay; fullscreen"
                  sandbox="allow-scripts allow-same-origin"
                  referrerPolicy="no-referrer"
                  allowFullScreen
                />
              )}
            </div>

            <footer className="sync-preview-verdict">
              <div
                className={`sync-review-check${previewReady ? ' is-done' : ''}`}
              >
                <span>{previewReady ? <CheckIcon /> : '1'}</span>
                <div>
                  <strong>Player tải đúng generation</strong>
                  <small>
                    {previewReady
                      ? 'Animation và narration đã sẵn sàng'
                      : 'Đợi khung hình đầu tiên xuất hiện'}
                  </small>
                </div>
              </div>
              <div
                className={`sync-review-check${previewPlayed ? ' is-done' : ''}`}
              >
                <span>{previewPlayed ? <CheckIcon /> : '2'}</span>
                <div>
                  <strong>Đã phát bản nháp</strong>
                  <small>
                    {previewPlayed
                      ? 'Có thể chốt nếu hình và tiếng đã khớp'
                      : 'Bấm Phát trong player để kiểm tra đồng bộ'}
                  </small>
                </div>
              </div>
              {playerError && (
                <p className="sync-player-error" role="alert">
                  {playerError}
                </p>
              )}
            </footer>
          </section>

          <div className="sync-summary-grid">
            <section className="sync-overview-card">
              <header>
                <div>
                  <span className="preview-kicker">
                    <CheckIcon />
                    Timeline đã ánh xạ
                  </span>
                  <h2>Narration và animation cùng một trục thời gian</h2>
                </div>
                <span
                  className={`draft-status${approved ? ' is-saved' : ''}`}
                >
                  <span />
                  {approved ? 'Đã chốt' : 'Chờ review'}
                </span>
              </header>
              <div className="sync-metrics">
                <div>
                  <span>Kế hoạch</span>
                  <strong>{formatTime(totalPlanned)}</strong>
                </div>
                <div>
                  <span>Voice thật</span>
                  <strong>{formatTime(bundle.totalDurationSeconds)}</strong>
                </div>
                <div>
                  <span>Điều chỉnh</span>
                  <strong className={totalDrift > 0 ? 'is-longer' : ''}>
                    {formatDelta(totalDrift)}
                  </strong>
                </div>
              </div>
              <div className="sync-audio-review">
                <div>
                  <span className="preview-label">Narration đã ghép</span>
                  <small>
                    WAV {formatTime(bundle.validation.audioDurationSeconds)}
                  </small>
                </div>
                <audio
                  controls
                  preload="metadata"
                  src={animationSyncAudioUrl(
                    project.id,
                    bundle.generation.generationId,
                  )}
                />
              </div>
            </section>

            <ResponsiveAside label="Workspace đồng bộ">
              <section className="sync-workspace-card">
                <span className="preview-label">Workspace đã validate</span>
                <code>{bundle.workspacePath}</code>
                <dl>
                  <div>
                    <dt>Motion Canvas</dt>
                    <dd>{bundle.validation.motionCanvasVersion}</dd>
                  </div>
                  <div>
                    <dt>Source hash</dt>
                    <dd>{bundle.validation.sourceHash.slice(0, 10)}…</dd>
                  </div>
                </dl>
                {sync.serveCommand && (
                  <button type="button" onClick={() => void copyServeCommand()}>
                    {copied ? 'Đã sao chép lệnh' : 'Sao chép lệnh preview'}
                  </button>
                )}
              </section>
            </ResponsiveAside>
          </div>

          <details className="sync-timeline-details">
            <summary>
              <span>
                <strong>Thông số timing chi tiết</strong>
                <small>
                  Mở khi cần xác định section hoặc beat đang nhanh/chậm
                </small>
              </span>
              <span>{bundle.sections.length} section</span>
            </summary>
            <div className="sync-section-list">
              {bundle.sections.map((section, sectionIndex) => {
                const outlineSection = outline.sections[sectionIndex];
                return (
                  <article
                    className="sync-section-card"
                    key={section.outlineSectionId}
                  >
                    <header>
                      <span className="outline-section-index">
                        {String(sectionIndex + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <h3>{outlineSection?.title ?? `Section ${sectionIndex + 1}`}</h3>
                        <p>
                          {formatSeconds(section.plannedDurationSeconds)}
                          {' → '}
                          {formatSeconds(section.synchronizedDurationSeconds)}
                        </p>
                      </div>
                      <span
                        className={`sync-drift${
                          section.driftSeconds > 0 ? ' is-longer' : ''
                        }`}
                      >
                        {formatDelta(section.driftSeconds)}
                      </span>
                    </header>
                    <div className="sync-beat-list">
                      {section.beats.map((beat, beatIndex) => {
                        const delta =
                          beat.synchronizedDurationSeconds -
                          beat.plannedDurationSeconds;
                        return (
                          <div className="sync-beat-row" key={beat.beatId}>
                            <span>{beatIndex + 1}</span>
                            <div>
                              <strong>
                                {formatSeconds(beat.voiceStartSeconds)}
                                {' — '}
                                {formatSeconds(beat.voiceEndSeconds)}
                              </strong>
                              <small>
                                Kế hoạch {formatSeconds(beat.plannedDurationSeconds)}
                              </small>
                            </div>
                            <span className={delta > 0 ? 'is-longer' : ''}>
                              {formatDelta(delta)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          </details>

          <footer className="outline-final-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => navigate(projectVoicePath(project.id))}
            >
              <ArrowLeftIcon />
              Nghe lại voice
            </button>
            <div>
              <span>
                {approved
                  ? 'Bản đồng bộ đã sẵn sàng cho Layout Editor'
                  : previewPlayed
                    ? 'Nếu hình và tiếng đã khớp, bạn có thể chốt'
                    : 'Hãy phát bản nháp audio–animation trước khi chốt'}
              </span>
              <button
                className="submit-button"
                type="button"
                disabled={
                  sync.approving ||
                  sync.generating ||
                  sync.stale ||
                  sync.conflict ||
                  (!approved &&
                    (!previewReady ||
                      !previewPlayed ||
                      Boolean(playerError)))
                }
                onClick={() => {
                  if (approved) {
                    navigate(projectLayoutPath(project.id));
                  } else {
                    void sync.approve();
                  }
                }}
              >
                {sync.approving ? (
                  <>
                    <span className="spinner" />
                    Đang chốt…
                  </>
                ) : approved ? (
                  <>
                    Mở Layout Editor
                    <ArrowRightIcon />
                  </>
                ) : (
                  <>
                    Chốt bản đồng bộ
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
