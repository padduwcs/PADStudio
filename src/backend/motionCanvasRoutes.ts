import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  motionCanvasIsStale,
  motionCanvasMatchesOutline,
  sameValue,
  voiceVisualMatchesOutline
} from '../shared/projectPipeline.ts';
import {
  GenerateMotionCanvasSchema,
  type MotionCanvasBundle
} from '../shared/topic.ts';
import {
  MOTION_CANVAS_PROMPT_VERSION,
  mergeMotionCanvasGenerationUsage,
} from './motionCanvasGenerator.ts';
import {MotionCanvasVisualQualityError, assertVisualValidationCurrent, buildMotionCanvasSemanticValidation, formatVisualQualityRetryGuidance, semanticValidationIsCurrent, visualQualityFailureIsRendererOnly} from './motionCanvasVisualQuality.ts';
import {
  hashMotionCanvasBundle
} from './motionCanvasHistoryStore.ts';
import {
  MotionCanvasWorkspaceError,
  type PreparedMotionCanvasWorkspace
} from './motionCanvasWorkspace.ts';
import {
  narrationArtifactsAreCurrent,
  narrationPlanMatchesReviewedNarration
} from './narrationPlan.ts';
import {
  ProjectConflictError
} from './projectRepository.ts';
import {
  getProjectMotionCanvasRoute
} from './projectRoutes.ts';

import type {AppContext} from './appContext.ts';
import {RequestBodyError, sendApiError} from './appErrors.ts';
import {assertSameCodexGenerationSelection, outlineContent, projectVideoFrame, voiceVisualContent} from './appRouteSupport.ts';
import {readExpectedRevision, readJsonBody, requestParentOrigin, sendJson, sendProject, validationFields} from './httpTransport.ts';
import type {ApiRouteHandler} from './routeTypes.ts';
import {z} from 'zod';

const ApproveMotionCanvasSchema = z.object({acceptDegradedSemantic: z.literal(true).optional()}).strict();

/**
 * Guidance attached to an in-place edit of a stale bundle is unsafe: it would
 * patch scenes built from a voice-visual plan that no longer exists. Guidance
 * attached to a `regenerateFromScratch` request is not — that path never
 * reuses the stale bundle's scene sources (see `currentScenes` below), so the
 * guidance is only ever extra context for Codex about a prior failure. This
 * used to reject both, turning the UI's only scene-recovery button into a
 * dead end whenever the voice-visual plan had changed since the last attempt.
 */
export function motionCanvasGuidanceOnStaleBundleIsUnsafe(options: {
  hasGuidance: boolean;
  bundleExists: boolean;
  currentBundleUsable: boolean;
  regenerateFromScratch: boolean;
}) {
  return (
    options.hasGuidance &&
    options.bundleExists &&
    !options.currentBundleUsable &&
    !options.regenerateFromScratch
  );
}

type MotionCanvasRouteContext = Pick<AppContext, 'repository' | 'motionCanvasGenerator' | 'motionCanvasGenerationProgressStore' | 'motionCanvasWorkspace' | 'motionCanvasVisualQualityGate' | 'motionCanvasHistoryStore' | 'motionCanvasGenerations' | 'layoutPreviewService' | 'generateOnce' | 'logger'>;

/** Compiler/generation failures deserve the same recovery path as rendered
 * quality failures.  Persist concise, model-ready context rather than leaving
 * the user with a message that cannot be acted on from the UI. */
function generationRecoveryGuidance(error: unknown) {
  const reason = error instanceof Error
    ? error.message.slice(0, 1_800)
    : 'The previous Scene Spec generation did not complete.';
  return [
    'Generate a completely fresh Scene Graph v3 from the approved Visual Intent and voice. Do not reuse prior scene source.',
    `Previous generation failure: ${reason}`,
    'Keep every beat UUID and exact mustShow intent binding. Use concise labels, recognizable composite entities, explicit relationships, and meaningful actions.',
  ].join('\n').slice(0, 4_000);
}

