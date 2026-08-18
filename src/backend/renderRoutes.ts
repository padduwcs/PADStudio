import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  finalRenderIsReady,
  finalRenderPrerequisitesAreReady
} from '../shared/projectPipeline.ts';
import {
  GenerateFinalRenderSchema
} from '../shared/topic.ts';
import {defaultVideoFrame} from '../shared/videoFormat.ts';
import {
  FinalRenderError
} from './finalRenderService.ts';
import {
  ProjectConflictError
} from './projectRepository.ts';
import {
  getProjectRenderRoute
} from './projectRoutes.ts';

import type {AppContext} from './appContext.ts';
import {RequestBodyError, sendApiError} from './appErrors.ts';
import {readBinaryBody, readExpectedRevision, readJsonBody, sendJson, sendMediaBuffer, sendMediaFile, validationFields} from './httpTransport.ts';
const MAX_WATERMARK_IMAGE_SIZE = 5 * 1024 * 1024;

import type {ApiRouteHandler} from './routeTypes.ts';

type RenderRouteContext = Pick<AppContext, 'repository' | 'watermarkAssetStore' | 'finalRenderService' | 'trackFinalRenderCommit' | 'commitFinalRenderBundle' | 'logger'>;

export function createRenderRouteHandler(context: RenderRouteContext): ApiRouteHandler {
  const {repository, watermarkAssetStore, finalRenderService, trackFinalRenderCommit, commitFinalRenderBundle, logger} = context;
  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    const renderRoute = getProjectRenderRoute(requestUrl.pathname);

    if (
      renderRoute?.action === 'watermark' &&
      request.method === 'GET'
    ) {
      const currentProject = await repository.getProject(renderRoute.projectId);
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const assetId = requestUrl.searchParams.get('asset') ?? '';
      const asset = await watermarkAssetStore.read(
        currentProject.id,
        assetId,
      );
      sendMediaBuffer(
        request,
        response,
        asset.value,
        asset.summary.contentType,
        {
          'Cache-Control': 'private, max-age=31536000, immutable',
          ETag: `"${asset.summary.assetId}"`,
        },
      );
      return true;
    }

    if (
      renderRoute?.action === 'watermark' &&
      request.method === 'POST'
    ) {
      const currentProject = await repository.getProject(renderRoute.projectId);
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const value = await readBinaryBody(request, MAX_WATERMARK_IMAGE_SIZE);
      const asset = await watermarkAssetStore.save(currentProject.id, value);
      response.setHeader('Cache-Control', 'no-store');
      sendJson(response, 201, {asset});
      return true;
    }

    if (
      renderRoute?.action === 'generate' &&
      request.method === 'POST'
    ) {
      const expectedRevision = readExpectedRevision(request);
      const body = await readJsonBody(request);
      const parsedRequest = GenerateFinalRenderSchema.safeParse(body);
      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu render video cuối chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }
      const currentProject = await repository.getProject(
        renderRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const generationId = parsedRequest.data.generationId;
      const existingRender = currentProject.renderBundle;
      if (
        existingRender?.generation.generationId === generationId &&
        finalRenderIsReady(currentProject)
      ) {
        const existingStatus =
          (await finalRenderService.getStatus(
            currentProject.id,
            generationId,
          )) ?? {
            generationId,
            state: 'completed' as const,
            progress: 1,
            renderedFrames:
              existingRender.validation.renderedFrameCount,
            totalFrames: existingRender.validation.renderedFrameCount,
            startedAt: existingRender.generation.generatedAt,
            updatedAt: existingRender.generation.generatedAt,
            message: 'Video cuối đã sẵn sàng.',
            errorCode: null,
            diagnostic: null,
          };
        sendJson(response, 200, {status: existingStatus});
        return true;
      }
      if (existingRender?.generation.generationId === generationId) {
        throw new RequestBodyError(
          409,
          'GENERATION_ID_REUSED',
          'Render generation ID đã thuộc về một Layout cũ. Hãy tạo generation mới từ Layout hiện hành.',
        );
      }
      if (currentProject.revision !== expectedRevision) {
        throw new ProjectConflictError(currentProject);
      }
      const sync = currentProject.animationSyncBundle;
      const layout = currentProject.layoutBundle;
      if (
        !sync ||
        !layout ||
        !finalRenderPrerequisitesAreReady(currentProject)
      ) {
        throw new RequestBodyError(
          409,
          'FINAL_RENDER_PREREQUISITES_NOT_APPROVED',
          'Hãy duyệt Layout hiện hành trước khi render video cuối.',
        );
      }
      const renderOperation = finalRenderService.render(
        currentProject.id,
        generationId,
        (existingRender?.contentRevision ?? 0) + 1,
        sync,
        layout,
        currentProject.renderProfile ?? {
          frame: currentProject.topicInput.videoFrame ?? defaultVideoFrame,
          quality: 'standard',
        },
        currentProject.topicInput.background.color,
      );
      const commitOperation = renderOperation
        .then(async renderBundle => {
          const committed = await commitFinalRenderBundle(
            currentProject.id,
            generationId,
            renderBundle,
          );
          if (!committed) {
            logger.error(
              new FinalRenderError(
                'FINAL_RENDER_SOURCE_CHANGED',
                'Video đã dựng xong nhưng Layout hiện hành đã thay đổi; artifact được giữ riêng và không ghi đè project.',
              ),
            );
          }
        })
        .catch(error => {
          if (!(error instanceof FinalRenderError)) logger.error(error);
        });
      trackFinalRenderCommit(commitOperation);
      const status = await finalRenderService.getStatus(
        currentProject.id,
        generationId,
      );
      if (!status) {
        throw new FinalRenderError(
          'FINAL_RENDER_START_FAILED',
          'Không thể ghi nhận job render vừa tạo.',
        );
      }
      sendJson(response, 202, {status});
      return true;
    }

    if (
      renderRoute?.action === 'status' &&
      request.method === 'GET'
    ) {
      const currentProject = await repository.getProject(
        renderRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const generationId =
        requestUrl.searchParams.get('generationId') ?? undefined;
      const status = await finalRenderService.getStatus(
        currentProject.id,
        generationId,
      );
      if (
        status?.state === 'completed' &&
        currentProject.renderBundle?.generation.generationId !==
        status.generationId
      ) {
        const completedBundle = await finalRenderService.getCompletedBundle(
          currentProject.id,
          status.generationId,
        );
        if (completedBundle) {
          await commitFinalRenderBundle(
            currentProject.id,
            status.generationId,
            completedBundle,
          );
        }
      }
      sendJson(response, 200, {status});
      return true;
    }

    if (
      renderRoute?.action === 'video' &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      const currentProject = await repository.getProject(
        renderRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      if (!currentProject.renderBundle || !finalRenderIsReady(currentProject)) {
        throw new RequestBodyError(
          409,
          'FINAL_RENDER_NOT_READY',
          'Video cuối chưa sẵn sàng hoặc đã cũ so với Layout hiện hành.',
        );
      }
      const video = await finalRenderService.resolveVideo(
        currentProject.id,
        currentProject.renderBundle,
      );
      sendMediaFile(
        request,
        response,
        video.filePath,
        video.size,
        'video/mp4',
        {
          'Cache-Control': 'private, no-cache',
          'Content-Disposition': `inline; filename="${currentProject.id}.mp4"`,
          ETag: `"${currentProject.renderBundle.validation.videoHash}"`,
        },
      );
      return true;
    }

    return false;
  };
}

