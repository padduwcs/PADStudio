import {AdaptiveHeading} from './AdaptiveText.tsx';
import {defaultVideoFrame} from '../shared/videoFormat.ts';
import {
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  LayersIcon,
  SparkIcon,
} from './icons.tsx';
import {finalRenderVideoUrl} from './api.ts';
import {navigate, projectScenesPath} from './router.ts';
import {useFinalRender} from './useFinalRender.ts';

function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('vi-VN', {
    maximumFractionDigits: 1,
  })} MB`;
}

const diagnosticStageLabels = {
  preparing: 'Chuẩn bị nguồn',
  'motion-canvas': 'Motion Canvas',
  encoder: 'FFmpeg',
  browser: 'Trình duyệt render',
  finalizing: 'Kiểm tra đầu ra',
} as const;

const stateLabels = {
  queued: 'Đang xếp hàng',
  preparing: 'Đang chuẩn bị',
  rendering: 'Đang dựng hình',
  finalizing: 'Đang đóng gói MP4',
  completed: 'Hoàn tất',
  failed: 'Render thất bại',
} as const;

export function FinalRenderPage({projectId}: {projectId: string}) {
  const render = useFinalRender(projectId);

  if (render.loadState === 'loading') {
    return (
      <div className="page-state" role="status">
        <span className="spinner dark" />
        <strong>Đang kiểm tra nguồn render…</strong>
      </div>
    );
  }

  if (render.loadState === 'error' || !render.project) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Không thể mở bước final render</strong>
        <p>{render.loadError}</p>
        <button type="button" onClick={render.reload}>Thử tải lại</button>
      </div>
    );
  }

  const {project, status} = render;
  const diagnostic = status?.state === 'failed'
    ? status.diagnostic ?? null
    : null;
  const layout = project.layoutBundle;
  const bundle = project.renderBundle;
  const frame = bundle ?? project.renderProfile?.frame ?? project.topicInput.videoFrame ?? defaultVideoFrame;
  if (!render.prerequisitesReady || !layout) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Scene chưa sẵn sàng để render</strong>
        <p>Hãy lưu, xem lại và chốt scene hiện hành trước khi xuất video cuối.</p>
        <button
          type="button"
          onClick={() => navigate(
            projectScenesPath(project.id),
          )}
        >
          Về chỉnh scene
        </button>
      </div>
    );
  }

  const videoUrl = bundle
    ? `${finalRenderVideoUrl(project.id)}?v=${bundle.validation.videoHash.slice(0, 12)}`
    : '';
  const progress = Math.round((status?.progress ?? 0) * 100);
  const renderBlockedReason = render.conflict
    ? 'Project đã thay đổi ở một phiên khác. Hãy bấm “Kiểm tra lại” trước khi render.'
    : '';
  const startRender = () => render.render();

  return (
    <div className="render-workspace">
      <header className="outline-heading render-heading">
        <div className="eyebrow">
          <span>Bước 05</span>
          <span className="eyebrow-line" />
          Final render
        </div>
        <AdaptiveHeading as="h1">
          {render.ready ? 'Video cuối đã sẵn sàng.' : 'Đóng gói bài giảng thành video hoàn chỉnh.'}
        </AdaptiveHeading>
        <p>
          Hệ thống dựng scene đã chốt, ghép master narration và kiểm tra lại codec, kích thước lẫn thời lượng trước khi bàn giao.
        </p>
      </header>

      <section className="render-summary" aria-label="Cấu hình video">
        <div>
          <LayersIcon />
          <span><small>Khung hình</small><strong>{frame.width} × {frame.height}</strong></span>
        </div>
        <div>
          <ClockIcon />
          <span><small>Thời lượng</small><strong>{formatTime(layout.totalDurationSeconds)}</strong></span>
        </div>
        <div>
          <SparkIcon />
          <span><small>Đầu ra</small><strong>MP4 · H.264 · {frame.fps} fps</strong></span>
        </div>
      </section>

      {render.rendering && status && (
        <section className="render-progress-card" role="status" aria-live="polite">
          <div className="render-progress-topline">
            <span className="render-live-mark"><span /> Đang render</span>
            <strong>{progress}%</strong>
          </div>
          <h2>{stateLabels[status.state]}</h2>
          <p>{status.message}</p>
          <div
            className="render-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{width: `${progress}%`}} />
          </div>
          <div className="render-progress-meta">
            <span>{status.renderedFrames.toLocaleString('vi-VN')} / {status.totalFrames.toLocaleString('vi-VN')} frame</span>
            <span>Giữ PAD Studio và backend hoạt động cho đến khi hoàn tất</span>
          </div>
        </section>
      )}

      {render.ready && bundle && !render.rendering ? (
        <section className="render-result-card">
          <div className="render-result-heading">
            <span className="render-success-icon"><CheckIcon /></span>
            <div>
              <span className="preview-kicker">Đã xác minh đầu ra</span>
              <h2>Video bài giảng hoàn chỉnh</h2>
              <p>{formatBytes(bundle.fileSizeBytes)} · H.264 / AAC · CRF {bundle.encoding.crf}</p>
            </div>
          </div>
          <div className="render-player-shell">
            <video
              controls
              playsInline
              preload="metadata"
              src={videoUrl}
              aria-label={`Video cuối của ${project.topicInput.topic}`}
            />
          </div>
          <div className="render-result-actions">
            <a className="submit-button" href={videoUrl} download={`${project.id}.mp4`}>
              Tải video MP4
            </a>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void startRender()}
              disabled={render.rendering || Boolean(renderBlockedReason)}
            >
              Render lại
            </button>
          </div>
        </section>
      ) : !render.rendering ? (
        <section className="render-ready-card">
          <div className="render-ready-visual" aria-hidden="true">
            <span>MP4</span>
            <div><span /><span /><span /></div>
          </div>
          <div>
            <span className="preview-kicker">Nguồn đã khóa</span>
            <h2>Sẵn sàng dựng bản cuối</h2>
            <p>
              Render dùng chính master narration và scene bạn đã chốt. Video được lưu riêng theo generation nên không ghi đè bản cũ.
            </p>
            <div className="render-submit-stack">
              <button
                className="submit-button"
                type="button"
                disabled={Boolean(renderBlockedReason)}
                aria-describedby={renderBlockedReason ? 'render-blocked-reason' : undefined}
                onClick={() => void startRender()}
              >
                <SparkIcon />
                Render video cuối
              </button>
              {renderBlockedReason && (
                <small id="render-blocked-reason" className="render-blocked-reason">
                  {renderBlockedReason}
                </small>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {render.actionError && (
        <div className="inline-error render-error" role="alert">
          <strong>Chưa thể hoàn tất render</strong>
          <div className="render-error-content">
            <span>{render.actionError}</span>
            {diagnostic && (
              <>
              <small className="render-error-location">
                {diagnosticStageLabels[diagnostic.stage]}
                {diagnostic.sceneName ? ` · scene ${diagnostic.sceneName}` : ''}
                {diagnostic.frame !== null
                  ? ` · frame ${diagnostic.frame.toLocaleString('vi-VN')}`
                  : ''}
                {diagnostic.timeSeconds !== null
                  ? ` · ${formatTime(diagnostic.timeSeconds)}`
                  : ''}
              </small>
              {diagnostic.logs.length > 0 && (
                <details className="render-error-details">
                  <summary>Chi tiết kỹ thuật</summary>
                  {diagnostic.logs.map((log, index) => (
                    <div key={`${log.level}-${index}`}>
                      <strong>{log.level.toUpperCase()}</strong>
                      <pre>{[
                        log.message,
                        log.remarks,
                        log.stack,
                      ].filter(Boolean).join('\n')}</pre>
                    </div>
                  ))}
                </details>
              )}
              </>
            )}
          </div>
          <button type="button" onClick={render.reload}>Kiểm tra lại</button>
        </div>
      )}

      <footer className="outline-final-actions render-final-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={render.rendering}
          onClick={() => navigate(
            projectScenesPath(project.id),
          )}
        >
          <ArrowLeftIcon />
          Xem lại scene
        </button>
        <span>{render.ready ? 'Artifact đã được hash và kiểm tra bằng ffprobe' : 'Scene đã chốt · sẵn sàng xuất bản'}</span>
      </footer>
    </div>
  );
}
