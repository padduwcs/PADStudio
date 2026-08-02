import {useState} from 'react';
import type {
  VoiceVisualBeatField,
  VoiceVisualCandidateRecord,
  VoiceVisualCoherenceReview,
  VoiceVisualGlobalField,
} from '../shared/voiceVisualHistory.ts';
import {
  narrationMetrics,
  targetNarrationTokenCount,
} from '../shared/narrationTiming.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import type {VoiceVisualPlanContent} from '../shared/topic.ts';
import {speechTextForBeat} from '../shared/vietnameseSpeech.ts';
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
import {resolveVoiceVisualSectionPresentation} from './voiceVisualSectionState.ts';
import {prepareVoiceVisualReviewSuggestions} from './voiceVisualReviewSuggestions.ts';

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

interface VoiceVisualDiffItem {
  key: string;
  label: string;
  before: string;
  after: string;
}

function voiceVisualContentChanges(
  before: VoiceVisualPlanContent,
  after: VoiceVisualPlanContent,
): VoiceVisualDiffItem[] {
  const changes: VoiceVisualDiffItem[] = [];
  if (before.voiceDirection !== after.voiceDirection) {
    changes.push({
      key: 'voiceDirection',
      label: 'Giọng kể',
      before: before.voiceDirection,
      after: after.voiceDirection,
    });
  }
  if (before.visualDirection !== after.visualDirection) {
    changes.push({
      key: 'visualDirection',
      label: 'Ngôn ngữ hình ảnh',
      before: before.visualDirection,
      after: after.visualDirection,
    });
  }
  const beforeBeats = before.sections.flatMap(section => section.beats);
  after.sections.forEach((section, sectionIndex) => {
    section.beats.forEach((beat, beatIndex) => {
      const baseBeat = beforeBeats.find(item => item.id === beat.id);
      if (!baseBeat) return;
      for (const [field, label] of [
        ['voiceover', 'Lời kể'],
        ['spokenVoiceover', 'Cách đọc TTS'],
        ['visualDescription', 'Visual'],
        ['animationDescription', 'Chuyển động'],
        ['visualHoldSeconds', 'Giữ hình'],
      ] as const) {
        if (baseBeat[field] === beat[field]) continue;
        changes.push({
          key: `${beat.id}-${field}`,
          label: `Ý ${sectionIndex + 1} · Beat ${beatIndex + 1} · ${label}`,
          before: String(baseBeat[field]),
          after: String(beat[field]),
        });
      }
    });
  });
  return changes;
}

