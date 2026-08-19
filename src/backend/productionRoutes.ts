import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {z} from 'zod';
import {
  defaultLayoutRenderSettings,
  LayoutBundleSchema,
  LayoutRenderSettingsSchema,
  type LayoutEditorManifest
} from '../shared/layout.ts';
import {
  animationSyncPrerequisitesAreReady,
  layoutMatchesAnimationSync,
  sameValue,
  visualDesignMatchesMotion
} from '../shared/projectPipeline.ts';
import {defaultVideoFrame} from '../shared/videoFormat.ts';
import {CodexReasoningEffortSchema} from '../shared/topic.ts';
import {
  retimeLayoutOverridesForSync
} from './layoutWorkspace.ts';
import {hashJson} from './motionCanvasHistoryStore.ts';
import {
  DEFAULT_TIMING_CALIBRATION,
  narrationArtifactsAreCurrent,
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
const PrepareNarrationProductionSchema = z.object({generationId: z.string().uuid(), renderSettings: LayoutRenderSettingsSchema.optional(), plannerModel: z.string().trim().min(1).max(160).optional(), plannerReasoningEffort: CodexReasoningEffortSchema.optional()}).strict();

import type {ApiRouteHandler} from './routeTypes.ts';

type ProductionRouteContext = Pick<AppContext, 'repository' | 'layoutWorkspace' | 'narrationVisualPlanner' | 'narrationPlanGenerations' | 'generateOnce'>;

export function createProductionRouteHandler(context: ProductionRouteContext): ApiRouteHandler {
  const {repository, layoutWorkspace, narrationVisualPlanner, narrationPlanGenerations, generateOnce} = context;
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

    if (productionRoute?.action === 'output' && request.method === 'POST') {
      const expectedRevision = readExpectedRevision(request);
      const parsed = PrepareNarrationProductionSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu chuẩn bị đầu ra chưa hợp lệ.',
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
      const sync = currentProject.animationSyncBundle;
      const renderSettings =
        parsed.data.renderSettings ?? defaultLayoutRenderSettings;
      if (!narrationArtifactsAreCurrent(currentProject.outline, currentProject.voiceVisualPlan) ||
        !sync || sync.status !== 'approved' ||
        !animationSyncPrerequisitesAreReady(currentProject)) {
        throw new RequestBodyError(
          409,
          'OUTPUT_PREREQUISITES_NOT_APPROVED',
          'Hãy chốt scene và hoàn tất đồng bộ audio trước khi chuẩn bị đầu ra.',
        );
      }
      if (currentProject.layoutBundle?.status === 'approved' &&
        layoutMatchesAnimationSync(currentProject.layoutBundle, sync)) {
        if (!sameValue(currentProject.layoutBundle.renderSettings, renderSettings)) {
          if (currentProject.revision !== expectedRevision) {
            throw new ProjectConflictError(currentProject);
          }
          const project = await repository.updateProject(
            currentProject.id,
            {
              layoutBundle: {
                ...currentProject.layoutBundle,
                renderSettings,
              },
            },
            expectedRevision,
          );
          if (!project) throw new Error('Project vừa biến mất khi lưu watermark.');
          sendProject(response, 200, project);
          return true;
        }
        sendProject(response, 200, currentProject);
        return true;
      }
      if (currentProject.revision !== expectedRevision) {
        throw new ProjectConflictError(currentProject);
      }
      const generationId = parsed.data.generationId.toLowerCase();
      const visualOverrides =
        currentProject.motionCanvasBundle &&
          currentProject.visualDesignBundle &&
          visualDesignMatchesMotion(
            currentProject.visualDesignBundle,
            currentProject.motionCanvasBundle,
          )
          ? retimeLayoutOverridesForSync(
            currentProject.visualDesignBundle.overrides,
            sync.sections,
          )
          : [];
      // The direct scene editor has already validated these saved changes
      // against the live Motion Canvas preview. Preserve that verified node
      // identity when creating the immutable export workspace.
      const editorManifest: LayoutEditorManifest = {
        version: 1,
        sourceAnimationSyncGenerationId: sync.generation.generationId,
        sourceAnimationSyncContentRevision: sync.contentRevision,
        sourceAnimationSyncSourceHash: sync.validation.sourceHash,
        scenes: sync.sections.map(section => ({
          sceneId: section.sceneId,
          filePath: section.filePath,
          nodes: visualOverrides
            .filter(override => override.sceneId === section.sceneId)
            .map(override => ({
              key: override.nodeKey,
              fingerprint: override.nodeFingerprint,
              label: 'Chỉnh sửa hình đã lưu',
              nodeType: 'Layout',
              parentKey: null,
              identity: 'semantic' as const,
              editableProperties: [
                'x',
                'y',
                'scale',
                'rotation',
                'opacity',
                'hidden',
                'fill',
                'stroke',
                'strokeWidth',
                'zIndexDelta',
                'text',
                'fontFamily',
                'fontSize',
                'fontWeight',
                'fontStyle',
                'underline',
                'strikethrough',
              ],
              lockedProperties: [],
              lockReason: null,
            })),
        })),
      };
      const prepared = await layoutWorkspace.prepare(
        currentProject.id,
        generationId,
        sync,
        visualOverrides,
        editorManifest,
        currentProject.layoutBundle?.generation.generationId ?? null,
      );
      const layoutBundle = LayoutBundleSchema.parse({
        status: 'approved',
        contentRevision: (currentProject.layoutBundle?.contentRevision ?? 0) + 1,
        sourceAnimationSyncContentRevision: sync.contentRevision,
        sourceAnimationSyncGenerationId: sync.generation.generationId,
        sourceAnimationSyncSourceHash: sync.validation.sourceHash,
        workspacePath: prepared.workspacePath,
        sourceWorkspacePath: prepared.sourceWorkspacePath,
        projectFile: prepared.projectFile,
        audioFile: prepared.audioFile,
        overridesFile: prepared.overridesFile,
        manifestFile: prepared.manifestFile,
        overrideContractVersion: prepared.overrideContractVersion,
        renderSettings,
        totalDurationSeconds: prepared.totalDurationSeconds,
        scenes: prepared.scenes,
        validation: prepared.validation,
        generation: {
          generationId,
          provider: 'local',
          tool: 'layout-editor',
          generatedAt: prepared.validation.validatedAt,
        },
      });
      await layoutWorkspace.verify(currentProject.id, sync, layoutBundle);
      const renderProfile = currentProject.renderProfile ?? {
        frame: currentProject.topicInput.videoFrame ?? defaultVideoFrame,
        quality: 'standard' as const,
      };
      const project = await repository.updateProject(
        currentProject.id,
        {layoutBundle, renderProfile},
        expectedRevision,
      );
      if (!project) throw new Error('Project vừa biến mất khi chuẩn bị đầu ra.');
      sendProject(response, 200, project);
      return true;
    }

    return false;
  };
}