export function createMotionCanvasRouteHandler(context: MotionCanvasRouteContext): ApiRouteHandler {
  const {repository, motionCanvasGenerator, motionCanvasGenerationProgressStore, motionCanvasWorkspace, motionCanvasVisualQualityGate, motionCanvasHistoryStore, motionCanvasGenerations, layoutPreviewService, generateOnce, logger} = context;
  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    const motionCanvasRoute = getProjectMotionCanvasRoute(
      requestUrl.pathname,
    );

    if (
      motionCanvasRoute?.action === 'status' &&
      request.method === 'GET'
    ) {
      const currentProject = await repository.getProject(
        motionCanvasRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const progress = await motionCanvasGenerationProgressStore.get(
        currentProject.id,
      );
      sendJson(response, 200, {progress});
      return true;
    }

    if (
      motionCanvasRoute?.action === 'failure' &&
      request.method === 'GET'
    ) {
      const currentProject = await repository.getProject(
        motionCanvasRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const failure = await motionCanvasWorkspace.readLatestFailure?.(
        currentProject.id,
      ) ?? null;
      sendJson(response, 200, {failure});
      return true;
    }

    if (
      motionCanvasRoute?.action === 'generate' &&
      request.method === 'POST'
    ) {
      const expectedRevision = readExpectedRevision(request);
      const body = await readJsonBody(request);
      const parsedRequest = GenerateMotionCanvasSchema.safeParse(body);

      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu sinh scene Motion Canvas chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }
      const generationId =
        parsedRequest.data.generationId.toLowerCase();

      const currentProject = await repository.getProject(
        motionCanvasRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }

      if (
        currentProject.motionCanvasBundle?.generation.generationId ===
        generationId
      ) {
        assertSameCodexGenerationSelection(
          currentProject.motionCanvasBundle.generation,
          parsedRequest.data,
        );
        sendProject(response, 200, currentProject);
        return true;
      }

      if (currentProject.revision !== expectedRevision) {
        throw new ProjectConflictError(currentProject);
      }

      const outline = currentProject.outline;
      const voiceVisualPlan = currentProject.voiceVisualPlan;
      const narrationArtifacts = narrationArtifactsAreCurrent(outline, voiceVisualPlan);
      if (
        !outline ||
        outline.status !== 'approved' ||
        !sameValue(outline.sourceInput, currentProject.topicInput) ||
        !voiceVisualPlan ||
        voiceVisualPlan.status !== 'approved' ||
        voiceVisualPlan.sourceOutlineContentRevision !==
        outline.contentRevision ||
        !voiceVisualMatchesOutline(voiceVisualPlan, outline) ||
        (narrationArtifacts &&
          (!currentProject.voiceBundle ||
            !currentProject.narration?.review ||
            currentProject.narration.approvedSourceHash !==
            currentProject.narration.review.sourceHash ||
            !narrationPlanMatchesReviewedNarration(
              currentProject.narration,
              voiceVisualPlan,
            )))
      ) {
        throw new RequestBodyError(
          409,
          'VOICE_VISUAL_NOT_APPROVED',
          'Hãy chốt kế hoạch voice–visual hiện tại trước khi sinh scene.',
        );
      }

      const currentBundleUsable = Boolean(
        currentProject.motionCanvasBundle &&
        currentProject.motionCanvasBundle
          .sourceVoiceVisualContentRevision ===
        voiceVisualPlan.contentRevision &&
        motionCanvasMatchesOutline(
          currentProject.motionCanvasBundle,
          outline,
        ),
      );
      const regenerateFromScratch =
        parsedRequest.data.regenerateFromScratch === true;
      if (currentBundleUsable && !regenerateFromScratch) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_CANDIDATE_REQUIRED',
          'Workspace scene đã tồn tại. Hãy chọn scene và tạo candidate để so sánh thay vì ghi đè trực tiếp.',
        );
      }
      if (
        motionCanvasGuidanceOnStaleBundleIsUnsafe({
          hasGuidance: Boolean(parsedRequest.data.guidance),
          bundleExists: Boolean(currentProject.motionCanvasBundle),
          currentBundleUsable,
          regenerateFromScratch,
        })
      ) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_OUTDATED',
          'Kế hoạch voice–visual đã thay đổi. Hãy sinh lại toàn bộ scene trước khi góp ý.',
        );
      }

      const currentScenes =
        parsedRequest.data.guidance &&
          !regenerateFromScratch &&
          currentBundleUsable &&
          currentProject.motionCanvasBundle
          ? await motionCanvasWorkspace.readSceneSources(
            currentProject.id,
            currentProject.motionCanvasBundle,
          )
          : undefined;
      const generationKey = `${currentProject.id}:${generationId}`;
      const fingerprint = JSON.stringify({
        topicInput: currentProject.topicInput,
        outline: outlineContent(outline),
        outlineContentRevision: outline.contentRevision,
        voiceVisual: voiceVisualContent(voiceVisualPlan),
        voiceVisualContentRevision: voiceVisualPlan.contentRevision,
        model: parsedRequest.data.model,
        reasoningEffort: parsedRequest.data.reasoningEffort,
        regenerateFromScratch,
        guidance: parsedRequest.data.guidance,
        currentScenes,
      });
      await motionCanvasGenerationProgressStore.start({
        projectId: currentProject.id,
        generationId,
        totalScenes: voiceVisualPlan.sections.length,
      });
      const reportProgress = (
        patch: Parameters<typeof motionCanvasGenerationProgressStore.update>[2],
      ) => {
        void motionCanvasGenerationProgressStore
          .update(currentProject.id, generationId, patch)
          .catch(error => logger.error(error));
      };
      const generation = await generateOnce(
        motionCanvasGenerations,
        generationKey,
        fingerprint,
        async () => {
          const generationRequest = {
            projectId: currentProject.id,
            generationId,
            model: parsedRequest.data.model,
            reasoningEffort: parsedRequest.data.reasoningEffort,
            regenerateFromScratch,
            topicInput: currentProject.topicInput,
            videoFrame: projectVideoFrame(currentProject),
            outline,
            voiceVisualPlan,
            guidance: parsedRequest.data.guidance,
            currentScenes,
            onProgress: (progress: {
              completedScenes: number;
              totalScenes: number;
              outcome: 'started' | 'completed' | 'failed';
            }) => reportProgress({
              stage: 'generating-scenes',
              message: progress.outcome === 'started'
                ? `Codex đang sinh ${progress.totalScenes} scene bằng tối đa 4 worker.`
                : `Codex đã xử lý ${progress.completedScenes}/${progress.totalScenes} scene.`,
              completedScenes: progress.completedScenes,
              totalScenes: progress.totalScenes,
              completedSamples: 0,
              totalSamples: 0,
              cachedSamples: 0,
            }),
          };
          let generated = await motionCanvasGenerator
            .generate(generationRequest)
            .catch(async error => {
              await motionCanvasWorkspace.recordFailure?.(
                currentProject.id,
                generationId,
                {
                  stage: 'generation',
                  code: 'MOTION_CANVAS_GENERATION_FAILED',
                  message:
                    error instanceof Error ? error.message : String(error),
                  details: null,
                  issues: [],
                  recoveryGuidance: generationRecoveryGuidance(error),
                  scenes: [],
                },
              ).catch(recordError => logger.error(recordError));
              throw error;
            });
          reportProgress({
            stage: 'compiling',
            message: `Đã sinh ${generated.scenes.length} scene; đang biên dịch workspace an toàn.`,
            completedScenes: generated.scenes.length,
            totalScenes: generated.scenes.length,
          });
          const qualityRetryDiagnostics = [...(generated.qualityRetryDiagnostics ?? [])];
          let prepared: PreparedMotionCanvasWorkspace | null = null;
          let acceptedWorkspace = false;
          let repairAttempts = 0;
          let fallbackAttempted = false;
          const generationDiagnostics: NonNullable<MotionCanvasBundle['generationDiagnostics']> = [];
          try {
            while (!prepared) {
            try {
              prepared = await motionCanvasWorkspace.prepare(
                currentProject.id,
                generationId,
                generated.scenes,
                projectVideoFrame(currentProject),
              );
            } catch (error) {
              if (
                error instanceof MotionCanvasWorkspaceError &&
                error.code === 'MOTION_CANVAS_VALIDATION_FAILED' &&
                error.details &&
                motionCanvasGenerator.repair &&
                repairAttempts < 1
              ) {
                repairAttempts += 1;
                reportProgress({
                  stage: 'quality-retry',
                  message: 'Compiler phát hiện source chưa hợp lệ; Codex đang sửa đúng scene liên quan.',
                  attempt: repairAttempts,
                });
                generationDiagnostics.push({stage: 'repair', attempt: repairAttempts, reason: error.details.slice(0, 4_000), outcome: 'failed'});
                try {
                  generated = await motionCanvasGenerator.repair(
                    generationRequest,
                    generated,
                    error.details,
                  );
                } catch (repairError) {
                  if (
                    !motionCanvasGenerator.recover ||
                    fallbackAttempted
                  ) {
                    throw repairError;
                  }
                  fallbackAttempted = true;
                  generationDiagnostics.push({stage: 'fallback', attempt: 1, reason: repairError instanceof Error ? repairError.message.slice(0, 4_000) : 'Repair failed after actionable workspace diagnostics.', outcome: 'used_fallback'});
                  generated = motionCanvasGenerator.recover(
                    generationRequest,
                    generated,
                    `${error.details}\n\nRepair failed: ${repairError instanceof Error
                      ? repairError.message
                      : String(repairError)
                    }`,
                  );
                }
                continue;
              }
              if (
                error instanceof MotionCanvasWorkspaceError &&
                error.code === 'MOTION_CANVAS_VALIDATION_FAILED' &&
                error.details &&
                motionCanvasGenerator.recover &&
                !fallbackAttempted
              ) {
                fallbackAttempted = true;
                generationDiagnostics.push({stage: 'fallback', attempt: 1, reason: error.details.slice(0, 4_000), outcome: 'used_fallback'});
                generated = motionCanvasGenerator.recover(
                  generationRequest,
                  generated,
                  error.details,
                );
                continue;
              }
              throw error;
            }
            }
            const lifecycleFor = (scenes: typeof generated.scenes) => new Map(
            scenes.flatMap(scene => {
              const section = voiceVisualPlan.sections.find(item => item.outlineSectionId === scene.outlineSectionId);
              return (section?.beats ?? []).map(beat => [beat.id, {
                stay: beat.visualLifecycle!.stay,
                primaryBlock: beat.primaryBlock,
                compositionContract: beat.compositionContract,
                visualDescription: beat.visualDescription,
                visualPurpose: beat.visualPurpose,
                animationDescription: beat.animationDescription,
                visualIntent: beat.visualIntent,
              }] as const);
            }),
          );
            const handoffFor = (scenes: typeof generated.scenes) => new Map(
            scenes.map(scene => {
              const section = voiceVisualPlan.sections.find(item => item.outlineSectionId === scene.outlineSectionId);
              return [scene.id, {incoming: section?.stateHandoff?.incoming ?? null, outgoing: section?.stateHandoff?.outgoing ?? null}] as const;
            }),
          );
            let visualValidation;
            const maximumQualityRetries = 2;
            const maximumRendererRetries = 1;
            let contentRepairAttempts = 0;
            let rendererRetryAttempts = 0;
            let lastRepairedSceneCount = 0;
            let smokePassed =
              motionCanvasVisualQualityGate.supportsSmokeMode !== true;
            for (;;) {
              try {
                const qualityMode = smokePassed ? 'full' as const : 'smoke' as const;
                const totalSamples = generated.scenes.reduce(
                  (total, scene) => total +
                    (scene.timingEvents?.length ?? 0) *
                    (qualityMode === 'smoke' ? 1 : 3),
                  0,
                );
                reportProgress({
                  stage: 'quality-render',
                  message: rendererRetryAttempts > 0
                    ? 'Renderer đang thử lại tại chỗ; Codex không bị gọi cho lỗi kỹ thuật này.'
                    : qualityMode === 'smoke'
                      ? `Đang kiểm tra nhanh ${totalSamples} khung giữa trước khi chạy kiểm định đầy đủ.`
                      : `Đang kiểm định đầy đủ ${totalSamples} khung hình; khung đã cache sẽ được dùng lại.`,
                  completedSamples: 0,
                  totalSamples,
                  cachedSamples: 0,
                  attempt: contentRepairAttempts,
                });
                let lastReportedQualityAt = 0;
                let lastReportedQualityCompleted = -1;
                visualValidation = await motionCanvasVisualQualityGate.validate({
                  scenes: prepared.sourceScenes,
                  lifecycle: lifecycleFor(generated.scenes),
                  frame: projectVideoFrame(currentProject),
                  backgroundColor: currentProject.topicInput.background.color,
                  visualBible: voiceVisualPlan.visualBible,
                  sceneHandoff: handoffFor(generated.scenes),
                  workspaceDirectory: prepared.workspaceDirectory,
                  projectFile: prepared.projectFilePath,
                  mode: qualityMode,
                  onProgress: progress => {
                    const timestamp = Date.now();
                    const completed = progress.completedSamples === progress.totalSamples;
                    if (
                      !completed &&
                      lastReportedQualityCompleted >= 0 &&
                      timestamp - lastReportedQualityAt < 500
                    ) return;
                    lastReportedQualityAt = timestamp;
                    lastReportedQualityCompleted = progress.completedSamples;
                    reportProgress({
                      stage: 'quality-render',
                      message: `Đã kiểm định ${progress.completedSamples}/${progress.totalSamples} khung hình${progress.cachedSamples ? ` (${progress.cachedSamples} từ cache)` : ''}.`,
                      completedSamples: progress.completedSamples,
                      totalSamples: progress.totalSamples,
                      cachedSamples: progress.cachedSamples,
                      attempt: contentRepairAttempts,
                    });
                  },
                });
                if (qualityMode === 'smoke') {
                  smokePassed = true;
                  rendererRetryAttempts = 0;
                  reportProgress({
                    stage: 'quality-render',
                    message: 'Kiểm tra nhanh đã đạt; đang chuyển sang kiểm định đầy đủ.',
                    completedSamples: 0,
                    totalSamples: generated.scenes.reduce(
                      (total, scene) => total +
                        (scene.timingEvents?.length ?? 0) * 3,
                      0,
                    ),
                    cachedSamples: totalSamples,
                  });
                  continue;
                }
                if (contentRepairAttempts > 0) {
                  generationDiagnostics.push({stage: 'quality-retry', attempt: contentRepairAttempts, reason: `Re-rendered ${lastRepairedSceneCount} failed scene(s); the merged ${generated.scenes.length}-scene bundle passed rendered-frame validation.`, outcome: 'passed'});
                }
                break;
              } catch (error) {
                if (!(error instanceof MotionCanvasVisualQualityError)) throw error;
                if (visualQualityFailureIsRendererOnly(error.summary)) {
                  if (rendererRetryAttempts >= maximumRendererRetries) throw error;
                  rendererRetryAttempts += 1;
                  generationDiagnostics.push({stage: 'quality-retry', attempt: rendererRetryAttempts, reason: `Renderer infrastructure failed and was retried locally without Codex: ${error.summary.issues[0]?.reason ?? error.message}`.slice(0, 4_000), outcome: 'failed'});
                  reportProgress({
                    stage: 'quality-render',
                    message: 'Renderer gặp lỗi kỹ thuật; đang khởi động lại và thử một lần, không tiêu quota Codex.',
                    attempt: rendererRetryAttempts,
                  });
                  continue;
                }
                const failedSceneIds = [...new Set(error.summary.issues.map(issue => issue.sceneId))];
                const failedIndexes = generated.scenes
                  .map((scene, index) => failedSceneIds.includes(scene.id) ? index : -1)
                  .filter(index => index >= 0);
                contentRepairAttempts += 1;
                smokePassed =
                  motionCanvasVisualQualityGate.supportsSmokeMode !== true;
                generationDiagnostics.push({stage: 'quality-retry', attempt: contentRepairAttempts, reason: error.summary.issues.map(issue => `${issue.sceneId}/${issue.beatId ?? 'scene'}: ${issue.reason}`).join('; ').slice(0, 4_000), outcome: 'failed'});
                if (failedIndexes.length === 0 || contentRepairAttempts > maximumQualityRetries) throw error;

                const sectionIndexes = failedIndexes.map(index =>
                  voiceVisualPlan.sections.findIndex(section =>
                    section.outlineSectionId === generated.scenes[index]!.outlineSectionId,
                  ),
                );
                const retryGuidance = [
                  generationRequest.guidance,
                  formatVisualQualityRetryGuidance(error.summary.issues),
                ].filter(Boolean).join('\n\n');
                motionCanvasGenerator.discardGeneration?.(
                  currentProject.id,
                  generationId,
                );
                reportProgress({
                  stage: 'quality-retry',
                  message: `Codex chỉ đang sửa ${failedIndexes.length} scene không qua kiểm định; các scene còn lại được giữ nguyên.`,
                  completedScenes: 0,
                  totalScenes: failedIndexes.length,
                  attempt: contentRepairAttempts,
                });
                const repaired = await motionCanvasGenerator.generate({
                  ...generationRequest,
                  sectionIndexes,
                  currentScenes: generated.scenes,
                  ...(retryGuidance ? {guidance: retryGuidance} : {}),
                });
                lastRepairedSceneCount = repaired.scenes.length;
                for (const scene of repaired.scenes) {
                  const index = generated.scenes.findIndex(item =>
                    item.outlineSectionId === scene.outlineSectionId,
                  );
                  if (index >= 0) generated.scenes[index] = scene;
                }
                generated = {
                  ...generated,
                  model: repaired.model,
                  usage: mergeMotionCanvasGenerationUsage(generated.usage, repaired.usage),
                };
                qualityRetryDiagnostics.push(...(repaired.qualityRetryDiagnostics ?? []));
                await motionCanvasWorkspace.discard(currentProject.id, generationId);
                prepared = await motionCanvasWorkspace.prepare(
                  currentProject.id,
                  generationId,
                  generated.scenes,
                  projectVideoFrame(currentProject),
                );
              }
            }
            assertVisualValidationCurrent({visualValidation}, prepared.sourceScenes);
            generationDiagnostics.push({stage: 'generate', attempt: 0, reason: 'Source attachment/container/timing policy, compiler preparation, and rendered-frame quality gate passed.', outcome: 'passed'});
            generationDiagnostics.push(...qualityRetryDiagnostics);
            acceptedWorkspace = true;
            return {generated, prepared, generationDiagnostics, visualValidation};
          } catch (error) {
            const visualFailure =
              error instanceof MotionCanvasVisualQualityError ? error : null;
            await motionCanvasWorkspace.recordFailure?.(
              currentProject.id,
              generationId,
              {
                stage: visualFailure ? 'render-quality' : 'compile',
                code:
                  visualFailure
                    ? 'MOTION_CANVAS_VISUAL_QUALITY_FAILED'
                    : error instanceof MotionCanvasWorkspaceError
                      ? error.code
                      : 'MOTION_CANVAS_GENERATION_FAILED',
                message:
                  error instanceof Error ? error.message : String(error),
                details:
                  error instanceof MotionCanvasWorkspaceError
                    ? error.details
                    : null,
                issues: visualFailure?.summary.issues ?? [],
                recoveryGuidance: visualFailure
                  ? formatVisualQualityRetryGuidance(
                    visualFailure.summary.issues,
                  )
                  : generationRecoveryGuidance(error),
                scenes: generated.scenes,
              },
            ).catch(recordError => logger.error(recordError));
            throw error;
          } finally {
            if (!acceptedWorkspace) {
              await motionCanvasWorkspace.discard(currentProject.id, generationId).catch(error => logger.error(error));
            }
          }
        },
      ).catch(async error => {
        await motionCanvasGenerationProgressStore
          .fail(currentProject.id, generationId, error)
          .catch(progressError => logger.error(progressError));
        throw error;
      });
      const preparedWorkspace = generation.result.prepared;
      const motionCanvasBundle: MotionCanvasBundle = {
        status: 'draft',
        technicalReadyAt: new Date().toISOString(),
        generationDiagnostics: generation.result.generationDiagnostics,
        contentRevision:
          (currentProject.motionCanvasBundle?.contentRevision ?? 0) + 1,
        sourceVoiceVisualContentRevision:
          voiceVisualPlan.contentRevision,
        workspacePath: preparedWorkspace.workspacePath,
        projectFile: preparedWorkspace.projectFile,
        width: projectVideoFrame(currentProject).width,
        height: projectVideoFrame(currentProject).height,
        fps: projectVideoFrame(currentProject).fps,
        ...(preparedWorkspace.scenes.every(
          (scene) => scene.timingEvents?.length,
        )
          ? {timingContractVersion: 1 as const}
          : {}),
        scenes: preparedWorkspace.scenes,
        validation: preparedWorkspace.validation,
        visualValidation: generation.result.visualValidation,
        semanticValidation: buildMotionCanvasSemanticValidation(
          preparedWorkspace.sourceScenes,
          voiceVisualPlan,
        ),
        generation: {
          generationId,
          provider: 'codex',
          model: generation.result.generated.model,
          requestedModel: parsedRequest.data.model,
          reasoningEffort: parsedRequest.data.reasoningEffort,
          promptVersion: MOTION_CANVAS_PROMPT_VERSION,
          generatedAt: generation.generatedAt,
          usage: generation.result.generated.usage,
        },
      };
      if (currentProject.motionCanvasBundle) {
        await motionCanvasHistoryStore
          .ensureVersion({
            projectId: currentProject.id,
            origin: 'baseline',
            label: regenerateFromScratch
              ? 'Trước khi sinh lại scene độc lập'
              : 'Trước khi sinh lại theo voice–visual mới',
            parentVersionId: null,
            restoredFromVersionId: null,
            candidateId: null,
            projectRevision: currentProject.revision,
            contentHash: hashMotionCanvasBundle(
              currentProject.motionCanvasBundle,
            ),
            artifact: currentProject.motionCanvasBundle,
          })
          .catch(error => logger.error(error));
      }
      let updatedProject;
      try {
        await motionCanvasGenerationProgressStore.update(
          currentProject.id,
          generationId,
          {
            stage: 'committing',
            message: 'Kiểm định đã đạt; đang lưu generation mới vào project.',
          },
        );
        updatedProject = await repository.updateProject(
          currentProject.id,
          {motionCanvasBundle},
          expectedRevision,
        );
      } catch (error) {
        await motionCanvasWorkspace.discard(currentProject.id, generationId).catch(cleanupError => logger.error(cleanupError));
        await motionCanvasGenerationProgressStore
          .fail(currentProject.id, generationId, error)
          .catch(progressError => logger.error(progressError));
        throw error;
      }

      if (!updatedProject) {
        await motionCanvasWorkspace.discard(currentProject.id, generationId).catch(error => logger.error(error));
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }

      await motionCanvasHistoryStore
        .ensureVersion({
          projectId: updatedProject.id,
          origin: 'baseline',
          label: 'Workspace scene vừa sinh',
          parentVersionId: null,
          restoredFromVersionId: null,
          candidateId: null,
          projectRevision: updatedProject.revision,
          contentHash: hashMotionCanvasBundle(motionCanvasBundle),
          artifact: motionCanvasBundle,
        })
        .catch(error => logger.error(error));

      motionCanvasGenerator.discardGeneration?.(
        currentProject.id,
        generationId,
      );
      await motionCanvasGenerationProgressStore.complete(
        currentProject.id,
        generationId,
      );
      sendProject(response, 200, updatedProject);
      return true;
    }

    if (
      motionCanvasRoute?.action === 'files' &&
      request.method === 'GET'
    ) {
      const currentProject = await repository.getProject(
        motionCanvasRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      if (!currentProject.motionCanvasBundle) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_NOT_READY',
          'Project chưa có scene Motion Canvas.',
        );
      }

      const files = await motionCanvasWorkspace.readFiles(
        currentProject.id,
        currentProject.motionCanvasBundle,
      );
      sendJson(response, 200, {
        bundle: currentProject.motionCanvasBundle,
        files,
        serveCommand: `npm run motion:serve -- --project ${currentProject.id}`,
      });
      return true;
    }

    if (
      motionCanvasRoute?.action === 'preview' &&
      request.method === 'GET'
    ) {
      const currentProject = await repository.getProject(
        motionCanvasRoute.projectId,
      );
      const motion = currentProject?.motionCanvasBundle;
      if (!currentProject || !motion) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_NOT_READY',
          'Project chưa có scene Motion Canvas để xem trước.',
        );
      }
      const requestedGeneration = requestUrl.searchParams.get('generation');
      if (
        requestedGeneration &&
        requestedGeneration !== motion.generation.generationId
      ) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_PREVIEW_OUTDATED',
          'Scene Motion Canvas đã có generation mới hơn.',
        );
      }
      const preview = await layoutPreviewService.startMotion(
        currentProject.id,
        motion,
        {
          parentOrigin: requestParentOrigin(request),
          initialOverrides: [],
        },
      );
      sendJson(response, 200, {
        preview: {
          ...preview,
          sourceMotionCanvasGenerationId: preview.sourceSyncGenerationId,
        },
      });
      return true;
    }

    if (
      motionCanvasRoute?.action === 'approve' &&
      request.method === 'POST'
    ) {
      const expectedRevision = readExpectedRevision(request);
      const parsedApproval = ApproveMotionCanvasSchema.safeParse(await readJsonBody(request));
      if (!parsedApproval.success) {
        sendApiError(response, 422, {code: 'VALIDATION_ERROR', message: 'Yêu cầu chốt scene chưa hợp lệ.', fields: validationFields(parsedApproval.error.issues)});
        return true;
      }
      const currentProject = await repository.getProject(
        motionCanvasRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      if (currentProject.revision !== expectedRevision) {
        throw new ProjectConflictError(currentProject);
      }

      const outline = currentProject.outline;
      const voiceVisualPlan = currentProject.voiceVisualPlan;
      const motionCanvasBundle = currentProject.motionCanvasBundle;
      if (!motionCanvasBundle) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_NOT_READY',
          'Hãy sinh scene Motion Canvas trước khi chốt.',
        );
      }
      if (
        !outline ||
        outline.status !== 'approved' ||
        !voiceVisualPlan ||
        voiceVisualPlan.status !== 'approved' ||
        !sameValue(outline.sourceInput, currentProject.topicInput) ||
        voiceVisualPlan.sourceOutlineContentRevision !==
        outline.contentRevision ||
        motionCanvasBundle.sourceVoiceVisualContentRevision !==
        voiceVisualPlan.contentRevision ||
        !motionCanvasMatchesOutline(motionCanvasBundle, outline)
      ) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_OUTDATED',
          'Kế hoạch voice–visual đã thay đổi. Hãy sinh lại scene trước khi chốt.',
        );
      }

      // Approval is only ever as good as the rendered-frame evidence attached
      // to these exact sources; nothing else may stand in for it.
      const approvalSources = await motionCanvasWorkspace.readSceneSources(
        currentProject.id,
        motionCanvasBundle,
      );
      assertVisualValidationCurrent(motionCanvasBundle, approvalSources);
      if (
        motionCanvasBundle.semanticValidation &&
        (!semanticValidationIsCurrent(motionCanvasBundle.semanticValidation, approvalSources) ||
          motionCanvasBundle.semanticValidation.status === 'failed')
      ) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_SEMANTIC_VALIDATION_REQUIRED',
          'Scene chưa bao phủ đủ các yêu cầu bắt buộc của kế hoạch hình ảnh hiện hành. Hãy sinh hoặc sửa lại scene trước khi chốt.',
        );
      }
      if (
        motionCanvasBundle.semanticValidation?.status === 'degraded' &&
        !parsedApproval.data.acceptDegradedSemantic
      ) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_DEGRADED_CONFIRMATION_REQUIRED',
          'Scene đang dùng minh họa giản lược. Hãy kiểm tra và xác nhận rõ trước khi tiếp tục.',
        );
      }

      const approvedBundle: MotionCanvasBundle = {
        ...motionCanvasBundle,
        status: 'approved',
      };
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {
          motionCanvasBundle: approvedBundle,
        },
        expectedRevision,
      );

      if (!updatedProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }

      await motionCanvasHistoryStore
        .ensureVersion(
          {
            projectId: updatedProject.id,
            origin: 'approval',
            label: 'Đã chốt Motion Canvas',
            parentVersionId: null,
            restoredFromVersionId: null,
            candidateId: null,
            projectRevision: updatedProject.revision,
            contentHash: hashMotionCanvasBundle(approvedBundle),
            artifact: approvedBundle,
          },
          {force: true},
        )
        .catch(error => logger.error(error));

      sendProject(response, 200, updatedProject);
      return true;
    }

    return false;
  };
}
