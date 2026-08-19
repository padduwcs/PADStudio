import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {z} from 'zod';
import {CodexReasoningEffortSchema} from '../shared/topic.ts';
import {hashJson} from './motionCanvasHistoryStore.ts';
import {
  DEFAULT_TIMING_CALIBRATION,
  narrationArtifactsMatchReview,
  planNarrationArtifacts
} from './narrationPlan.ts';
import {preferredNarrationCalibration} from './appRouteSupport.ts';
import {
  ProjectConflictError
} from './projectRepository.ts';
import {
  getProjectProductionRoute
} from './projectRoutes.ts';

import type {AppContext} from './appContext.ts';
import {RequestBodyError, sendApiError} from './appErrors.ts';
import {readExpectedRevision, readJsonBody, sendProject, validationFields} from './httpTransport.ts';
const PrepareNarrationProductionSchema = z.object({generationId: z.string().uuid(), plannerModel: z.string().trim().min(1).max(160).optional(), plannerReasoningEffort: CodexReasoningEffortSchema.optional()}).strict();

import type {ApiRouteHandler} from './routeTypes.ts';

type ProductionRouteContext = Pick<AppContext, 'repository' | 'narrationVisualPlanner' | 'narrationPlanGenerations' | 'generateOnce'>;

export function createProductionRouteHandler(context: ProductionRouteContext): ApiRouteHandler {
  const {repository, narrationVisualPlanner, narrationPlanGenerations, generateOnce} = context;
  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    const productionRoute = getProjectProductionRoute(requestUrl.pathname);
    if (productionRoute?.action === 'prepare' && request.method === 'POST') {
      const expectedRevision = readExpectedRevision(request);
      const parsed = PrepareNarrationProductionSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu chuẩn bị sản xuất chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const currentProject = await repository.getProject(productionRoute.projectId);
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      if (narrationArtifactsMatchReview(currentProject)) {
        sendProject(response, 200, currentProject);
        return true;
      }
      if (currentProject.revision !== expectedRevision) {
        throw new ProjectConflictError(currentProject);
      }
      const narration = currentProject.narration;
      if (!narration?.review ||
        narration.approvedSourceHash !== narration.review.sourceHash ||
        !narration.approvedAt) {
        throw new RequestBodyError(
          409,
          'NARRATION_NOT_APPROVED',
          'Hãy duyệt bản cách đọc hiện tại trước khi tạo audio.',
        );
      }
      const generationId = parsed.data.generationId.toLowerCase();
      const planFingerprint = hashJson({
        topicInput: currentProject.topicInput,
        narrationSourceHash: narration.review.sourceHash,
        plannerModel: parsed.data.plannerModel ?? null,
        plannerReasoningEffort: parsed.data.plannerReasoningEffort ?? null,
      });
      let artifacts;
      try {
        const generated = await generateOnce(
          narrationPlanGenerations,
          generationId,
          planFingerprint,
          async () => planNarrationArtifacts({
            planner: narrationVisualPlanner,
            topicInput: currentProject.topicInput,
            narration,
            generationId,
            now: new Date().toISOString(),
            previousPlan: currentProject.voiceVisualPlan,
            model: parsed.data.plannerModel,
            reasoningEffort: parsed.data.plannerReasoningEffort,
            timingCalibration: (await preferredNarrationCalibration(repository)) ?? DEFAULT_TIMING_CALIBRATION,
          }),
        );
        artifacts = generated.result;
      } catch (error) {
        if (error instanceof RequestBodyError) throw error;
        throw new RequestBodyError(
          422,
          'NARRATION_STRUCTURE_INVALID',
          error instanceof Error
            ? error.message
            : 'Không thể chia lời thoại để tạo audio.',
        );
      }
      const project = await repository.updateProject(
        currentProject.id,
        {
          outline: artifacts.outline,
          voiceVisualPlan: artifacts.voiceVisualPlan,
        },
        expectedRevision,
      );
      if (!project) throw new Error('Project vừa biến mất khi chuẩn bị sản xuất.');
      sendProject(response, 200, project);
      return true;
    }

    return false;
  };
}