function VoiceVisualDiffList({
  title,
  changes,
}: {
  title?: string;
  changes: VoiceVisualDiffItem[];
}) {
  return (
    <div className="voice-visual-diff-group">
      {title && <strong className="voice-visual-diff-title">{title}</strong>}
      <div className="outline-diff-list">
        {changes.map(change => (
          <article className="outline-diff-item" key={change.key}>
            <strong>{change.label}</strong>
            <div>
              <span>{change.before}</span>
              <span aria-hidden="true">→</span>
              <span className="is-candidate">{change.after}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function VoiceVisualPage({projectId}: {projectId: string}) {
  const plan = useVoiceVisualDraft(projectId);
  const codexConnection = useCodexConnection();
  const [guidance, setGuidance] = useState('');
  const [selectedGlobalFields, setSelectedGlobalFields] = useState<
    VoiceVisualGlobalField[]
  >([]);
  const [selectedBeatFields, setSelectedBeatFields] = useState<
    Record<string, VoiceVisualBeatField[]>
  >({});
  const [protectedSuggestionCount, setProtectedSuggestionCount] = useState(0);
  const [candidateBaseMode, setCandidateBaseMode] = useState<
    'auto' | 'current' | 'candidate'
  >('auto');
  const [checkpointLabel, setCheckpointLabel] = useState('');

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

  function toggleGlobalField(field: VoiceVisualGlobalField) {
    setProtectedSuggestionCount(0);
    setSelectedGlobalFields(current =>
      current.includes(field)
        ? current.filter(item => item !== field)
        : [...current, field],
    );
  }

  function toggleBeatField(beatId: string, field: VoiceVisualBeatField) {
    setProtectedSuggestionCount(0);
    setSelectedBeatFields(current => {
      const fields = current[beatId] ?? [];
      const nextFields = fields.includes(field)
        ? fields.filter(item => item !== field)
        : [...fields, field];
      const next = {...current};
      if (nextFields.length > 0) next[beatId] = nextFields;
      else delete next[beatId];
      return next;
    });
  }

  function selectAllVoice() {
    if (!plan.draft) return;
    setProtectedSuggestionCount(0);
    setSelectedGlobalFields(current =>
      current.includes('voiceDirection')
        ? current
        : [...current, 'voiceDirection'],
    );
    setSelectedBeatFields(current => {
      const next = {...current};
      for (const beat of plan.draft!.sections.flatMap(section => section.beats)) {
        const fields = next[beat.id] ?? [];
        next[beat.id] = [
          ...new Set([
            ...fields,
            'voiceover' as const,
            'spokenVoiceover' as const,
          ]),
        ];
      }
      return next;
    });
  }

  function selectEntireVoiceVisualPlan() {
    if (!plan.draft) return;
    setProtectedSuggestionCount(0);
    setSelectedGlobalFields(['voiceDirection', 'visualDirection']);
    setSelectedBeatFields(
      Object.fromEntries(
        plan.draft.sections
          .flatMap(section => section.beats)
          .map(beat => [
            beat.id,
            [
              'voiceover',
              'spokenVoiceover',
              'visualDescription',
              'animationDescription',
              'visualHoldSeconds',
            ] satisfies VoiceVisualBeatField[],
          ]),
      ),
    );
  }

  function clearVoiceVisualScope() {
    setProtectedSuggestionCount(0);
    setSelectedGlobalFields([]);
    setSelectedBeatFields({});
  }

  function prepareReviewSuggestions(
    coherence: VoiceVisualCoherenceReview,
    sourceCandidate: VoiceVisualCandidateRecord | null,
    onlyScopeExpansion = false,
  ) {
    const content = sourceCandidate?.content ?? plan.draft;
    if (!content) return;
    const prepared = prepareVoiceVisualReviewSuggestions({
      coherence,
      content,
      sourceCandidate,
      onlyScopeExpansion,
    });
    setSelectedGlobalFields([]);
    setSelectedBeatFields(prepared.selectedBeatFields);
    setProtectedSuggestionCount(prepared.protectedFieldCount);
    setCandidateBaseMode(sourceCandidate ? 'candidate' : 'current');
    setGuidance(prepared.guidance);
  }

  async function handleReview(target: 'current' | 'candidate') {
    if (
      plan.reviewing ||
      codexConnection.checking ||
      !codexConnection.generationReady
    ) return;
    const connectionStatus = await codexConnection.verify();
    if (connectionStatus?.state !== 'connected') return;
    const selection = codexConnection.getGenerationSelection();
    if (!selection) return;
    await plan.reviewPlan(
      target,
      selection.model,
      selection.reasoningEffort,
    );
  }

  async function handleCreateCandidate() {
    if (
      plan.candidateGenerating ||
      codexConnection.checking ||
      !codexConnection.generationReady
    ) return;
    const connectionStatus = await codexConnection.verify();
    if (connectionStatus?.state !== 'connected') return;
    const selection = codexConnection.getGenerationSelection();
    if (!selection) return;
    const created = await plan.createCandidate(
      guidance,
      {
        globalFields: selectedGlobalFields,
        beats: Object.entries(selectedBeatFields).map(([beatId, fields]) => ({
          beatId,
          fields,
        })),
      },
      selection.model,
      selection.reasoningEffort,
      candidateBaseMode,
    );
    if (created) {
      setGuidance('');
      setProtectedSuggestionCount(0);
      setCandidateBaseMode('auto');
    }
  }

  async function handleApplyCandidate() {
    const confirmations: string[] = [];
    if (plan.validationErrors.length > 0) {
      confirmations.push(
        'Bản đang nhập có trường chưa hợp lệ. Áp dụng candidate sẽ bỏ các thay đổi cục bộ chưa lưu.',
      );
    }
    if (
      plan.candidate?.status === 'coherence_blocked' ||
      plan.candidate?.status === 'scope_expansion_required'
    ) {
      confirmations.push(
        'AI reviewer khuyến nghị xem lại candidate này, nhưng đây chỉ là tư vấn. Quyết định áp dụng vẫn thuộc về bạn.',
      );
    }
    if (
      confirmations.length > 0 &&
      !window.confirm(`${confirmations.join('\n\n')}\n\nBạn vẫn muốn áp dụng?`)
    ) return;
    await plan.applyCandidate();
  }

  async function handleRestore(
    version: NonNullable<typeof plan.history>['versions'][number],
  ) {
    if (
      plan.validationErrors.length > 0 &&
      !window.confirm(
        'Bản đang nhập có trường chưa hợp lệ. Khôi phục sẽ bỏ các thay đổi cục bộ chưa lưu. Bạn muốn tiếp tục?',
      )
    ) return;
    await plan.restoreVersion(version);
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
  const selectedFieldCount =
    selectedGlobalFields.length +
    Object.values(selectedBeatFields).reduce(
      (total, fields) => total + fields.length,
      0,
    );
  const candidateReviewable = Boolean(
    plan.candidate?.decision === 'pending' &&
      plan.history &&
      plan.candidate.rootBaseContextHash === plan.history.currentContextHash,
  );
  const candidateRootArtifact = plan.candidate
    ? plan.history?.versions.find(
        item => item.versionId === plan.candidate?.baseVersionId,
      )?.artifact
    : null;
  const candidateRootBase: VoiceVisualPlanContent | null = candidateRootArtifact
    ? {
        voiceDirection: candidateRootArtifact.voiceDirection,
        visualDirection: candidateRootArtifact.visualDirection,
        timingCalibration: candidateRootArtifact.timingCalibration,
        sections: candidateRootArtifact.sections,
      }
    : null;
  const candidateBase = plan.candidate?.parentCandidateId
    ? plan.history?.candidates.find(
        item => item.candidateId === plan.candidate?.parentCandidateId,
      )?.content ?? null
    : candidateRootBase;
  const candidateChanges = plan.candidate && candidateBase
    ? voiceVisualContentChanges(candidateBase, plan.candidate.content)
    : [];
  const candidateCumulativeChanges =
    plan.candidate?.parentCandidateId && candidateRootBase
      ? voiceVisualContentChanges(candidateRootBase, plan.candidate.content)
      : candidateChanges;
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
                    <span className="voice-visual-field-heading">
                      Giọng kể
                      <span className="voice-visual-scope-toggle">
                        <input
                          type="checkbox"
                          checked={selectedGlobalFields.includes(
                            'voiceDirection',
                          )}
                          onChange={() => toggleGlobalField('voiceDirection')}
                        />
                        Cho AI sửa
                      </span>
                    </span>
                    <textarea
                      rows={3}
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
                    <span className="voice-visual-field-heading">
                      Ngôn ngữ hình ảnh
                      <span className="voice-visual-scope-toggle">
                        <input
                          type="checkbox"
                          checked={selectedGlobalFields.includes(
                            'visualDirection',
                          )}
                          onChange={() => toggleGlobalField('visualDirection')}
                        />
                        Cho AI sửa
                      </span>
                    </span>
                    <textarea
                      rows={3}
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
                  const sectionSeconds = planSection.beats.reduce(
                    (total, beat) => total + beat.durationSeconds,
                    0,
                  );
                  const sectionPresentation =
                    resolveVoiceVisualSectionPresentation(
                      outline.sections,
                      planSection.outlineSectionId,
                      sectionIndex,
                      sectionSeconds,
                    );
                  const sectionNarration = planSection.beats
                    .map((beat) => beat.voiceover)
                    .join('\n\n');
                  const sectionMetrics = narrationMetrics(
                    sectionNarration,
                    draft.timingCalibration,
                  );
                  const sectionTokenTarget = targetNarrationTokenCount(
                    sectionPresentation.estimatedSeconds,
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
                          <h2>{sectionPresentation.title}</h2>
                          <p>{sectionPresentation.goal}</p>
                          {!sectionPresentation.belongsToCurrentOutline && (
                            <small className="voice-visual-stale-section">
                              Không còn trong mạch giảng mới
                            </small>
                          )}
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

                              <div className="voice-visual-beat-scope">
                                <span>AI được phép sửa:</span>
                                {(
                                  [
                                    ['voiceover', 'Lời kể'],
                                    ['spokenVoiceover', 'Cách đọc TTS'],
                                    ['visualDescription', 'Visual'],
                                    ['animationDescription', 'Chuyển động'],
                                    ['visualHoldSeconds', 'Giữ hình'],
                                  ] as const
                                ).map(([field, label]) => (
                                  <label key={field}>
                                    <input
                                      type="checkbox"
                                      checked={(
                                        selectedBeatFields[beat.id] ?? []
                                      ).includes(field)}
                                      onChange={() =>
                                        toggleBeatField(beat.id, field)
                                      }
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>

                              <div className="voice-visual-beat-fields">
                                <label className="outline-field voice-field">
                                  <span>Lời thuyết minh</span>
                                  <textarea
                                    rows={4}
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
                                <label className="outline-field voice-field tts-pronunciation-field">
                                  <span>
                                    Cách ElevenLabs đọc
                                    <small>
                                      Đã chuyển ký hiệu và công thức thành âm tiết
                                    </small>
                                  </span>
                                  <textarea
                                    rows={3}
                                    disabled={plan.stale}
                                    value={speechTextForBeat(beat)}
                                    onChange={(event) =>
                                      plan.updateBeat(
                                        planSection.outlineSectionId,
                                        beat.id,
                                        'spokenVoiceover',
                                        event.target.value,
                                      )
                                    }
                                  />
                                  {beat.spokenVoiceover && (
                                    <button
                                      type="button"
                                      disabled={plan.stale}
                                      onClick={() =>
                                        plan.updateBeat(
                                          planSection.outlineSectionId,
                                          beat.id,
                                          'spokenVoiceover',
                                          undefined,
                                        )
                                      }
                                    >
                                      Dùng lại phiên âm tự động
                                    </button>
                                  )}
                                </label>
                                <label className="outline-field">
                                  <span>Visual cần thấy</span>
                                  <textarea
                                    rows={3}
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
                                          speechTextForBeat(beat),
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
                <>
                  <section className="voice-visual-review-launcher">
                    <div>
                      <span className="preview-kicker">
                        <SparkIcon />
                        AI review độc lập
                      </span>
                      <h2>Kiểm tra mà không thay đổi nội dung</h2>
                      <p>
                        Review chỉ đưa ra nhận xét và gợi ý phạm vi. Không candidate
                        nào được tạo hoặc áp dụng từ thao tác này.
                      </p>
                    </div>
                    <div className="voice-visual-review-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={
                          plan.reviewing ||
                          !plan.valid ||
                          plan.saveState === 'conflict' ||
                          codexConnection.checking ||
                          !codexConnection.generationReady
                        }
                        onClick={() => void handleReview('current')}
                      >
                        {plan.reviewing ? (
                          <>
                            <span className="spinner dark" />
                            AI đang review…
                          </>
                        ) : (
                          'Review bản hiện tại'
                        )}
                      </button>
                      {plan.candidate && candidateReviewable && (
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={
                            plan.reviewing ||
                            plan.saveState === 'conflict' ||
                            codexConnection.checking ||
                            !codexConnection.generationReady
                          }
                          onClick={() => void handleReview('candidate')}
                        >
                          Review candidate đang xem
                        </button>
                      )}
                    </div>
                  </section>

                  {plan.standaloneReview && (
                    <section className="outline-candidate-review voice-visual-standalone-review">
                      <header>
                        <div>
                          <span className="preview-kicker">
                            <SparkIcon />
                            Kết quả review độc lập
                          </span>
                          <h2>
                            {plan.standaloneReview.target === 'candidate'
                              ? 'Candidate vẫn chỉ là bản đề xuất'
                              : 'Bản hiện tại chưa bị thay đổi'}
                          </h2>
                        </div>
                        <span className={`candidate-status is-${
                          plan.standaloneReview.coherence.verdict === 'coherent'
                            ? 'ready'
                            : 'coherence_warning'
                        }`}>
                          {plan.standaloneReview.coherence.verdict === 'coherent'
                            ? 'AI đánh giá ổn'
                            : 'AI có gợi ý'}
                        </span>
                      </header>
                      <p>{plan.standaloneReview.coherence.summary}</p>
                      {plan.standaloneReview.coherence.issues.length > 0 && (
                        <ul className="voice-visual-coherence-issues">
                          {plan.standaloneReview.coherence.issues.map(
                            (issue, index) => (
                              <li key={`${issue.category}-${index}`}>
                                <strong>
                                  {issue.severity === 'error'
                                    ? 'Nên xem kỹ'
                                    : 'Gợi ý'}
                                </strong>{' '}
                                {issue.message}
                                <small>{issue.suggestedFix}</small>
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                      <p className="candidate-advisory-note">
                        Review không ghi đè bản hiện tại và không tự tạo candidate.
                      </p>
                      <footer>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={plan.dismissReview}
                        >
                          Đóng review
                        </button>
                        {plan.standaloneReview.coherence.issues.length > 0 && (
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() =>
                              prepareReviewSuggestions(
                                plan.standaloneReview!.coherence,
                                plan.standaloneReview!.target === 'candidate'
                                  ? plan.candidate
                                  : null,
                              )
                            }
                          >
                            Chuẩn bị chỉnh theo gợi ý
                          </button>
                        )}
                      </footer>
                    </section>
                  )}

                  {plan.candidate && (
                    <section className="outline-candidate-review voice-visual-candidate-review">
                      <header>
                        <div>
                          <span className="preview-kicker">
                            <SparkIcon />
                            Candidate chưa ghi đè bản hiện tại
                          </span>
                          <h2>{plan.candidate.patch.editSummary}</h2>
                        </div>
                        <span className={`candidate-status is-${plan.candidate.status}`}>
                          {plan.candidate.decision === 'accepted'
                            ? 'Đã áp dụng'
                            : plan.candidate.decision === 'rejected'
                              ? 'Đã từ chối'
                              : plan.candidate.status === 'ready'
                                ? 'Sẵn sàng'
                                : plan.candidate.status === 'coherence_warning'
                                  ? 'AI có lưu ý'
                                  : plan.candidate.status === 'scope_expansion_required'
                                    ? 'AI đề nghị mở phạm vi'
                                    : 'AI khuyến nghị xem lại'}
                        </span>
                      </header>

                      <span className="voice-visual-auto-review-label">
                        Review tự động sau khi AI chỉnh sửa
                      </span>
                      <p>{plan.candidate.coherence.summary}</p>
                      <p className="candidate-advisory-note">
                        Đánh giá này chỉ hỗ trợ quyết định. Bạn luôn có thể áp dụng
                        candidate nếu nội dung phù hợp với chủ đích của mình.
                      </p>
                      {plan.candidate.coherence.issues.length > 0 && (
                        <ul className="voice-visual-coherence-issues">
                          {plan.candidate.coherence.issues.map((issue, index) => (
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
                      {plan.candidate.decision === 'pending' &&
                        plan.candidate.status === 'scope_expansion_required' && (
                          <div className="candidate-scope-expansion">
                            <div>
                              <strong>Reviewer đề nghị mở rộng đúng beat liên quan</strong>
                              <small>
                                Candidate hiện tại vẫn làm nền; PAD Studio chỉ bổ sung các
                                trường cần thiết để nối mạch.
                              </small>
                            </div>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() =>
                                prepareReviewSuggestions(
                                  plan.candidate!.coherence,
                                  plan.candidate,
                                  true,
                                )
                              }
                            >
                              Mở phạm vi theo gợi ý
                            </button>
                          </div>
                        )}

                      {plan.candidate.parentCandidateId ? (
                        <div className="voice-visual-layered-diff">
                          <VoiceVisualDiffList
                            title="Lượt vừa chỉnh · candidate trước → candidate này"
                            changes={candidateChanges}
                          />
                          <VoiceVisualDiffList
                            title="Tổng thay đổi · bản đang dùng → candidate này"
                            changes={candidateCumulativeChanges}
                          />
                        </div>
                      ) : (
                        <VoiceVisualDiffList changes={candidateChanges} />
                      )}

                      <footer>
                        {plan.candidate.decision === 'pending' ? (
                          <>
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={plan.historyBusy}
                              onClick={() => void plan.rejectCandidate()}
                            >
                              Giữ bản cũ, từ chối
                            </button>
                            <button
                              className="submit-button"
                              type="button"
                              disabled={plan.candidateApplying}
                              onClick={() => void handleApplyCandidate()}
                            >
                              {plan.candidateApplying
                                ? 'Đang áp dụng…'
                                : plan.candidate.status === 'coherence_blocked' ||
                                    plan.candidate.status ===
                                      'scope_expansion_required'
                                  ? 'Vẫn áp dụng theo ý tôi'
                                  : 'Áp dụng candidate'}
                            </button>
                          </>
                        ) : (
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={plan.dismissCandidate}
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
                        Chỉnh hẹp, đọc toàn cục
                      </span>
                      <h2>Bạn muốn thay đổi điều gì?</h2>
                      <p>
                        Chọn chính xác trường AI được sửa. AI vẫn đọc toàn bộ
                        kế hoạch và kiểm tra lại hai ranh giới với phần giữ nguyên.
                      </p>
                    </div>
                    <div className="ai-scope-presets" aria-label="Chọn nhanh phạm vi">
                      <button type="button" onClick={selectAllVoice}>
                        Chọn toàn bộ voice
                      </button>
                      <button type="button" onClick={selectEntireVoiceVisualPlan}>
                        Chọn toàn bộ kế hoạch
                      </button>
                      <button type="button" onClick={clearVoiceVisualScope}>
                        Bỏ chọn
                      </button>
                    </div>
                    <div className="voice-visual-scope-summary">
                      <strong>{selectedFieldCount} trường được phép sửa</strong>
                      <span>
                        {candidateBaseMode === 'candidate'
                          ? 'Candidate đang xem là bản nền; các field vừa chỉnh được giữ khóa mặc định.'
                          : candidateBaseMode === 'current'
                            ? 'Lượt này dùng bản hiện tại làm nền, không dựa trên candidate đang chờ.'
                            : 'Thêm, xóa hoặc đổi thứ tự beat vẫn thực hiện thủ công để tránh AI làm lệch cấu trúc.'}
                      </span>
                    </div>
                    {protectedSuggestionCount > 0 && (
                      <div className="voice-visual-protected-suggestion" role="status">
                        <strong>
                          Đã giữ khóa {protectedSuggestionCount} field vừa được chỉnh tốt
                        </strong>
                        <span>
                          AI sẽ không sửa lại các field đó. Nếu thật sự muốn thay đổi,
                          bạn có thể tự tích checkbox tương ứng.
                        </span>
                      </div>
                    )}
                    <textarea
                      rows={3}
                      value={guidance}
                      placeholder="Ví dụ: Rút gọn lời kể của beat đã chọn, nhưng giữ nguyên ví dụ và nối tự nhiên với beat kế tiếp."
                      onChange={(event) => setGuidance(event.target.value)}
                    />
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={
                        plan.candidateGenerating ||
                        selectedFieldCount === 0 ||
                        guidance.trim().length < 3 ||
                        plan.saveState === 'conflict' ||
                        codexConnection.checking ||
                        !codexConnection.generationReady
                      }
                      onClick={() => void handleCreateCandidate()}
                    >
                      {plan.candidateGenerating ? (
                        <>
                          <span className="spinner dark" />
                          AI đang tạo candidate…
                        </>
                      ) : (
                        <>
                          <SparkIcon />
                          {plan.candidate?.decision === 'pending'
                            ? candidateBaseMode === 'current'
                              ? 'Tạo candidate từ bản hiện tại'
                              : 'Chỉnh tiếp candidate'
                            : 'Tạo candidate để so sánh'}
                        </>
                      )}
                    </button>
                  </section>
                </>
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

              {!plan.stale && (
                <section className="outline-history-card voice-visual-history-card">
                  <header>
                    <div>
                      <span className="preview-label">Lịch sử an toàn</span>
                      <h2>Phiên bản voice–visual</h2>
                    </div>
                  </header>

                  <div className="outline-checkpoint-action">
                    <input
                      type="text"
                      value={checkpointLabel}
                      placeholder="Tên mốc, ví dụ: trước khi rút lời"
                      onChange={event => setCheckpointLabel(event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={plan.historyBusy || !plan.valid}
                      onClick={() =>
                        void plan.createCheckpoint(checkpointLabel).then(
                          version => {
                            if (version) setCheckpointLabel('');
                          },
                        )
                      }
                    >
                      Lưu mốc
                    </button>
                  </div>

                  {plan.historyError && (
                    <p className="outline-history-error" role="alert">
                      {plan.historyError}
                    </p>
                  )}

                  {plan.history?.candidates.length ? (
                    <div className="outline-candidate-history">
                      <strong>Candidates</strong>
                      {plan.history.candidates.slice(0, 8).map(item => (
                        <article key={item.candidateId}>
                          <div>
                            <strong>{item.patch.editSummary}</strong>
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
                            onClick={() => plan.selectCandidate(item)}
                          >
                            Xem
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : null}

                  <div className="outline-version-list">
                    {plan.history?.versions.slice(0, 12).map(version => (
                      <article key={version.versionId}>
                        <div>
                          <strong>{version.label ?? 'Phiên bản đã lưu'}</strong>
                          <span>
                            {new Date(version.createdAt).toLocaleString('vi-VN')}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={
                            plan.historyBusy ||
                            version.contentHash ===
                              plan.history?.currentContentHash
                          }
                          onClick={() => void handleRestore(version)}
                        >
                          {version.contentHash ===
                          plan.history?.currentContentHash
                            ? 'Hiện tại'
                            : 'Khôi phục'}
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              )}
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
                  plan.candidateGenerating ||
                  plan.candidateApplying ||
                  plan.candidate?.decision === 'pending' ||
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
