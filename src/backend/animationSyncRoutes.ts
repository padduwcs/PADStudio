import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  animationSyncPrerequisitesAreReady,
  motionCanvasMatchesOutline,
  sameValue,
  voiceVisualMatchesOutline
} from '../shared/projectPipeline.ts';
import {
  GenerateAnimationSyncSchema,
  type AnimationSyncBundle
} from '../shared/topic.ts';
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
import {readExpectedRevision, readJsonBody, sendProject, validationFields} from './httpTransport.ts';
import type {ApiRouteHandler} from './routeTypes.ts';

type AnimationSyncRouteContext = Pick<AppContext, 'repository' | 'animationSyncWorkspace' | 'animationSyncGenerations' | 'generateOnce'>;

export function createAnimationSyncRouteHandler(context: AnimationSyncRouteContext): ApiRouteHandler {
  const {repository, animationSyncWorkspace, animationSyncGenerations, generateOnce} = context;
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
      const fingerprint = JSON.stringify({
        motionContentRevision: motion.contentRevision,
        motionSourceHash: motion.validation.sourceHash,
        voiceContentRevision: voice.contentRevision,
        voiceGenerationId: voice.generation.generationId,
        voiceSections: voice.sections,
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
        !animationSyncMatchesSources(bundle, motion, voice)
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

