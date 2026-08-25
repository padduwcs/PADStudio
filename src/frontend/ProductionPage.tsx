import {useEffect, useMemo, useRef, useState} from 'react';
import type {ElevenLabsCatalog} from '../shared/elevenLabs.ts';
import type {MotionCanvasGenerationProgress} from '../shared/motionCanvasGenerationProgress.ts';
import type {TopicProject} from '../shared/topic.ts';
import {
  animationSyncIsStale,
  motionCanvasIsStale,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  approveAnimationSync,
  approveMotionCanvas,
  generateAnimationSync,
  generateMotionCanvas,
  generateVoice,
  getElevenLabsCatalog,
  getLatestMotionCanvasFailure,
  getMotionCanvasGenerationProgress,
  getProject,
  type MotionCanvasFailureSummary,
  prepareNarrationProduction,
  voiceAudioUrl,
} from './api.ts';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {ElevenLabsConnectionCard} from './ElevenLabsConnectionCard.tsx';
import {navigate, projectPronunciationPath, projectScenesPath} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {useElevenLabsConnection} from './useElevenLabsConnection.ts';
import {useWorkflowOperationGuard} from './useWorkflowOperationGuard.ts';
import {RuntimeDiagnosticsCard} from './RuntimeDiagnosticsCard.tsx';
import {
  notifyTaskCompleted,
  notifyTaskFailed,
  prepareTaskCompletionNotifications,
} from './taskCompletionNotifications.ts';

const defaultSettings = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: true,
  speed: 1,
};

function newGenerationId() {
  return crypto.randomUUID();
}

function recoveryGuidanceFor(
  failure: MotionCanvasFailureSummary | null,
  fallbackMessage: string,
) {
  if (failure?.recoveryGuidance) return failure.recoveryGuidance;
  const reason = failure?.firstIssueReason || failure?.message || fallbackMessage;
  return [
    'The previous independent scene generation did not complete. Fix the concrete failure below in the new result; do not bypass the rendered-frame checks.',
    `Failure to fix: ${reason.slice(0, 1_800)}`,
    'Use the current Visual Plan and approved voice as the source of truth. Generate a completely new scene bundle with readable, non-overlapping text and clear visual illustrations.',
  ].join('\n');
}

