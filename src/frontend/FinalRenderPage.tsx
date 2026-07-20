import {useEffect, useState} from 'react';
import type {
  RenderWatermark,
  WatermarkPosition,
} from '../shared/render.ts';
import {AdaptiveHeading} from './AdaptiveText.tsx';
import {
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  LayersIcon,
  SparkIcon,
} from './icons.tsx';
import {
  ApiRequestError,
  finalRenderVideoUrl,
  uploadWatermarkImage,
} from './api.ts';
import {navigate, projectLayoutPath} from './router.ts';
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
  const [playbackRate, setPlaybackRate] = useState(1);
  const [watermark, setWatermark] = useState<RenderWatermark>({type: 'none'});
  const [watermarkUploading, setWatermarkUploading] = useState(false);
  const [watermarkUploadError, setWatermarkUploadError] = useState('');
  const [watermarkFileName, setWatermarkFileName] = useState('');

  useEffect(() => {
    const bundle = render.project?.renderBundle;
    if (!bundle) return;
    setPlaybackRate(bundle.playbackRate);
    setWatermark(bundle.watermark);
  }, [render.project?.renderBundle?.generation.generationId]);

  useEffect(() => {
    if (!watermarkUploading) return;
    const timeout = window.setTimeout(() => {
      setWatermarkUploading(false);
      setWatermarkUploadError(
        'Phiên tải ảnh không phản hồi nên đã được mở khóa. Hãy chọn ảnh và thử lại.',
      );
    }, 35_000);
    return () => window.clearTimeout(timeout);
  }, [watermarkUploading]);

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
  const layout = project.layoutBundle;
  const bundle = project.renderBundle;
  if (!render.prerequisitesReady || !layout) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Layout chưa sẵn sàng để render</strong>
        <p>Hãy lưu, xem lại và chốt Layout hiện hành trước khi xuất video cuối.</p>
        <button
          type="button"
          onClick={() => navigate(projectLayoutPath(project.id))}
        >
          Về Layout Editor
        </button>
      </div>
    );
  }

  const videoUrl = bundle
    ? `${finalRenderVideoUrl(project.id)}?v=${bundle.validation.videoHash.slice(0, 12)}`
    : '';
  const progress = Math.round((status?.progress ?? 0) * 100);
  const estimatedDuration = layout.totalDurationSeconds / playbackRate;
  const watermarkValid =
    watermark.type === 'none' ||
    (watermark.type === 'text' ? Boolean(watermark.text.trim()) : Boolean(watermark.assetId));
  const renderBlockedReason = render.conflict
    ? 'Project đã thay đổi ở một phiên khác. Hãy bấm “Kiểm tra lại” trước khi render.'
    : watermarkUploading
      ? 'Đang tải và kiểm tra ảnh watermark…'
      : watermark.type === 'image' && !watermark.assetId
        ? 'Hãy tải ảnh watermark thành công, hoặc chọn “Không dùng”.'
        : watermark.type === 'text' && !watermark.text.trim()
          ? 'Hãy nhập nội dung watermark, hoặc chọn “Không dùng”.'
          : '';
  const startRender = () => render.render({playbackRate, watermark});

  return (
    <div className="render-workspace">
      <header className="outline-heading render-heading">
        <div className="eyebrow">
          <span>Bước 08</span>
          <span className="eyebrow-line" />
          Final render
        </div>
        <AdaptiveHeading as="h1">
          {render.ready ? 'Video cuối đã sẵn sàng.' : 'Đóng gói bài giảng thành video hoàn chỉnh.'}
        </AdaptiveHeading>
        <p>
          Motion Canvas dựng đúng Layout đã chốt, sau đó FFmpeg ghép master narration
          và kiểm tra lại codec, kích thước lẫn thời lượng trước khi bàn giao.
        </p>
      </header>

      <section className="render-summary" aria-label="Cấu hình video">
        <div>
          <LayersIcon />
          <span><small>Khung hình</small><strong>1080 × 1920</strong></span>
        </div>
        <div>
          <ClockIcon />
          <span><small>Ước tính sau tốc độ</small><strong>{formatTime(estimatedDuration)}</strong></span>
        </div>
        <div>
          <SparkIcon />
          <span><small>Đầu ra</small><strong>MP4 · H.264 · 30 fps</strong></span>
        </div>
      </section>

      <section className="render-options-card" aria-label="Tùy chọn render">
        <div className="render-option-heading">
          <div>
            <span className="preview-kicker">Tùy chọn bản xuất</span>
            <h2>Tốc độ và watermark</h2>
          </div>
          <span>{playbackRate.toLocaleString('vi-VN', {maximumFractionDigits: 2})}× · khoảng {formatTime(estimatedDuration)}</span>
        </div>

        <div className="render-speed-control">
          <label htmlFor="render-speed">Tốc độ video cuối</label>
          <input
            id="render-speed"
            type="range"
            min="0.25"
            max="4"
            step="0.05"
            value={playbackRate}
            disabled={render.rendering}
            onChange={event => setPlaybackRate(Number(event.target.value))}
          />
          <input
            className="render-speed-number"
            type="number"
            min="0.25"
            max="4"
            step="0.05"
            value={playbackRate}
            disabled={render.rendering}
            aria-label="Tốc độ video"
            onChange={event => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) setPlaybackRate(Math.min(4, Math.max(0.25, value)));
            }}
          />
          <small>Nguồn chuẩn {formatTime(layout.totalDurationSeconds)}; giọng được đổi tốc độ nhưng giữ cao độ.</small>
        </div>

        <div className="watermark-controls">
          <span className="render-control-label">Watermark</span>
          <div className="watermark-mode-tabs">
            {(['none', 'text', 'image'] as const).map(type => (
              <button
                type="button"
                key={type}
                className={watermark.type === type ? 'is-selected' : ''}
                disabled={render.rendering}
                onClick={() => {
                  setWatermarkUploadError('');
                  setWatermarkFileName('');
                  setWatermark(
                    type === 'none'
                      ? {type: 'none'}
                      : type === 'text'
                        ? {type: 'text', text: '', opacity: 0.3, position: 'bottom-right', fontSize: 44, color: '#ffffff'}
                        : {type: 'image', assetId: '', opacity: 0.3, position: 'bottom-right', widthPercent: 22},
                  );
                }}
              >
                {type === 'none' ? 'Không dùng' : type === 'text' ? 'Chèn chữ' : 'Tải ảnh'}
              </button>
            ))}
          </div>

          {watermark.type !== 'none' && (
            <div className="watermark-detail-grid">
              {watermark.type === 'text' ? (
                <>
                  <label className="watermark-wide-field">
                    <span>Nội dung</span>
                    <input
                      type="text"
                      maxLength={120}
                      value={watermark.text}
                      disabled={render.rendering}
                      placeholder="Tên kênh hoặc thương hiệu"
                      onChange={event => setWatermark({...watermark, text: event.target.value})}
                    />
                  </label>
                  <label>
                    <span>Cỡ chữ</span>
                    <input
                      type="number"
                      min={16}
                      max={200}
                      value={watermark.fontSize}
                      disabled={render.rendering}
                      onChange={event => setWatermark({...watermark, fontSize: Math.min(200, Math.max(16, Number(event.target.value) || 16))})}
                    />
                  </label>
                  <label>
                    <span>Màu chữ</span>
                    <input
                      type="color"
                      value={watermark.color}
                      disabled={render.rendering}
                      onChange={event => setWatermark({...watermark, color: event.target.value})}
                    />
                  </label>
                </>
              ) : (
                <label className="watermark-wide-field watermark-file-field">
                  <span>Ảnh PNG, JPEG hoặc WebP · tối đa 5 MB</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={render.rendering || watermarkUploading}
                    onChange={event => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      event.currentTarget.value = '';
                      setWatermarkUploading(true);
                      setWatermarkUploadError('');
                      void uploadWatermarkImage(project.id, file)
                        .then(asset => {
                          setWatermark(current => current.type === 'image'
                            ? {...current, assetId: asset.assetId}
                            : current);
                          setWatermarkFileName(file.name);
                        })
                        .catch(error => setWatermarkUploadError(
                          error instanceof ApiRequestError
                            ? error.message
                            : 'Không thể tải ảnh watermark.',
                        ))
                        .finally(() => setWatermarkUploading(false));
                    }}
                  />
                  <small>{watermarkUploading ? 'Đang kiểm tra và lưu ảnh…' : watermarkFileName || (watermark.assetId ? 'Ảnh watermark đã sẵn sàng.' : 'Chưa chọn ảnh.')}</small>
                </label>
              )}
              <label>
                <span>Vị trí</span>
                <select
                  value={watermark.position}
                  disabled={render.rendering}
                  onChange={event => setWatermark({...watermark, position: event.target.value as WatermarkPosition})}
                >
                  <option value="top-left">Trên trái</option>
                  <option value="top-right">Trên phải</option>
                  <option value="bottom-left">Dưới trái</option>
                  <option value="bottom-right">Dưới phải</option>
                  <option value="center">Chính giữa</option>
                </select>
              </label>
              <label>
                <span>Độ mờ · {Math.round(watermark.opacity * 100)}%</span>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={watermark.opacity}
                  disabled={render.rendering}
                  onChange={event => setWatermark({...watermark, opacity: Number(event.target.value)})}
                />
              </label>
              {watermark.type === 'image' && (
                <label>
                  <span>Chiều rộng · {Math.round(watermark.widthPercent)}%</span>
                  <input
                    type="range"
                    min="5"
                    max="80"
                    step="1"
                    value={watermark.widthPercent}
                    disabled={render.rendering}
                    onChange={event => setWatermark({...watermark, widthPercent: Number(event.target.value)})}
                  />
                </label>
              )}
            </div>
          )}
          {watermarkUploadError && <small className="watermark-upload-error">{watermarkUploadError}</small>}
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
              disabled={render.rendering || !watermarkValid || watermarkUploading}
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
              Render dùng chính master narration và Layout generation đã duyệt.
              Video được lưu riêng theo generation nên không ghi đè bản cũ.
            </p>
            <div className="render-submit-stack">
              <button
                className={`submit-button${watermarkUploading ? ' is-busy' : ''}`}
                type="button"
                disabled={Boolean(renderBlockedReason) || !watermarkValid}
                aria-busy={watermarkUploading}
                aria-describedby={renderBlockedReason ? 'render-blocked-reason' : undefined}
                onClick={() => void startRender()}
              >
                {watermarkUploading ? <span className="spinner" /> : <SparkIcon />}
                {watermarkUploading ? 'Đang tải watermark…' : 'Render video cuối'}
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
          <span>{render.actionError}</span>
          <button type="button" onClick={render.reload}>Kiểm tra lại</button>
        </div>
      )}

      <footer className="outline-final-actions render-final-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={render.rendering}
          onClick={() => navigate(projectLayoutPath(project.id))}
        >
          <ArrowLeftIcon />
          Xem lại Layout
        </button>
        <span>{render.ready ? 'Artifact đã được hash và kiểm tra bằng ffprobe' : 'Layout đã duyệt · sẵn sàng xuất bản'}</span>
      </footer>
    </div>
  );
}
