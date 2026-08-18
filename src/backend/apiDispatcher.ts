import type {IncomingMessage, ServerResponse} from 'node:http';
import {createAnimationSyncRouteHandler} from './animationSyncRoutes.ts';
import type {AppContext} from './appContext.ts';
import {handleAppError, sendApiError} from './appErrors.ts';
import {serveFrontend} from './frontendStatic.ts';
import {createMotionCanvasHistoryRouteHandler} from './motionCanvasHistoryRoutes.ts';
import {createMotionCanvasRouteHandler} from './motionCanvasRoutes.ts';
import {createNarrationRouteHandler} from './narrationRoutes.ts';
import {createProductionRouteHandler} from './productionRoutes.ts';
import {createProjectCrudRouteHandler} from './projectCrudRoutes.ts';
import {createPronunciationRouteHandler} from './pronunciationRoutes.ts';
import {createRenderRouteHandler} from './renderRoutes.ts';
import {createSystemRouteHandler} from './systemRoutes.ts';
import {createVoiceRouteHandler} from './voiceRoutes.ts';
export function createApiRequestHandler(context: AppContext) {
  const {
    animationSyncGenerations,
    animationSyncPreviewService,
    animationSyncWorkspace,
    codexConnection,
    commitFinalRenderBundle,
    credentialStore,
    elevenLabsConnection,
    elevenLabsConnectionFactory,
    elevenLabsVoiceService,
    finalRenderService,
    frontendDirectory,
    generateOnce,
    layoutPreviewService,
    layoutWorkspace,
    logger,
    motionCanvasCandidateGenerations,
    motionCanvasGenerations,
    motionCanvasGenerator,
    motionCanvasHistoryStore,
    motionCanvasRevisionReviewService,
    motionCanvasWorkspace,
    narrationDraftGenerations,
    narrationDraftGenerator,
    pronunciationAuditService,
    pronunciationRuleStore,
    repository,
    runtimeDiagnostics,
    storedElevenLabsApiKey,
    trackFinalRenderCommit,
    voiceGenerations,
    voiceSectionGenerations,
    voiceWorkspace,
    watermarkAssetStore,
  } = context;

  const handlers = [
    createSystemRouteHandler({
      runtimeDiagnostics,
      codexConnection,
      elevenLabsConnection,
      credentialStore,
      elevenLabsConnectionFactory,
      elevenLabsVoiceService,
      repository,
      narrationDraftGenerator,
      narrationDraftGenerations,
      generateOnce,
    }),
    createProjectCrudRouteHandler({repository}),
    createMotionCanvasHistoryRouteHandler({
      repository,
      motionCanvasHistoryStore,
      motionCanvasWorkspace,
      layoutPreviewService,
      motionCanvasCandidateGenerations,
      motionCanvasGenerator,
      motionCanvasRevisionReviewService,
      generateOnce,
      logger,
    }),
    createMotionCanvasRouteHandler({
      repository,
      motionCanvasGenerator,
      motionCanvasWorkspace,
      motionCanvasHistoryStore,
      motionCanvasGenerations,
      layoutPreviewService,
      generateOnce,
      logger,
    }),
    createVoiceRouteHandler({
      repository,
      elevenLabsVoiceService,
      voiceWorkspace,
      voiceGenerations,
      voiceSectionGenerations,
      generateOnce,
      storedElevenLabsApiKey,
      logger,
    }),
    createAnimationSyncRouteHandler({
      repository,
      animationSyncWorkspace,
      animationSyncPreviewService,
      animationSyncGenerations,
      generateOnce,
    }),
    createRenderRouteHandler({
      repository,
      watermarkAssetStore,
      finalRenderService,
      trackFinalRenderCommit,
      commitFinalRenderBundle,
      logger,
    }),
    createPronunciationRouteHandler({pronunciationRuleStore}),
    createNarrationRouteHandler({
      repository,
      pronunciationAuditService,
      pronunciationRuleStore,
    }),
    createProductionRouteHandler({repository, layoutWorkspace}),
  ];

  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      for (const handler of handlers) {
        if (await handler(request, response, requestUrl)) return;
      }

      if (requestUrl.pathname.startsWith('/api/')) {
        sendApiError(response, 404, {
          code: 'NOT_FOUND',
          message: 'API không tồn tại.',
        });
        return;
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        await serveFrontend(request, response, frontendDirectory);
        return;
      }

      sendApiError(response, 405, {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Phương thức không được hỗ trợ.',
      });
    } catch (error) {
      handleAppError(error, response, logger);
    }
  };
}