export function ProductionPage({projectId}: {projectId: string}) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [catalog, setCatalog] = useState<ElevenLabsCatalog | null>(null);
  const [voiceId, setVoiceId] = useState('');
  const [modelId, setModelId] = useState('');
  const [settings, setSettings] = useState(defaultSettings);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyAction, setBusyAction] = useState<'createAudio' | 'regenerateAudio' | 'replanVisual' | 'generateScene' | 'regenerateScene' | 'combined' | null>(null);
  const [message, setMessage] = useState('');
  const [latestSceneFailure, setLatestSceneFailure] =
    useState<MotionCanvasFailureSummary | null>(null);
  const [failureKind, setFailureKind] =
    useState<'audio' | 'visual-plan' | 'scene' | 'sync' | null>(null);
  const [activeSceneGenerationId, setActiveSceneGenerationId] =
    useState<string | null>(null);
  const [sceneProgress, setSceneProgress] =
    useState<MotionCanvasGenerationProgress | null>(null);
  const resumedSceneGenerationRef = useRef<string | null>(null);
  const eleven = useElevenLabsConnection();
  const codex = useCodexConnection();

  useEffect(() => {
    let active = true;
    void Promise.all([
      getProject(projectId),
      getLatestMotionCanvasFailure(projectId).catch(() => null),
      getMotionCanvasGenerationProgress(projectId).catch(() => null),
    ])
      .then(([value, failure, progress]) => {
        if (!active) return;
        setProject(value);
        setSceneProgress(progress);
        if (progress?.state === 'running') {
          resumedSceneGenerationRef.current = progress.generationId;
          setActiveSceneGenerationId(progress.generationId);
          setBusyAction('generateScene');
          setMessage('Đang nối lại màn hình tiến độ của lượt sinh scene trên máy chủ…');
        }
        if (
          failure &&
          (!value.motionCanvasBundle ||
            Date.parse(failure.failedAt) >
              Date.parse(value.motionCanvasBundle.generation.generatedAt))
        ) {
          setLatestSceneFailure(failure);
        } else {
          setLatestSceneFailure(null);
        }
        if (value.voiceBundle) {
          setVoiceId(value.voiceBundle.configuration.voiceId);
          setModelId(value.voiceBundle.configuration.modelId);
          setSettings(value.voiceBundle.configuration.settings);
        }
        setState('ready');
      })
      .catch(error => {
        if (!active) return;
        setState('error');
        setMessage(error instanceof ApiRequestError ? error.message : 'Không thể mở bước audio và scene.');
      });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (!activeSceneGenerationId) return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const progress = await getMotionCanvasGenerationProgress(projectId);
        if (!active || progress?.generationId !== activeSceneGenerationId) return;
        setSceneProgress(progress);
        if (progress.state === 'completed') {
          const current = await getProject(projectId);
          if (!active) return;
          setProject(current);
          setActiveSceneGenerationId(null);
          setBusyAction(null);
          setState('ready');
          setMessage('Scene đã được tạo và kiểm định xong. Bạn có thể tiếp tục chuẩn bị editor có tiếng.');
          if (resumedSceneGenerationRef.current === progress.generationId) {
            notifyTaskCompleted({
              id: `scene-resume:${progress.generationId}`,
              title: 'Scene đã sinh xong',
              message: 'Lượt sinh scene được nối lại đã hoàn tất và sẵn sàng để kiểm tra.',
            });
            resumedSceneGenerationRef.current = null;
          }
        } else if (progress.state === 'failed' || progress.state === 'interrupted') {
          const errorMessage = progress.error || progress.message;
          setActiveSceneGenerationId(null);
          setBusyAction(null);
          setFailureKind('scene');
          setState('error');
          setMessage(errorMessage);
          if (resumedSceneGenerationRef.current === progress.generationId) {
            notifyTaskFailed({
              id: `scene-resume:${progress.generationId}`,
              title: 'Lượt sinh scene gặp lỗi',
              message: errorMessage,
            });
            resumedSceneGenerationRef.current = null;
          }
        }
      } catch {
        // The original generation request remains authoritative. A missed
        // status poll must never trigger another Codex request.
      } finally {
        polling = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activeSceneGenerationId, projectId]);

  useEffect(() => {
    if (!eleven.connected) return;
    let active = true;
    void getElevenLabsCatalog().then(value => {
      if (!active) return;
      setCatalog(value);
      const preferred = value.recentPresets.find(item => item.source === 'pad-studio');
      const voice = value.voices.find(item => item.voiceId === preferred?.voiceId) ?? value.voices[0];
      const model = value.models.find(item => item.modelId === preferred?.modelId && item.languages.includes('vi')) ??
        value.models.find(item => item.languages.includes('vi'));
      setVoiceId(current => current || voice?.voiceId || '');
      setModelId(current => current || model?.modelId || '');
    }).catch(error => {
      if (!active) return;
      setMessage(error instanceof ApiRequestError ? error.message : 'Không thể tải danh mục ElevenLabs.');
    });
    return () => { active = false; };
  }, [eleven.connected]);

  const narrationApproved = Boolean(
    project?.narration?.review &&
      project.narration.approvedAt &&
      project.narration.approvedSourceHash === project.narration.review.sourceHash,
  );
  const selectedModel = useMemo(
    () => catalog?.models.find(item => item.modelId === modelId) ?? null,
    [catalog, modelId],
  );
  const audioReady = Boolean(project?.voiceBundle);
  const sceneReady = Boolean(project?.motionCanvasBundle && !motionCanvasIsStale(project));
  const syncReady = Boolean(
    project?.animationSyncBundle?.status === 'approved' &&
      !animationSyncIsStale(project),
  );
  const effectiveSettings = {
    ...settings,
    style: selectedModel?.canUseStyle ? settings.style : 0,
    useSpeakerBoost: selectedModel?.canUseSpeakerBoost ? settings.useSpeakerBoost : false,
  };
  const voiceSelectionChanged = Boolean(
    project?.voiceBundle &&
      (project.voiceBundle.configuration.voiceId !== voiceId ||
        project.voiceBundle.configuration.modelId !== modelId ||
        JSON.stringify(project.voiceBundle.configuration.settings) !== JSON.stringify(effectiveSettings)),
  );
  const allowNextWorkflowNavigation = useWorkflowOperationGuard(
    busyAction !== null,
    'PAD Studio đang tạo hoặc cập nhật audio/scene. Hãy chờ tác vụ hoàn tất trước khi chuyển bước hay đổi project.',
  );
  const canRunCombined = Boolean(
    !busyAction &&
    (audioReady || (eleven.connected && voiceId && modelId)) &&
    (sceneReady || codex.isTaskReady('motionCanvas')),
  );

  async function generateSelectedAudio(current: TopicProject) {
    const connected = await eleven.verify();
    if (connected?.state !== 'connected') {
      throw new Error('Hãy kết nối ElevenLabs trước khi tạo audio.');
    }
    if (!voiceId || !modelId) {
      throw new Error('Hãy chọn voice và model tiếng Việt của ElevenLabs.');
    }
    setMessage('ElevenLabs đang tạo audio từ bản cách đọc đã duyệt…');
    return generateVoice(current.id, {
      generationId: newGenerationId(),
      voiceId,
      modelId,
      outputFormat: 'mp3_44100_128',
      settings: effectiveSettings,
      seed: null,
    }, current.revision);
  }

  function plannerSelectionFields() {
    const selection = codex.getGenerationSelection('visualPlanner');
    return {
      ...(selection?.model ? {plannerModel: selection.model} : {}),
      ...(selection?.reasoningEffort
        ? {plannerReasoningEffort: selection.reasoningEffort}
        : {}),
    };
  }

  async function replanVisuals() {
    if (!project || busyAction) return;
    const confirmed = window.confirm(
      'Lập lại kế hoạch hình ảnh sẽ giữ nguyên file audio, alignment và toàn bộ timestamp hiện có. Scene, đồng bộ và render phía sau sẽ cần tạo lại. Tiếp tục?',
    );
    if (!confirmed) return;
    const taskId = newGenerationId();
    prepareTaskCompletionNotifications();
    setBusyAction('replanVisual');
    setState('ready');
    setFailureKind(null);
    setMessage('Codex đang lập lại ý đồ hình ảnh; audio và timeline hiện có được khóa nguyên trạng…');
    try {
      const current = await prepareNarrationProduction(project.id, {
        generationId: newGenerationId(),
        ...plannerSelectionFields(),
        forceVisualReplan: true,
      }, project.revision);
      setProject(current);
      setLatestSceneFailure(null);
      setMessage('Kế hoạch hình ảnh đã được làm mới. Audio, alignment và timestamp được giữ nguyên; hãy sinh lại scene để áp dụng ý đồ mới.');
      notifyTaskCompleted({
        id: `visual-replan:${taskId}`,
        title: 'Kế hoạch hình ảnh đã được làm mới',
        message: 'Voice và timestamp không thay đổi. Scene cũ được giữ trong lịch sử và đã hết hiệu lực cho plan mới.',
      });
    } catch (error) {
      const errorMessage = error instanceof ApiRequestError || error instanceof Error
        ? error.message
        : 'Không thể lập lại kế hoạch hình ảnh.';
      setState('error');
      setFailureKind('visual-plan');
      setMessage(errorMessage);
      notifyTaskFailed({
        id: `visual-replan:${taskId}`,
        title: 'Lập kế hoạch hình ảnh thất bại',
        message: errorMessage,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function regenerateAudio() {
    if (!project || busyAction || !voiceId || !modelId) return;
    const confirmed = window.confirm(
      'Tạo lại audio sẽ dùng quota ElevenLabs và làm bản đồng bộ/render cũ hết hiệu lực. Tiếp tục?',
    );
    if (!confirmed) return;
    const taskId = newGenerationId();
    prepareTaskCompletionNotifications();
    setBusyAction('regenerateAudio');
    setState('ready');
    setFailureKind(null);
    setMessage('');
    try {
      let current = project;
      setMessage('Đang chuẩn bị cấu trúc scene từ lời thoại đã duyệt…');
      current = await prepareNarrationProduction(
        current.id,
        {generationId: newGenerationId(), ...plannerSelectionFields()},
        current.revision,
      );
      current = await generateSelectedAudio(current);
      setProject(current);
      setVoiceId(current.voiceBundle!.configuration.voiceId);
      setModelId(current.voiceBundle!.configuration.modelId);
      setMessage('Audio mới đã sẵn sàng. Scene hiện tại được giữ lại; đồng bộ và render sẽ được tạo lại ở các bước sau.');
      setState('ready');
      setLatestSceneFailure(null);
      notifyTaskCompleted({
        id: `regenerate-audio:${taskId}`,
        title: 'Audio mới đã tạo xong',
        message: 'Bạn có thể nghe lại audio ngay trong bước Giọng đọc & scene.',
      });
    } catch (error) {
      const errorMessage = error instanceof ApiRequestError || error instanceof Error
        ? error.message
        : 'Không thể tạo lại audio.';
      setState('error');
      setFailureKind('audio');
      setMessage(errorMessage);
      notifyTaskFailed({
        id: `regenerate-audio:${taskId}`,
        title: 'Tạo lại audio thất bại',
        message: errorMessage,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function createAudio() {
    if (!project || busyAction || !voiceId || !modelId) return;
    const taskId = newGenerationId();
    prepareTaskCompletionNotifications();
    setBusyAction('createAudio');
    setState('ready');
    setFailureKind(null);
    setMessage('');
    try {
      setMessage('Đang chuẩn bị cấu trúc scene từ lời thoại đã duyệt…');
      let current = await prepareNarrationProduction(
        project.id,
        {generationId: newGenerationId(), ...plannerSelectionFields()},
        project.revision,
      );
      current = await generateSelectedAudio(current);
      setProject(current);
      setVoiceId(current.voiceBundle!.configuration.voiceId);
      setModelId(current.voiceBundle!.configuration.modelId);
      setMessage('Audio đã sẵn sàng. Bước tiếp theo: bấm “Sinh scene” ở khung Codex.');
      setState('ready');
      notifyTaskCompleted({
        id: `create-audio:${taskId}`,
        title: 'Audio đã tạo xong',
        message: 'Giọng đọc đã sẵn sàng để nghe thử và dùng khi sinh scene.',
      });
    } catch (error) {
      const errorMessage = error instanceof ApiRequestError || error instanceof Error
        ? error.message
        : 'Không thể tạo audio.';
      setState('error');
      setFailureKind('audio');
      setMessage(errorMessage);
      notifyTaskFailed({
        id: `create-audio:${taskId}`,
        title: 'Tạo audio thất bại',
        message: errorMessage,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function runProduction(
    source: 'generateScene' | 'regenerateScene' | 'combined' = 'combined',
    recoveryGuidance?: string,
  ) {
    if (!project || busyAction) return;
    const needsSceneGeneration =
      source === 'regenerateScene' ||
      !project.motionCanvasBundle ||
      motionCanvasIsStale(project);
    if (needsSceneGeneration && !codex.isTaskReady('motionCanvas')) {
      setState('error');
      setFailureKind('scene');
      setMessage('Hãy kết nối Codex và chọn model sinh scene trước khi bắt đầu. Audio chưa bị tạo hoặc thay đổi.');
      return;
    }
    const taskId = newGenerationId();
    prepareTaskCompletionNotifications();
    setState('ready');
    setBusyAction(source);
    setFailureKind(null);
    setMessage('');
    let operationStage: 'visual-plan' | 'audio' | 'scene' | 'sync' = 'visual-plan';
    try {
      let current = project;
      setMessage('Đang chuẩn bị cấu trúc scene từ lời thoại đã duyệt…');
      current = await prepareNarrationProduction(current.id, {generationId: newGenerationId(), ...plannerSelectionFields()}, current.revision);
      setProject(current);
      if (!current.voiceBundle) {
        operationStage = 'audio';
        current = await generateSelectedAudio(current);
        setProject(current);
      }
      const regenerateFromScratch = source === 'regenerateScene';
      if (!current.motionCanvasBundle || motionCanvasIsStale(current) || regenerateFromScratch) {
        operationStage = 'scene';
        const selection = codex.getGenerationSelection('motionCanvas');
        if (!selection) {
          throw new Error('Hãy kết nối Codex và chọn model trước khi sinh scene.');
        }
        setMessage(
          recoveryGuidance
            ? 'Codex đang nhận lỗi kiểm tra của lượt trước và sinh một bản scene độc lập đã được định hướng sửa…'
            : 'Codex đang phân tích lời thoại và sinh scene trực tiếp…',
        );
        const sceneGenerationId = newGenerationId();
        setActiveSceneGenerationId(sceneGenerationId);
        setSceneProgress(null);
        current = await generateMotionCanvas(current.id, {
          generationId: sceneGenerationId,
          ...selection,
          ...(regenerateFromScratch ? {regenerateFromScratch: true as const} : {}),
          ...(recoveryGuidance ? {guidance: recoveryGuidance} : {}),
        }, current.revision);
        setActiveSceneGenerationId(null);
        setProject(current);
        setLatestSceneFailure(null);
      }
      operationStage = 'scene';
      if (!current.motionCanvasBundle) {
        throw new Error('Scene vừa sinh không có dữ liệu hợp lệ để đồng bộ.');
      }
      const semanticStatus = current.motionCanvasBundle.semanticValidation?.status;
      if (semanticStatus === 'failed') {
        throw new Error('Scene render được nhưng chưa bao phủ đủ các đối tượng, quan hệ hoặc hành động bắt buộc trong kế hoạch hình ảnh.');
      }
      if (current.motionCanvasBundle.status !== 'approved') {
        const acceptDegradedSemantic = semanticStatus === 'degraded'
          ? window.confirm('Scene chưa có đủ bằng chứng semantic tự động. Scene vẫn render và giữ đúng voice/timestamp; hãy kiểm tra kỹ ý nghĩa hình ảnh trong editor trước khi tiếp tục.')
          : false;
        if (semanticStatus === 'degraded' && !acceptDegradedSemantic) {
          setProject(current);
          setMessage('Đã giữ scene ở trạng thái nháp để bạn kiểm tra ý nghĩa hình ảnh trước khi duyệt.');
          notifyTaskCompleted({
            id: `production:${taskId}`,
            title: 'Scene nháp đã sẵn sàng',
            message: 'Scene chưa có đủ bằng chứng semantic tự động nên được giữ ở trạng thái nháp để bạn kiểm tra.',
          });
          return;
        }
        setMessage('Đang chuẩn bị scene để ghép theo timing giọng đọc…');
        current = await approveMotionCanvas(current.id, current.revision, acceptDegradedSemantic ? {acceptDegradedSemantic: true} : {});
        setProject(current);
      }
      if (!current.animationSyncBundle || animationSyncIsStale(current)) {
        operationStage = 'sync';
        setMessage('Đang đồng bộ scene theo timing thật của giọng đọc…');
        current = await generateAnimationSync(
          current.id,
          {generationId: newGenerationId()},
          current.revision,
        );
        setProject(current);
      }
      if (current.animationSyncBundle?.status !== 'approved') {
        operationStage = 'sync';
        current = await approveAnimationSync(current.id, current.revision);
        setProject(current);
      }
      const semanticDegraded = semanticStatus === 'degraded';
      setState('ready');
      setMessage(semanticDegraded
        ? 'Scene đã sẵn sàng nhưng semantic chưa thể tự xác minh. Hãy kiểm tra kế hoạch hình ảnh trong editor trước khi xuất.'
        : 'Scene đã vượt qua cả kiểm tra render và độ bao phủ kế hoạch hình ảnh.');
      setLatestSceneFailure(null);
      setFailureKind(null);
      notifyTaskCompleted({
        id: `production:${taskId}`,
        title: 'Scene và đồng bộ đã sẵn sàng',
        message: semanticDegraded
          ? 'Scene chưa có đủ bằng chứng semantic tự động; voice vẫn nguyên vẹn và editor sẽ hiển thị cảnh báo để bạn kiểm tra ý nghĩa hình ảnh.'
          : 'PAD Studio đã hoàn tất lượt tạo và bao phủ kế hoạch hình ảnh. Bạn có thể bắt đầu kiểm tra scene.',
      });
      allowNextWorkflowNavigation();
      navigate(projectScenesPath(current.id));
    } catch (error) {
      setActiveSceneGenerationId(null);
      setFailureKind(operationStage);
      if (operationStage === 'scene') {
        const failure = await getLatestMotionCanvasFailure(project.id).catch(
          () => null,
        );
        if (failure) setLatestSceneFailure(failure);
      }
      setState('error');
      const errorMessage = error instanceof ApiRequestError || error instanceof Error
        ? error.message
        : 'Không thể hoàn tất lượt tạo này.';
      setMessage(errorMessage);
      notifyTaskFailed({
        id: `production:${taskId}`,
        title: operationStage === 'audio'
          ? 'Tạo audio thất bại'
          : operationStage === 'sync'
            ? 'Đồng bộ scene thất bại'
            : operationStage === 'scene'
              ? 'Sinh scene thất bại'
              : 'Chuẩn bị kế hoạch thất bại',
        message: errorMessage,
      });
    } finally {
      setBusyAction(null);
    }
  }

  if (state === 'loading') return <div className="page-state" role="status"><span className="spinner dark" /><strong>Đang mở bước audio và scene…</strong></div>;
  if (!project) return <div className="page-state is-error" role="alert"><strong>Không thể mở project</strong><p>{message}</p></div>;
  if (!narrationApproved) return <div className="page-state is-error" role="alert"><strong>Voice chưa được duyệt</strong><p>Chỉ bản cách đọc đã duyệt mới được gửi tới ElevenLabs.</p><button type="button" onClick={() => navigate(projectPronunciationPath(projectId))}>Quay lại duyệt voice</button></div>;

  const firstSection = project.voiceBundle?.sections[0];
  const recoveryGuidance = recoveryGuidanceFor(latestSceneFailure, message);
  const canRecoverScene =
    !busyAction && audioReady && codex.isTaskReady('motionCanvas');
  return (
    <main className="production-workspace">
      <div className="page-heading">
        <div className="eyebrow">
          <span>Bước 03 · Giọng đọc & scene</span>
          <div className="eyebrow-line" />
        </div>
        <h1>Chọn giọng ElevenLabs rồi sinh scene</h1>
        <p>Chọn voice và model tiếng Việt cho bản cách đọc đã duyệt. Codex dùng cùng lời thoại đó để dựng scene ở bước kế tiếp.</p>
      </div>
      <RuntimeDiagnosticsCard />
      {busyAction && (
        <section className="production-operation-status" role="status" aria-live="polite">
          <span className="spinner dark" aria-hidden="true" />
          <div>
            {sceneProgress?.state === 'running' && activeSceneGenerationId === sceneProgress.generationId && (
              <div className="production-scene-progress">
                <strong>{sceneProgress.message}</strong>
                <progress
                  max={Math.max(1, sceneProgress.totalSamples || sceneProgress.totalScenes)}
                  value={sceneProgress.totalSamples
                    ? sceneProgress.completedSamples
                    : sceneProgress.completedScenes}
                />
                <small>
                  {sceneProgress.stage === 'quality-render'
                    ? `${sceneProgress.completedSamples}/${sceneProgress.totalSamples} khung hình · ${sceneProgress.cachedSamples} từ cache`
                    : `${sceneProgress.completedScenes}/${sceneProgress.totalScenes} scene · vòng ${sceneProgress.attempt + 1}`}
                </small>
              </div>
            )}
            <strong>{message || 'Đang xử lý yêu cầu sản xuất…'}</strong>
            <p>Yêu cầu đang chạy. PAD Studio chỉ chuyển sang editor khi toàn bộ scene, kiểm tra khung hình và đồng bộ audio hoàn tất.</p>
          </div>
        </section>
      )}
      {state === 'error' && message && (
        <section className="production-operation-status is-error" role="alert">
          <div>
            <strong>Yêu cầu chưa hoàn tất</strong>
            <p>{message}</p>
            <p>Những artifact đã hoàn tất trước khi lỗi vẫn được giữ nguyên; chỉ bước chưa hoàn thành cần thử lại.</p>
            {failureKind === 'scene' && latestSceneFailure ? (
              <div className="production-recovery-action">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!canRecoverScene}
                  onClick={() => void runProduction('regenerateScene', recoveryGuidance)}
                >
                  Tự khắc phục scene bằng Codex
                </button>
                <small>PAD Studio chỉ gửi lỗi scene cho Codex. Audio và kế hoạch hình ảnh hiện hành không bị tạo lại.</small>
              </div>
            ) : (
              <small>{failureKind === 'audio'
                ? 'Kiểm tra ElevenLabs, FFmpeg và cấu hình voice rồi bấm lại nút tạo audio.'
                : failureKind === 'visual-plan'
                  ? 'Kiểm tra kết nối Codex ở phần lập kế hoạch hình ảnh rồi bấm lại đúng thao tác vừa dùng.'
                  : failureKind === 'scene'
                    ? 'Kiểm tra kết nối và lựa chọn model Codex rồi bấm lại nút sinh scene.'
                    : 'Bấm lại “Chuẩn bị editor có tiếng”; audio và scene hiện hành không cần sinh lại.'}</small>
            )}
          </div>
        </section>
      )}
      {!busyAction && state !== 'error' && latestSceneFailure && (
        <section className="production-operation-status is-error" role="alert">
          <div>
            <strong>Lần sinh scene gần nhất chưa hoàn tất</strong>
            <p>{latestSceneFailure.firstIssueReason || latestSceneFailure.message}</p>
            <p>PAD Studio đã giữ nguyên bản trước đó. Lỗi được ghi lúc {new Date(latestSceneFailure.failedAt).toLocaleString('vi-VN')} và sẽ vẫn hiển thị sau khi tải lại trang.</p>
            <div className="production-recovery-action">
              <button
                className="secondary-button"
                type="button"
                disabled={!canRecoverScene}
                onClick={() => void runProduction('regenerateScene', recoveryGuidance)}
              >
                Tự khắc phục bằng Codex
              </button>
              <small>Không cần chép lỗi hay tự chỉnh mã scene. Lỗi được gửi kèm cho Codex; bản mới vẫn độc lập với scene hiện có.</small>
            </div>
          </div>
        </section>
      )}
      <div className="production-grid">
        <section className="production-card">
          <header>
            <span>ElevenLabs</span>
            <h2>Giọng đọc tiếng Việt</h2>
          </header>
          <ElevenLabsConnectionCard connection={eleven} />
          <div className="production-fields">
            <label>
              <span>Voice</span>
              <select
                value={voiceId}
                onChange={event => setVoiceId(event.currentTarget.value)}
                disabled={!eleven.connected || busyAction !== null}
              >
                <option value="">Chọn voice</option>
                {project.voiceBundle && !catalog?.voices.some(voice => voice.voiceId === project.voiceBundle!.configuration.voiceId) && (
                  <option value={project.voiceBundle.configuration.voiceId}>
                    {project.voiceBundle.configuration.voiceName} (đang dùng)
                  </option>
                )}
                {catalog?.voices.map(voice => <option value={voice.voiceId} key={voice.voiceId}>{voice.name}</option>)}
              </select>
            </label>
            <label>
              <span>Model tiếng Việt</span>
              <select
                value={modelId}
                onChange={event => setModelId(event.currentTarget.value)}
                disabled={!eleven.connected || busyAction !== null}
              >
                <option value="">Chọn model</option>
                {project.voiceBundle && !catalog?.models.some(model => model.modelId === project.voiceBundle!.configuration.modelId) && (
                  <option value={project.voiceBundle.configuration.modelId}>
                    {project.voiceBundle.configuration.modelName} (đang dùng)
                  </option>
                )}
                {catalog?.models.filter(model => model.languages.includes('vi')).map(model => <option value={model.modelId} key={model.modelId}>{model.name}</option>)}
              </select>
            </label>
          </div>
          <details className="production-voice-settings">
            <summary>Thông số giọng đọc</summary>
            <label>
              <span>Ổn định giọng <small>{settings.stability.toFixed(2)}</small></span>
              <input type="range" min={0} max={1} step={0.05} value={settings.stability} disabled={busyAction !== null} onChange={event => setSettings(current => ({...current, stability: Number(event.currentTarget.value)}))} />
            </label>
            <label>
              <span>Độ giống giọng gốc <small>{settings.similarityBoost.toFixed(2)}</small></span>
              <input type="range" min={0} max={1} step={0.05} value={settings.similarityBoost} disabled={busyAction !== null} onChange={event => setSettings(current => ({...current, similarityBoost: Number(event.currentTarget.value)}))} />
            </label>
            <label>
              <span>Tốc độ đọc <small>{settings.speed.toFixed(2)}×</small></span>
              <input type="range" min={0.7} max={1.2} step={0.05} value={settings.speed} disabled={busyAction !== null} onChange={event => setSettings(current => ({...current, speed: Number(event.currentTarget.value)}))} />
            </label>
            {selectedModel?.canUseStyle && (
              <label>
                <span>Biểu cảm (style) <small>{settings.style.toFixed(2)}</small></span>
                <input type="range" min={0} max={1} step={0.05} value={settings.style} disabled={busyAction !== null} onChange={event => setSettings(current => ({...current, style: Number(event.currentTarget.value)}))} />
              </label>
            )}
            {selectedModel?.canUseSpeakerBoost && (
              <label className="production-voice-toggle">
                <input type="checkbox" checked={settings.useSpeakerBoost} disabled={busyAction !== null} onChange={event => setSettings(current => ({...current, useSpeakerBoost: event.currentTarget.checked}))} />
                <span>Speaker boost</span>
              </label>
            )}
          </details>
          {!audioReady && (
            <div className="production-action">
              <button
                className="secondary-button"
                type="button"
                disabled={!eleven.connected || !voiceId || !modelId || busyAction !== null}
                onClick={() => void createAudio()}
              >
                {busyAction === 'createAudio' ? 'Đang tạo audio…' : 'Tạo audio'}
              </button>
              <small>
                {!eleven.connected
                  ? 'Kết nối ElevenLabs để bắt đầu.'
                  : !voiceId || !modelId
                    ? 'Chọn voice và model tiếng Việt trước.'
                    : 'Chỉ tạo giọng đọc; scene sẽ được tạo ở khung bên cạnh.'}
              </small>
            </div>
          )}
          {audioReady && (
            <>
              <div className={`production-selection-note${voiceSelectionChanged ? ' is-changed' : ''}`}>
                <span>{voiceSelectionChanged ? 'Lựa chọn mới chưa áp dụng' : 'Đang dùng lựa chọn này'}</span>
                <button
                  type="button"
                  onClick={() => void regenerateAudio()}
                  disabled={!eleven.connected || !voiceId || !modelId || busyAction !== null}
                >
                  {busyAction === 'regenerateAudio' ? 'Đang tạo…' : voiceSelectionChanged ? 'Đổi giọng & tạo lại' : 'Tạo lại audio'}
                </button>
              </div>
              <div className="production-result">
                <strong>Audio đã tạo</strong>
                <p>{project.voiceBundle!.configuration.voiceName} · {Math.round(project.voiceBundle!.totalDurationSeconds)} giây</p>
                {firstSection && <audio controls src={voiceAudioUrl(project.id, firstSection.outlineSectionId, project.voiceBundle!.generation.generationId)} />}
              </div>
            </>
          )}
        </section>
        <section className="production-card">
          <header>
            <span>Codex</span>
            <h2>Lập kế hoạch & dựng scene</h2>
          </header>
          <CodexConnectionCard
            connection={codex}
            task="visualPlanner"
            extraTasks={[{
              task: 'motionCanvas',
              label: 'Scene Motion Canvas',
              workUnits: project.voiceVisualPlan?.sections.length ?? 1,
            }]}
          />
          <div className="production-result">
            <strong>AI lập kế hoạch hình ảnh</strong>
            <p>Kế hoạch hình ảnh giữ lại đối tượng, quan hệ, hành động và điều người xem phải tự suy ra. Scene được ghép tự do từ các thành phần an toàn, không bị khóa vào một danh sách mẫu cố định.</p>
            {audioReady && (
              <div className="production-action">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!codex.isTaskReady('visualPlanner') || busyAction !== null}
                  onClick={() => void replanVisuals()}
                >
                  {busyAction === 'replanVisual' ? 'Đang lập lại kế hoạch hình ảnh…' : 'Lập lại hình ảnh, giữ nguyên voice'}
                </button>
                <small>Giữ nguyên audio, alignment, section/beat ID và timestamp. Chỉ kế hoạch hình ảnh, scene, đồng bộ và render phía sau được làm mới.</small>
              </div>
            )}
          </div>
          <div className="production-result">
            <strong>{syncReady ? 'Scene và audio đã đồng bộ' : sceneReady ? 'Scene đang cần đồng bộ' : 'Sẵn sàng phân tích trực tiếp'}</strong>
            <p>{syncReady ? `${project.motionCanvasBundle!.scenes.length} scene đã được ánh xạ theo timing giọng đọc thật.` : sceneReady ? 'Hệ thống sẽ tự chuẩn bị và ghép scene theo audio trước khi mở editor.' : 'Codex sinh scene, sau đó hệ thống tự ghép timing ElevenLabs.'}</p>
            {project.motionCanvasBundle?.semanticValidation && (
              <div className={`production-selection-note${project.motionCanvasBundle.semanticValidation.status === 'failed' ? ' is-changed' : ''}`}>
                <span>
                  {project.motionCanvasBundle.semanticValidation.status === 'failed'
                    ? 'Thiếu yêu cầu hình ảnh bắt buộc — chưa đạt'
                    : project.motionCanvasBundle.semanticValidation.status === 'degraded'
                      ? 'Bằng chứng semantic chưa đầy đủ — nên xem lại trước khi duyệt'
                      : 'Đã xác minh Visual Intent và node runtime'}
                </span>
                {project.motionCanvasBundle.semanticValidation.status === 'failed' && (
                  <small>
                    {project.motionCanvasBundle.semanticValidation.scenes.filter(scene => scene.status === 'failed').length} scene cần chú ý
                  </small>
                )}
              </div>
            )}
            {sceneReady && (
              <div className="production-action">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!audioReady || !codex.isTaskReady('motionCanvas') || busyAction !== null}
                  onClick={() => void runProduction('regenerateScene')}
                >
                  {busyAction === 'regenerateScene' ? 'Đang sinh lại scene…' : 'Sinh lại scene độc lập'}
                </button>
                <small>Luôn sinh như lần đầu từ kế hoạch hình ảnh và voice đã duyệt; không gửi hay tham chiếu scene hiện có. Bản hiện tại vẫn được lưu trong lịch sử.</small>
              </div>
            )}
            {sceneReady && !syncReady && (
              <div className="production-action">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyAction !== null}
                  onClick={() => void runProduction('combined')}
                >
                  {busyAction === 'combined' ? 'Đang chuẩn bị…' : 'Chuẩn bị editor có tiếng'}
                </button>
                <small>Không cần duyệt preview trung gian; editor sẽ mở trên bản đã đồng bộ.</small>
              </div>
            )}
            {syncReady && (
              <div className="production-action">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyAction !== null}
                  onClick={() => navigate(projectScenesPath(project.id))}
                >
                  Mở editor có tiếng
                </button>
                <small>Mở workspace để kiểm tra hoặc chỉnh sửa scene.</small>
              </div>
            )}
            {!sceneReady && (
              <div className="production-action">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!audioReady || !codex.isTaskReady('motionCanvas') || busyAction !== null}
                  onClick={() => void runProduction('generateScene')}
                >
                  {busyAction === 'generateScene' ? 'Đang sinh scene…' : 'Sinh scene'}
                </button>
                <small>
                  {!audioReady
                    ? 'Tạo audio trước khi sinh scene.'
                    : !codex.isTaskReady('motionCanvas')
                      ? 'Kết nối Codex để sinh scene.'
                      : 'Scene sẽ được đồng bộ trước khi mở editor.'}
                </small>
              </div>
            )}
          </div>
        </section>
      </div>
      <footer className="production-footer">
        <div>
          <strong>{busyAction ? 'Đang xử lý yêu cầu hiện tại' : syncReady ? 'Bản đồng bộ đã sẵn sàng chỉnh' : sceneReady ? 'Scene cần đồng bộ với audio' : audioReady ? 'Audio đã sẵn sàng, tiếp tục sinh scene' : 'Sẵn sàng sản xuất'}</strong>
          <p>{message || 'Mỗi dịch vụ chỉ được gọi khi phần trước đã sẵn sàng.'}</p>
        </div>
        {syncReady ? (
          <button className="submit-button" type="button" disabled={busyAction !== null} onClick={() => navigate(projectScenesPath(project.id))}>Mở editor có tiếng</button>
        ) : (
          <button className="submit-button" type="button" disabled={!canRunCombined} onClick={() => void runProduction('combined')}>
            {busyAction === 'combined' ? 'Đang xử lý…' : sceneReady ? 'Mở editor có tiếng' : audioReady ? 'Sinh scene & mở editor' : 'Tạo audio, scene & mở editor'}
          </button>
        )}
      </footer>
    </main>
  );
}
