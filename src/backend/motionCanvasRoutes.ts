import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  CommitVisualDesignSchema
} from '../shared/layout.ts';
import {
  motionCanvasIsStale,
  motionCanvasMatchesOutline,
  sameValue,
  visualDesignMatchesMotion,
  voiceVisualMatchesOutline
} from '../shared/projectPipeline.ts';
import {
  GenerateMotionCanvasSchema,
  type MotionCanvasBundle
} from '../shared/topic.ts';
import {
  validateLayoutDocuments
} from './layoutWorkspace.ts';
import {
  MOTION_CANVAS_PROMPT_VERSION
} from './motionCanvasGenerator.ts';
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

type MotionCanvasRouteContext = Pick<AppContext, 'repository' | 'motionCanvasGenerator' | 'motionCanvasWorkspace' | 'motionCanvasHistoryStore' | 'motionCanvasGenerations' | 'layoutPreviewService' | 'generateOnce' | 'logger'>;

export function createMotionCanvasRouteHandler(context: MotionCanvasRouteContext): ApiRouteHandler {
  const {repository, motionCanvasGenerator, motionCanvasWorkspace, motionCanvasHistoryStore, motionCanvasGenerations, layoutPreviewService, generateOnce, logger} = context;
  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    const motionCanvasRoute = getProjectMotionCanvasRoute(
      requestUrl.pathname,
    );

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
      if (currentBundleUsable) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_CANDIDATE_REQUIRED',
          'Workspace scene đã tồn tại. Hãy chọn scene và tạo candidate để so sánh thay vì ghi đè trực tiếp.',
        );
      }
      if (
        parsedRequest.data.guidance &&
        currentProject.motionCanvasBundle &&
        !currentBundleUsable
      ) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_OUTDATED',
          'Kế hoạch voice–visual đã thay đổi. Hãy sinh lại toàn bộ scene trước khi góp ý.',
        );
      }

      const currentScenes =
        parsedRequest.data.guidance &&
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
        guidance: parsedRequest.data.guidance,
        currentScenes,
      });
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
            topicInput: currentProject.topicInput,
            videoFrame: projectVideoFrame(currentProject),
            outline,
            voiceVisualPlan,
            guidance: parsedRequest.data.guidance,
            currentScenes,
          };
          let generated =
            await motionCanvasGenerator.generate(generationRequest);
          const qualityRetryDiagnostics = generated.qualityRetryDiagnostics ?? [];
          let prepared: PreparedMotionCanvasWorkspace | null = null;
          let repairAttempts = 0;
          let fallbackAttempted = false;
          const generationDiagnostics: NonNullable<MotionCanvasBundle['generationDiagnostics']> = [];
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
          generationDiagnostics.push({stage: 'generate', attempt: 0, reason: 'Source attachment/container/timing policy and workspace/compiler preparation passed.', outcome: 'passed'});
          generationDiagnostics.push(...qualityRetryDiagnostics);
          return {generated, prepared, generationDiagnostics};
        },
      );
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
            label: 'Trước khi sinh lại theo voice–visual mới',
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
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {motionCanvasBundle},
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
      const currentDesign =
        currentProject.visualDesignBundle &&
          visualDesignMatchesMotion(currentProject.visualDesignBundle, motion)
          ? currentProject.visualDesignBundle
          : null;
      const preview = await layoutPreviewService.startMotion(
        currentProject.id,
        motion,
        {
          parentOrigin: requestParentOrigin(request),
          initialOverrides: currentDesign?.overrides ?? [],
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
      motionCanvasRoute?.action === 'design' &&
      request.method === 'PUT'
    ) {
      const expectedRevision = readExpectedRevision(request);
      const body = await readJsonBody(request);
      const parsedRequest = CommitVisualDesignSchema.safeParse(body);
      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Chỉnh sửa visual scene chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }
      const currentProject = await repository.getProject(
        motionCanvasRoute.projectId,
      );
      const motion = currentProject?.motionCanvasBundle;
      if (!currentProject || !motion) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_NOT_READY',
          'Project chưa có scene Motion Canvas để chỉnh sửa.',
        );
      }
      if (currentProject.revision !== expectedRevision) {
        throw new ProjectConflictError(currentProject);
      }
      if (motionCanvasIsStale(currentProject)) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_OUTDATED',
          'Kế hoạch voice–visual đã thay đổi. Hãy sinh lại scene trước khi chỉnh sửa.',
        );
      }
      if (
        motion.generation.generationId !==
        parsedRequest.data.sourceMotionCanvasGenerationId
      ) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_PREVIEW_OUTDATED',
          'Scene Motion Canvas đã thay đổi. Hãy tải lại editor.',
        );
      }
      const manifest = layoutPreviewService.getManifest(
        currentProject.id,
        parsedRequest.data.sessionNonce,
        motion.generation.generationId,
      );
      const documents = validateLayoutDocuments(
        {
          contentRevision: motion.contentRevision,
          generation: {generationId: motion.generation.generationId},
          validation: {sourceHash: motion.validation.sourceHash},
          sections: motion.scenes.map((scene) => ({
            sceneId: scene.id,
            filePath: scene.filePath,
            durationSeconds: scene.durationSeconds,
          })),
        },
        parsedRequest.data.overrides,
        manifest,
      );
      const previousDesign = currentProject.visualDesignBundle;
      const sameSource = Boolean(
        previousDesign && visualDesignMatchesMotion(previousDesign, motion),
      );
      const visualDesignBundle = {
        contentRevision: sameSource
          ? previousDesign!.contentRevision + 1
          : 1,
        sourceMotionCanvasGenerationId: motion.generation.generationId,
        sourceMotionCanvasContentRevision: motion.contentRevision,
        sourceMotionCanvasSourceHash: motion.validation.sourceHash,
        overrides: documents.overridesDocument.overrides,
        updatedAt: new Date().toISOString(),
      };
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {visualDesignBundle, currentStep: 'scenes'},
        expectedRevision,
      );
      if (!updatedProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      sendProject(response, 200, updatedProject);
      return true;
    }

    if (
      motionCanvasRoute?.action === 'approve' &&
      request.method === 'POST'
    ) {
      const expectedRevision = readExpectedRevision(request);
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

