import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  animationSyncPrerequisitesAreReady,
  motionCanvasMatchesOutline,
  sameValue,
  visualDesignMatchesMotion,
  voiceVisualMatchesOutline
} from '../shared/projectPipeline.ts';
import {
  GenerateAnimationSyncSchema,
  type AnimationSyncBundle
} from '../shared/topic.ts';
import {
  retimeLayoutOverridesForSync
} from './layoutWorkspace.ts';
import {
  animationSyncMatchesSources,
  voiceMatchesPlan,
} from './projectConsistency.ts';
import {
  ProjectConflictError
} from './projectRepository.ts';
import {
  getProjectAnimationSyncRoute
} from './projectRoutes.ts';

import type {AppContext} from './appContext.ts';
import {RequestBodyError, sendApiError} from './appErrors.ts';
import {readExpectedRevision, readJsonBody, sendJson, sendProject, validationFields} from './httpTransport.ts';
import type {ApiRouteHandler} from './routeTypes.ts';

type AnimationSyncRouteContext = Pick<AppContext, 'repository' | 'animationSyncWorkspace' | 'animationSyncPreviewService' | 'animationSyncGenerations' | 'generateOnce'>;

export function createAnimationSyncRouteHandler(context: AnimationSyncRouteContext): ApiRouteHandler {
  const {repository, animationSyncWorkspace, animationSyncPreviewService, animationSyncGenerations, generateOnce} = context;
  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    const animationSyncRoute = getProjectAnimationSyncRoute(
      requestUrl.pathname,
    );

    if (
      animationSyncRoute?.action === 'generate' &&
      request.method === 'POST'
    ) {
      const expectedRevision = readExpectedRevision(request);
      const body = await readJsonBody(request);
      const parsedRequest = GenerateAnimationSyncSchema.safeParse(body);
      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu đồng bộ animation chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }
      const generationId = parsedRequest.data.generationId.toLowerCase();
      const currentProject = await repository.getProject(
        animationSyncRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      if (
        currentProject.animationSyncBundle?.generation.generationId ===
        generationId
      ) {
        sendProject(response, 200, currentProject);
        return true;
      }
      if (currentProject.revision !== expectedRevision) {
        throw new ProjectConflictError(currentProject);
      }

      const outline = currentProject.outline;
      const plan = currentProject.voiceVisualPlan;
      const motion = currentProject.motionCanvasBundle;
      const voice = currentProject.voiceBundle;
      if (
        !outline ||
        outline.status !== 'approved' ||
        !plan ||
        plan.status !== 'approved' ||
        !motion ||
        motion.status !== 'approved' ||
        !voice ||
        voice.status !== 'approved' ||
        !sameValue(outline.sourceInput, currentProject.topicInput) ||
        plan.sourceOutlineContentRevision !== outline.contentRevision ||
        motion.sourceVoiceVisualContentRevision !==
        plan.contentRevision ||
        !voiceVisualMatchesOutline(plan, outline) ||
        !motionCanvasMatchesOutline(motion, outline) ||
        !voiceMatchesPlan(voice, plan)
      ) {
        throw new RequestBodyError(
          409,
          'ANIMATION_SYNC_PREREQUISITES_NOT_APPROVED',
          'Hãy chốt Motion Canvas và voice hiện tại trước khi đồng bộ.',
        );
      }
      if (motion.timingContractVersion !== 1) {
        throw new RequestBodyError(
          409,
          'ANIMATION_SYNC_TIMING_CONTRACT_REQUIRED',
          'Scene hiện tại là bản legacy. Hãy sinh lại và chốt Motion Canvas trước khi đồng bộ.',
        );
      }

      const generationKey = `${currentProject.id}:${generationId}`;
      const visualDesign =
        currentProject.visualDesignBundle &&
          visualDesignMatchesMotion(
            currentProject.visualDesignBundle,
            motion,
          )
          ? currentProject.visualDesignBundle
          : null;
      const fingerprint = JSON.stringify({
        motionContentRevision: motion.contentRevision,
        motionSourceHash: motion.validation.sourceHash,
        voiceContentRevision: voice.contentRevision,
        voiceGenerationId: voice.generation.generationId,
        voiceSections: voice.sections,
        visualDesignContentRevision: visualDesign?.contentRevision ?? null,
        visualDesignOverrides: visualDesign?.overrides ?? [],
      });
      const generation = await generateOnce(
        animationSyncGenerations,
        generationKey,
        fingerprint,
        () =>
          animationSyncWorkspace.prepare(
            currentProject.id,
            generationId,
            motion,
            voice,
          ),
      );
      const prepared = generation.result;
      const animationSyncBundle: AnimationSyncBundle = {
        status: 'draft',
        contentRevision:
          (currentProject.animationSyncBundle?.contentRevision ?? 0) + 1,
        sourceMotionCanvasContentRevision: motion.contentRevision,
        sourceVoiceContentRevision: voice.contentRevision,
        sourceVisualDesignContentRevision:
          visualDesign?.contentRevision ?? null,
        workspacePath: prepared.workspacePath,
        projectFile: prepared.projectFile,
        audioFile: prepared.audioFile,
        totalDurationSeconds: prepared.totalDurationSeconds,
        sections: prepared.sections,
        validation: prepared.validation,
        generation: {
          generationId,
          provider: 'local',
          tool: 'ffmpeg',
          generatedAt: generation.generatedAt,
        },
      };
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {animationSyncBundle},
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
      animationSyncRoute?.action === 'preview' &&
      request.method === 'GET'
    ) {
      const currentProject = await repository.getProject(
        animationSyncRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const bundle = currentProject.animationSyncBundle;
      if (!bundle) {
        throw new RequestBodyError(
          409,
          'ANIMATION_SYNC_NOT_READY',
          'Hãy đồng bộ animation trước khi mở bản nháp.',
        );
      }
      const requestedGeneration =
        requestUrl.searchParams.get('generation');
      if (
        requestedGeneration &&
        requestedGeneration !== bundle.generation.generationId
      ) {
        throw new RequestBodyError(
          404,
          'ANIMATION_SYNC_GENERATION_NOT_FOUND',
          'Generation bản nháp được yêu cầu không còn là bản hiện tại.',
        );
      }
      const previewMotion = currentProject.motionCanvasBundle;
      const previewVoice = currentProject.voiceBundle;
      if (
        !previewMotion ||
        !previewVoice ||
        !animationSyncMatchesSources(
          bundle,
          previewMotion,
          previewVoice,
          currentProject.visualDesignBundle,
        )
      ) {
        throw new RequestBodyError(
          409,
          'ANIMATION_SYNC_OUTDATED',
          'Scene, visual design hoặc voice đã thay đổi. Hãy đồng bộ lại trước khi mở preview.',
        );
      }
      const syncVisualDesign = currentProject.visualDesignBundle;
      const preview = await animationSyncPreviewService.start(
        currentProject.id,
        bundle,
        syncVisualDesign &&
          previewMotion &&
          visualDesignMatchesMotion(syncVisualDesign, previewMotion)
          ? retimeLayoutOverridesForSync(
            syncVisualDesign.overrides,
            bundle.sections,
          )
          : [],
      );
      response.setHeader('Cache-Control', 'no-store');
      sendJson(response, 200, {preview});
      return true;
    }

    if (
      animationSyncRoute?.action === 'approve' &&
      request.method === 'POST'
    ) {
      const expectedRevision = readExpectedRevision(request);
      const currentProject = await repository.getProject(
        animationSyncRoute.projectId,
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
      const motion = currentProject.motionCanvasBundle;
      const voice = currentProject.voiceBundle;
      const bundle = currentProject.animationSyncBundle;
      if (
        !motion ||
        motion.status !== 'approved' ||
        !voice ||
        voice.status !== 'approved' ||
        !bundle ||
        !animationSyncPrerequisitesAreReady(currentProject) ||
        !animationSyncMatchesSources(
          bundle,
          motion,
          voice,
          currentProject.visualDesignBundle,
        )
      ) {
        throw new RequestBodyError(
          409,
          'ANIMATION_SYNC_OUTDATED',
          'Bản đồng bộ chưa có hoặc không còn khớp với scene và voice hiện tại.',
        );
      }
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {
          animationSyncBundle: {...bundle, status: 'approved'},
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
      sendProject(response, 200, updatedProject);
      return true;
    }

    return false;
  };
}

