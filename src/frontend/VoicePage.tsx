import {type FormEvent, useState} from 'react';
import {AdaptiveHeading} from './AdaptiveText.tsx';
import {ElevenLabsConnectionCard} from './ElevenLabsConnectionCard.tsx';
import {
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  LightbulbIcon,
  SparkIcon,
} from './icons.tsx';
import {voiceAudioUrl} from './api.ts';
import {navigate, projectMotionCanvasPath} from './router.ts';
import {useElevenLabsConnection} from './useElevenLabsConnection.ts';
import {
  type VoiceDraftConfiguration,
  useVoiceDraft,
} from './useVoiceDraft.ts';

function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function settingLabel(value: number) {
  return value.toLocaleString('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sameVoiceConfiguration(
  left: VoiceDraftConfiguration,
  right: VoiceDraftConfiguration,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function VoicePage({projectId}: {projectId: string}) {
  const voice = useVoiceDraft(projectId);
  const connection = useElevenLabsConnection();
  const [search, setSearch] = useState('');
  const [showAllVoices, setShowAllVoices] = useState(false);

  async function handleGenerate() {
    if (voice.generating || connection.checking) return;
    const status = await connection.verify();
    if (status?.state !== 'connected') return;
    await voice.generate();
  }

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setShowAllVoices(false);
    void voice.searchVoices(search);
  }

  if (voice.loadState === 'loading') {
    return (
      <div className="page-state" role="status">
        <span className="spinner dark" />
        <strong>Đang chuẩn bị studio voice…</strong>
      </div>
    );
  }

  if (voice.loadState === 'error' || !voice.project) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Không thể mở bước tạo voice</strong>
        <p>{voice.loadError}</p>
        <button type="button" onClick={() => navigate('/')}>
          Về project mới
        </button>
      </div>
    );
  }

  const {project} = voice;
  const plan = project.voiceVisualPlan;
  const outline = project.outline;
  const motion = project.motionCanvasBundle;
  if (!outline || !plan || !motion || !voice.ready) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Pipeline chưa sẵn sàng tạo voice</strong>
        <p>
          Hãy chốt kế hoạch voice–visual và Motion Canvas hiện tại trước khi
          dùng credit ElevenLabs.
        </p>
        <button
          type="button"
          onClick={() => navigate(projectMotionCanvasPath(project.id))}
        >
          Về Motion Canvas
        </button>
      </div>
    );
  }

  const bundle = project.voiceBundle;
  const approved = bundle?.status === 'approved' && !voice.stale;
  const bundleConfiguration: VoiceDraftConfiguration | null = bundle
    ? {
        voiceId: bundle.configuration.voiceId,
        modelId: bundle.configuration.modelId,
        outputFormat: bundle.configuration.outputFormat,
        settings: bundle.configuration.settings,
        seed: bundle.configuration.seed,
      }
    : null;
  const configurationChanged = Boolean(
    bundleConfiguration &&
      voice.configuration &&
      !sameVoiceConfiguration(bundleConfiguration, voice.configuration),
  );
  const freeTier =
    connection.status?.state === 'connected' &&
    connection.status.subscription.tier.toLowerCase() === 'free';
  const selectedRequiresPaid =
    freeTier &&
    Boolean(voice.selectedVoice?.requiresPaidApiOnFreeTier);
  const characterCount = plan.sections.reduce(
    (total, section) =>
      total +
      section.beats.reduce(
        (sectionTotal, beat) =>
          sectionTotal + Array.from(beat.voiceover.trim()).length,
        0,
      ) +
      Math.max(0, section.beats.length - 1) * 2,
    0,
  );
  const catalogVoices = voice.catalog?.voices ?? [];
  const orderedVoices = voice.selectedVoice
    ? [
        voice.selectedVoice,
        ...catalogVoices.filter(
          (item) => item.voiceId !== voice.selectedVoice?.voiceId,
        ),
      ]
    : catalogVoices;
  const visibleVoices = showAllVoices
    ? orderedVoices
    : orderedVoices.slice(0, 6);

  return (
    <div className="voice-workspace">
      <header className="outline-heading">
        <div className="eyebrow">
          <span>Bước 05</span>
          <span className="eyebrow-line" />
          ElevenLabs Voice
        </div>
        <AdaptiveHeading as="h1">
          Tạo giọng đọc thật, rồi review từng section.
        </AdaptiveHeading>
        <p>
          PAD Studio gọi TTS có timestamps, giữ audio theo generation và ánh xạ
          timing về đúng beat ID để sẵn sàng đồng bộ animation ở bước sau.
        </p>
      </header>

      <div className="outline-codex integration-connections">
        <ElevenLabsConnectionCard connection={connection} />
      </div>

      {(voice.actionError || voice.catalogError) && (
        <div className="outline-alert is-error" role="alert">
          {voice.actionError || voice.catalogError}
        </div>
      )}
      {voice.conflict && (
        <div className="outline-alert is-error" role="alert">
          <span>Project vừa thay đổi ở nơi khác.</span>
          <button type="button" onClick={() => void voice.reload()}>
            Tải lại
          </button>
        </div>
      )}
      {voice.stale && (
        <div className="outline-alert" role="status">
          Lời đọc đã thay đổi. Audio hiện tại chỉ còn để tham khảo; hãy tạo một
          generation mới.
        </div>
      )}

      <div className="voice-editor-grid">
        <div className="voice-main">
          <section className="outline-primary-card voice-config-card">
            <div className="outline-card-heading">
              <span className="preview-kicker">
                <SparkIcon />
                Cấu hình generation
              </span>
              <span className="draft-status">
                <span />
                Chỉ tiêu credit khi tạo
              </span>
            </div>

            <form className="voice-search" onSubmit={handleSearch}>
              <label htmlFor="voice-search">Tìm giọng đọc theo tên hoặc ID</label>
              <div>
                <input
                  id="voice-search"
                  value={search}
                  maxLength={120}
                  placeholder="Tên giọng hoặc voice ID"
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={voice.catalogLoading}
                >
                  {voice.catalogLoading
                    ? 'Đang tìm…'
                    : 'Tìm trong tài khoản'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={voice.catalogLoading || !search.trim()}
                  onClick={() => {
                    setShowAllVoices(false);
                    void voice.searchVoices(search, true);
                  }}
                >
                  Voice Library
                </button>
              </div>
            </form>

            {voice.catalog?.recentPresets.length ? (
              <div className="voice-presets">
                <span className="preview-label">Đã dùng thành công</span>
                <div>
                  {voice.catalog.recentPresets.slice(0, 6).map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      onClick={() => voice.applyPreset(preset.id)}
                    >
                      <strong>{preset.voiceName}</strong>
                      <span>{preset.modelName}</span>
                      <small>
                        {preset.source === 'pad-studio'
                          ? `${preset.successfulGenerations} generation PAD Studio`
                          : 'Lịch sử ElevenLabs'}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {voice.catalog?.history.message && (
              <p className="voice-inline-note">
                {voice.catalog.history.message}
              </p>
            )}
            {voice.libraryMessage && (
              <p className="voice-inline-note">{voice.libraryMessage}</p>
            )}

            {voice.catalogLoading && !voice.catalog && (
              <div className="voice-catalog-loading" role="status">
                <span className="spinner dark" />
                Đang tải voice và model từ tài khoản ElevenLabs…
              </div>
            )}

            <div className="voice-choice-grid">
              <div>
                <div className="voice-choice-heading">
                  <span className="preview-label">Voice</span>
                  <small>
                    {voice.catalog?.voices.length ?? 0} kết quả
                  </small>
                </div>
                <div className="voice-choice-list">
                  {visibleVoices.map((item) => (
                    <div
                      className={`voice-choice${item.previewUrl ? ' has-preview' : ''}${voice.configuration?.voiceId === item.voiceId ? ' is-selected' : ''}`}
                      key={item.voiceId}
                    >
                      <label className="voice-choice-select">
                        <input
                          type="radio"
                          name="voice"
                          disabled={
                            freeTier &&
                            item.requiresPaidApiOnFreeTier
                          }
                          checked={
                            voice.configuration?.voiceId === item.voiceId
                          }
                          onChange={() =>
                            voice.updateConfiguration((current) => {
                              const recommendedModel =
                                voice.catalog?.models.find(
                                  (model) =>
                                    model.modelId === 'eleven_v3' &&
                                    model.languages.includes('vi'),
                                ) ??
                                item.highQualityBaseModelIds
                                  .map((modelId) =>
                                    voice.catalog?.models.find(
                                      (model) =>
                                        model.modelId === modelId &&
                                        model.languages.includes('vi'),
                                    ),
                                  )
                                  .find(
                                    (model) => model !== undefined,
                                  );
                              if (!recommendedModel) {
                                return {
                                  ...current,
                                  voiceId: item.voiceId,
                                };
                              }
                              return {
                                ...current,
                                voiceId: item.voiceId,
                                modelId: recommendedModel.modelId,
                                settings: {
                                  ...current.settings,
                                  style: recommendedModel.canUseStyle
                                    ? current.settings.style
                                    : 0,
                                  useSpeakerBoost:
                                    recommendedModel.canUseSpeakerBoost &&
                                    current.settings.useSpeakerBoost,
                                },
                              };
                            })
                          }
                        />
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.labels.accent ??
                              item.labels.description ??
                              item.category ??
                              'Voice ElevenLabs'}
                            {freeTier &&
                            item.requiresPaidApiOnFreeTier
                              ? ' · API cần gói trả phí'
                              : ''}
                          </small>
                        </span>
                      </label>
                      {item.previewUrl && (
                        <audio
                          controls
                          preload="none"
                          src={item.previewUrl}
                          aria-label={`Nghe thử voice ${item.name}`}
                        />
                      )}
                    </div>
                  ))}
                  {!voice.catalogLoading &&
                    voice.catalog?.voices.length === 0 && (
                      <p className="voice-inline-note">
                        Không có voice khớp tìm kiếm. Có thể dán chính xác voice
                        ID rồi tìm lại.
                      </p>
                    )}
                  {orderedVoices.length > 6 && (
                    <button
                      className="voice-show-more"
                      type="button"
                      onClick={() =>
                        setShowAllVoices((current) => !current)
                      }
                    >
                      {showAllVoices
                        ? 'Thu gọn danh sách'
                        : `Xem thêm ${orderedVoices.length - 6} voice`}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <div className="voice-choice-heading">
                  <span className="preview-label">Model TTS</span>
                  <small>Chỉ hiện model có tiếng Việt</small>
                </div>
                <div className="voice-model-list">
                  {voice.catalog?.models
                    .filter((model) => model.languages.includes('vi'))
                    .map((model) => (
                    <label
                      className={`voice-model${voice.configuration?.modelId === model.modelId ? ' is-selected' : ''}`}
                      key={model.modelId}
                    >
                      <input
                        type="radio"
                        name="model"
                        checked={
                          voice.configuration?.modelId === model.modelId
                        }
                        onChange={() =>
                          voice.updateConfiguration((current) => ({
                            ...current,
                            modelId: model.modelId,
                            settings: {
                              ...current.settings,
                              style: model.canUseStyle
                                ? current.settings.style
                                : 0,
                              useSpeakerBoost:
                                model.canUseSpeakerBoost &&
                                current.settings.useSpeakerBoost,
                            },
                          }))
                        }
                      />
                      <span>
                        <strong>{model.name}</strong>
                        <small>
                          {model.modelId === 'eleven_v3'
                            ? 'Biểu cảm cao nhất · '
                            : ''}
                          {model.languages.includes('vi')
                            ? 'Có tiếng Việt'
                            : 'Chưa công bố tiếng Việt'}
                          {' · '}×{model.costMultiplier} credit
                        </small>
                      </span>
                    </label>
                    ))}
                </div>
              </div>
            </div>

            {voice.configuration && (
              <div className="voice-settings">
                <header>
                  <div>
                    <span className="preview-label">Voice settings</span>
                    <h2>Tinh chỉnh cho bản đọc thật</h2>
                    <p>
                      {voice.selectedVoice?.name ?? 'Chưa chọn voice'} ·{' '}
                      {voice.selectedModel?.name ?? 'Chưa chọn model'}
                    </p>
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        voice.configuration.settings.useSpeakerBoost
                      }
                      disabled={!voice.selectedModel?.canUseSpeakerBoost}
                      onChange={(event) =>
                        voice.updateConfiguration((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            useSpeakerBoost: event.target.checked,
                          },
                        }))
                      }
                    />
                    Speaker boost
                  </label>
                </header>
                {(
                  [
                    ['stability', 'Stability', 0, 1, 0.01],
                    ['similarityBoost', 'Similarity', 0, 1, 0.01],
                    ['style', 'Style', 0, 1, 0.01],
                    ['speed', 'Speed', 0.7, 1.2, 0.01],
                  ] as const
                ).map(([field, label, min, max, step]) => (
                  <label className="voice-range" key={field}>
                    <span>
                      {label}
                      <strong>
                        {settingLabel(
                          voice.configuration!.settings[field],
                        )}
                      </strong>
                    </span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={voice.configuration!.settings[field]}
                      disabled={
                        field === 'style' &&
                        !voice.selectedModel?.canUseStyle
                      }
                      onChange={(event) =>
                        voice.updateConfiguration((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            [field]: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="voice-generation-summary">
              <div>
                <span>Khối lượng dự kiến</span>
                <strong>
                  {characterCount.toLocaleString('vi-VN')} ký tự ·{' '}
                  {plan.sections.length} request
                </strong>
                <small>
                  {configurationChanged
                    ? 'Cấu hình bên trên đã khác generation hiện tại.'
                    : bundle
                      ? 'Tạo lại chỉ khi bạn muốn thay voice hoặc cách đọc.'
                      : 'Audio chỉ được lưu khi toàn bộ section thành công.'}
                </small>
              </div>
              <button
                className="submit-button"
                type="button"
                disabled={
                  voice.generating ||
                  voice.conflict ||
                  connection.checking ||
                  !connection.connected ||
                  !voice.configuration?.voiceId ||
                  !voice.configuration.modelId ||
                  selectedRequiresPaid
                }
                onClick={() => void handleGenerate()}
              >
                {voice.generating ? (
                  <>
                    <span className="spinner" />
                    Đang tạo audio thật…
                  </>
                ) : (
                  <>
                    {bundle ? 'Tạo generation mới' : 'Tạo voice thật'}
                    <SparkIcon />
                  </>
                )}
              </button>
            </div>
          </section>

          {bundle && (
            <section className="voice-review">
              <header>
                <div>
                  <span className="preview-kicker">
                    <CheckIcon />
                    Audio và timing đã lưu
                  </span>
                  <h2>Review từng section</h2>
                </div>
                <span
                  className={`draft-status${approved ? ' is-saved' : ''}`}
                >
                  <span />
                  {approved ? 'Đã chốt' : 'Chờ review'}
                </span>
              </header>

              {bundle.sections.map((section, index) => (
                <article
                  className="voice-review-section"
                  key={section.outlineSectionId}
                >
                  <span className="outline-section-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3>{outline.sections[index]?.title}</h3>
                    <p>
                      <ClockIcon />
                      {formatTime(section.durationSeconds)}
                      {' · '}
                      {section.beats.length} beat
                      {' · '}
                      {section.characterCost.toLocaleString('vi-VN')} credit
                    </p>
                    <audio
                      controls
                      preload="metadata"
                      aria-label={`Voice section ${index + 1}: ${outline.sections[index]?.title ?? ''}`}
                      src={voiceAudioUrl(
                        project.id,
                        section.outlineSectionId,
                        bundle.generation.generationId,
                      )}
                    />
                    <details
                      className="voice-beat-review"
                      open={index === 0}
                    >
                      <summary>
                        Xem lời và timing của {section.beats.length} beat
                      </summary>
                      <ol className="voice-beat-review-list">
                        {section.beats.map((beat, beatIndex) => {
                          const sourceBeat =
                            plan.sections[index]?.beats[beatIndex];

                          return (
                            <li key={beat.beatId}>
                              <div>
                                <strong>Beat {beatIndex + 1}</strong>
                                <span>
                                  {beat.startSeconds.toFixed(2)}–
                                  {beat.endSeconds.toFixed(2)}s
                                </span>
                              </div>
                              <p>
                                {sourceBeat?.voiceover ??
                                  'Không tìm thấy lời đọc nguồn của beat.'}
                              </p>
                            </li>
                          );
                        })}
                      </ol>
                    </details>
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>

        <aside className="voice-side">
          <section className="outline-side-card">
            <div className="voice-side-heading">
              <span className="preview-label">Generation hiện tại</span>
              <strong>
                {approved
                  ? 'Đã chốt'
                  : bundle
                    ? 'Chờ review'
                    : 'Chưa tạo'}
              </strong>
            </div>
            <dl>
              <div>
                <dt>Voice</dt>
                <dd>{bundle?.configuration.voiceName ?? 'Chưa tạo'}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{bundle?.configuration.modelName ?? 'Chưa tạo'}</dd>
              </div>
              <div>
                <dt>Thời lượng</dt>
                <dd>
                  {bundle
                    ? formatTime(bundle.totalDurationSeconds)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Credit ghi nhận</dt>
                <dd>
                  {bundle
                    ? bundle.generation.characterCost.toLocaleString(
                        'vi-VN',
                      )
                    : '—'}
                </dd>
              </div>
            </dl>
            {configurationChanged && (
              <div className="voice-config-warning">
                Cấu hình đang chọn chưa áp dụng vào audio bên dưới. Hãy tạo
                generation mới nếu muốn dùng thay đổi này.
              </div>
            )}
            <div className="outline-next-note">
              <LightbulbIcon />
              <p>
                Preview có sẵn của voice không tiêu credit. Nút tạo voice gọi
                TTS thật; chỉ generation thành công mới được ghi vào gợi ý đã
                dùng.
              </p>
            </div>
          </section>
        </aside>
      </div>

      {bundle && (
        <footer className="outline-final-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              navigate(projectMotionCanvasPath(project.id))
            }
          >
            <ArrowLeftIcon />
            Xem lại Motion Canvas
          </button>
          <div>
            <span>
              {approved
                ? 'Voice đã chốt và có timing sẵn cho bước đồng bộ'
                : 'Nghe đủ từng section trước khi chốt voice'}
            </span>
            <button
              className="submit-button"
              type="button"
              disabled={
                approved ||
                voice.approving ||
                voice.generating ||
                voice.stale ||
                voice.conflict
              }
              onClick={() => void voice.approve()}
            >
              {voice.approving ? (
                <>
                  <span className="spinner" />
                  Đang chốt…
                </>
              ) : approved ? (
                <>
                  <CheckIcon />
                  Đã chốt voice
                </>
              ) : (
                <>
                  Chốt voice
                  <CheckIcon />
                </>
              )}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
