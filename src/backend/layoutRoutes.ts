import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  ApproveLayoutSchema,
  CommitLayoutSchema,
  LayoutBundleSchema,
} from '../shared/layout.ts';
import {
  layoutIsCurrent,
  layoutMatchesAnimationSync,
  layoutPrerequisitesAreReady,
} from '../shared/projectPipeline.ts';
import {
  validateLayoutDocuments,
  LayoutWorkspaceError,
  type LayoutFailureArtifactStatus,
  type LayoutFailureRecord,
} from './layoutWorkspace.ts';
import {LayoutPreviewError} from './layoutPreviewService.ts';
import {
  ProjectConflictError,
} from './projectRepository.ts';
import {
  getProjectLayoutRoute,
} from './projectRoutes.ts';

import type {AppContext} from './appContext.ts';
import {RequestBodyError, sendApiError} from './appErrors.ts';
import {
  readExpectedRevision,
  readJsonBody,
  requestParentOrigin,
  sendJson,
  sendProject,
  validationFields,
} from './httpTransport.ts';
import type {ApiRouteHandler} from './routeTypes.ts';

type LayoutRouteContext = Pick<
  AppContext,
  'repository' | 'layoutWorkspace' | 'layoutPreviewService'
>;

async function retainLayoutFailure(
  layoutWorkspace: LayoutRouteContext['layoutWorkspace'],
  projectId: string,
  generationId: string,
  sourceSyncGenerationId: string,
  error: unknown,
  artifactStatus: LayoutFailureArtifactStatus,
) {
  if (
    !(error instanceof LayoutPreviewError) &&
    !(error instanceof LayoutWorkspaceError)
  ) {
    return;
  }
  const diagnostic = error.diagnostic ?? {
    stage: 'layout-design' as const,
    status: 'failed' as const,
    artifactPath: null,
    artifactStatus,
    sourceSyncGenerationId,
    details: {operation: 'layout-design'},
  };
  const failure: LayoutFailureRecord = {
    stage: diagnostic.stage,
    status: diagnostic.status,
    code: error.code,
    message: error.message,
    diagnostic: {
      ...diagnostic,
      artifactPath: null,
      artifactStatus,
      sourceSyncGenerationId,
    },
    artifact: {
      status: artifactStatus,
      workspacePath:
        artifactStatus === 'workspace-created'
          ? `layout/generations/${generationId}`
          : null,
    },
  };
  if (!layoutWorkspace.recordFailure) return;
  try {
    const artifactPath = await layoutWorkspace.recordFailure(
      projectId,
      generationId,
      failure,
    );
    error.diagnostic = {
      ...failure.diagnostic,
      artifactPath,
    };
  } catch {
    // Preserve the original downstream failure if artifact retention itself fails.
  }
}

export function createLayoutRouteHandler(
  context: LayoutRouteContext,
): ApiRouteHandler {
  const {repository, layoutWorkspace, layoutPreviewService} = context;
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ) => {
    const layoutRoute = getProjectLayoutRoute(requestUrl.pathname);

    if (layoutRoute?.action === 'preview' && request.method === 'GET') {
      const currentProject = await repository.getProject(
        layoutRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const sync = currentProject.animationSyncBundle;
      if (!sync || !layoutPrerequisitesAreReady(currentProject)) {
        throw new RequestBodyError(
          409,
          'LAYOUT_PREREQUISITES_NOT_APPROVED',
          'Hãy chốt scene và hoàn tất đồng bộ audio trước khi chỉnh.',
        );
      }
      const existingLayout =
        currentProject.layoutBundle &&
          layoutMatchesAnimationSync(currentProject.layoutBundle, sync)
          ? currentProject.layoutBundle
          : null;
      const initialOverrides = existingLayout
        ? (
          await layoutWorkspace.readOverrides(
            currentProject.id,
            existingLayout,
          )
        ).overrides
        : [];
      const preview = await layoutPreviewService.start(
        currentProject.id,
        sync,
        existingLayout,
        {
          parentOrigin: requestParentOrigin(request),
          initialOverrides,
        },
      );
      response.setHeader('Cache-Control', 'no-store');
      sendJson(response, 200, {preview});
      return true;
    }

    if (layoutRoute?.action === 'design' && request.method === 'PUT') {
      const expectedRevision = readExpectedRevision(request);
      const body = await readJsonBody(request);
      const parsedRequest = CommitLayoutSchema.safeParse(body);
      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Chỉnh sửa scene chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }
      const currentProject = await repository.getProject(
        layoutRoute.projectId,
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
      const sync = currentProject.animationSyncBundle;
      if (!sync || !layoutPrerequisitesAreReady(currentProject)) {
        throw new RequestBodyError(
          409,
          'LAYOUT_PREREQUISITES_NOT_APPROVED',
          'Hãy chốt scene và hoàn tất đồng bộ audio trước khi chỉnh.',
        );
      }
      if (
        sync.generation.generationId !==
        parsedRequest.data.sourceAnimationSyncGenerationId
      ) {
        throw new RequestBodyError(
          409,
          'LAYOUT_PREVIEW_OUTDATED',
          'Bản đồng bộ đã thay đổi. Hãy tải lại editor.',
        );
      }
      const generationId = parsedRequest.data.generationId.toLowerCase();
      let artifactStatus: LayoutFailureArtifactStatus = 'not-created';
      try {
        const manifest = await layoutPreviewService.waitForManifest(
          currentProject.id,
          parsedRequest.data.sessionNonce,
          sync.generation.generationId,
        );
        const documents = validateLayoutDocuments(
          sync,
          parsedRequest.data.overrides,
          manifest,
        );
        const currentLayout =
          currentProject.layoutBundle &&
            layoutMatchesAnimationSync(currentProject.layoutBundle, sync)
            ? currentProject.layoutBundle
            : null;
      const prepared = await layoutWorkspace.prepare(
        currentProject.id,
        generationId,
        sync,
        documents.overridesDocument.overrides,
        manifest,
        parsedRequest.data.baseGenerationId?.toLowerCase() ??
          currentLayout?.generation.generationId ??
          null,
      );
      artifactStatus = 'workspace-created';
      const layoutBundle = LayoutBundleSchema.parse({
        status: 'draft',
        contentRevision: (currentLayout?.contentRevision ?? 0) + 1,
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
        renderSettings: parsedRequest.data.renderSettings,
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
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {layoutBundle},
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
      } catch (error) {
        await retainLayoutFailure(
          layoutWorkspace,
          currentProject.id,
          generationId,
          sync.generation.generationId,
          error,
          artifactStatus,
        );
        throw error;
      }
    }

    if (layoutRoute?.action === 'approve' && request.method === 'POST') {
      const expectedRevision = readExpectedRevision(request);
      const body = await readJsonBody(request);
      const parsedRequest = ApproveLayoutSchema.safeParse(body);
      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu duyệt scene chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }
      const currentProject = await repository.getProject(
        layoutRoute.projectId,
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
      const layout = currentProject.layoutBundle;
      if (
        !layout ||
        !layoutIsCurrent(currentProject) ||
        layout.generation.generationId !== parsedRequest.data.generationId
      ) {
        throw new RequestBodyError(
          409,
          'LAYOUT_OUTDATED',
          'Bản chỉnh sửa chưa có hoặc không còn khớp với bản đồng bộ hiện tại. Hãy mở lại editor.',
        );
      }
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {layoutBundle: {...layout, status: 'approved'}},
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
