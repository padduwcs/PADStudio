import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {
  sameValue,
  voiceVisualMatchesOutline
} from '../shared/projectPipeline.ts';
import {
  GenerateVoiceSchema,
  type VoiceBundle
} from '../shared/topic.ts';
import {
  textEncodingIssue
} from '../shared/vietnameseSpeech.ts';
import {
  ElevenLabsVoiceError
} from './elevenLabsVoiceService.ts';
import {hashJson} from './motionCanvasHistoryStore.ts';
import {
  narrationArtifactsAreCurrent,
  narrationPlanMatchesReviewedNarration
} from './narrationPlan.ts';
import {
  buildNarrationSource,
  splitNarrationSource,
} from './narrationSource.ts';
import {
  ProjectConflictError
} from './projectRepository.ts';
import {
  getProjectVoiceRoute
} from './projectRoutes.ts';

import type {AppContext} from './appContext.ts';
import {RequestBodyError, sendApiError} from './appErrors.ts';
import {readExpectedRevision, readJsonBody, sendMediaBuffer, sendProject, validationFields} from './httpTransport.ts';
import type {ApiRouteHandler} from './routeTypes.ts';

type VoiceRouteContext = Pick<AppContext, 'repository' | 'elevenLabsVoiceService' | 'voiceWorkspace' | 'voiceGenerations' | 'voiceSectionGenerations' | 'generateOnce' | 'storedElevenLabsApiKey' | 'logger'>;

export function createVoiceRouteHandler(context: VoiceRouteContext): ApiRouteHandler {
  const {repository, elevenLabsVoiceService, voiceWorkspace, voiceGenerations, voiceSectionGenerations, generateOnce, storedElevenLabsApiKey, logger} = context;
  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    const voiceRoute = getProjectVoiceRoute(requestUrl.pathname);

    if (
      voiceRoute?.action === 'generate' &&
      request.method === 'POST'
    ) {
      const expectedRevision = readExpectedRevision(request);
      const body = await readJsonBody(request);
      const parsedRequest = GenerateVoiceSchema.safeParse(body);
      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Cấu hình tạo voice chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }
      const generationId = parsedRequest.data.generationId.toLowerCase();
      const currentProject = await repository.getProject(
        voiceRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      if (
        currentProject.voiceBundle?.generation.generationId === generationId
      ) {
        const existingConfiguration = currentProject.voiceBundle.configuration;
        if (
          existingConfiguration.voiceId !== parsedRequest.data.voiceId ||
          existingConfiguration.modelId !== parsedRequest.data.modelId ||
          existingConfiguration.outputFormat !== parsedRequest.data.outputFormat ||
          !sameValue(existingConfiguration.settings, parsedRequest.data.settings) ||
          existingConfiguration.seed !== parsedRequest.data.seed
        ) {
          throw new RequestBodyError(
            409,
            'GENERATION_ID_REUSED',
            'Generation ID đã được dùng với cấu hình voice khác.',
          );
        }
        sendProject(response, 200, currentProject);
        return true;
      }
      if (currentProject.revision !== expectedRevision) {
        throw new ProjectConflictError(currentProject);
      }

      const outline = currentProject.outline;
      const plan = currentProject.voiceVisualPlan;
      const narration = currentProject.narration;
      const narrationArtifacts = narrationArtifactsAreCurrent(outline, plan);
      if (
        !outline ||
        outline.status !== 'approved' ||
        !plan ||
        plan.status !== 'approved' ||
        !sameValue(outline.sourceInput, currentProject.topicInput) ||
        plan.sourceOutlineContentRevision !== outline.contentRevision ||
        !voiceVisualMatchesOutline(plan, outline) ||
        (!narrationArtifacts ||
          !narration?.review ||
          narration.approvedSourceHash !== narration.review.sourceHash ||
          !narration.approvedAt ||
          !narrationPlanMatchesReviewedNarration(narration, plan))
      ) {
        throw new RequestBodyError(
          409,
          'VOICE_PREREQUISITES_NOT_APPROVED',
          'Hãy duyệt cách đọc và chuẩn bị kế hoạch hình ảnh hiện hành trước khi tạo voice.',
        );
      }

      const narrationSource = buildNarrationSource(plan);
      const encodingIssue = textEncodingIssue(narrationSource.text);
      if (encodingIssue) {
        throw new RequestBodyError(
          422,
          'NARRATION_TEXT_ENCODING_INVALID',
          `${encodingIssue} Hãy quay lại bước duyệt cách đọc và sửa lời thoại trước khi tạo audio.`,
        );
      }
      const generationKey = `${currentProject.id}:${generationId}`;
      const fingerprint = JSON.stringify({
        narrationRevision: plan.narrationRevision,
        narrationSource,
        configuration: parsedRequest.data,
      });
      const generation = await generateOnce(
        voiceGenerations,
        generationKey,
        fingerprint,
        async () => {
          // All local tooling must be available before the first paid TTS
          // request. A missing encoder must never be discovered after
          // ElevenLabs has already consumed quota.
          await voiceWorkspace.verifyDependencies?.();
          // A generation can span multiple paid TTS requests. Bind the key
          // once so another tab changing the integration cannot split a
          // narration across two ElevenLabs accounts.
          const generationVoiceService =
            elevenLabsVoiceService.withApiKey
              ? elevenLabsVoiceService.withApiKey(
                (await storedElevenLabsApiKey()) ?? '',
              )
              : elevenLabsVoiceService;
          const resolved =
            await generationVoiceService.resolveConfiguration({
              voiceId: parsedRequest.data.voiceId,
              modelId: parsedRequest.data.modelId,
              outputFormat: parsedRequest.data.outputFormat,
              settings: parsedRequest.data.settings,
              seed: parsedRequest.data.seed,
            });
          const maximumCharacters =
            resolved.model.maximumTextLengthPerRequest;
          let sourceChunks;
          try {
            sourceChunks = splitNarrationSource(
              narrationSource,
              maximumCharacters,
            );
          } catch (error) {
            throw new RequestBodyError(
              422,
              'VOICE_BEAT_TOO_LONG',
              error instanceof Error
                ? error.message
                : 'Một beat narration vượt giới hạn của model đã chọn.',
            );
          }

          const generatedChunks = [];
          const previousRequestIds: string[] = [];
          for (const [index, chunk] of sourceChunks.entries()) {
            const chunkRequest = {
              voiceId: resolved.configuration.voiceId,
              modelId: resolved.configuration.modelId,
              outputFormat: resolved.configuration.outputFormat,
              text: chunk.text,
              settings: resolved.configuration.settings,
              seed: resolved.configuration.seed,
              canUseStyle: resolved.model.canUseStyle,
              canUseSpeakerBoost:
                resolved.model.canUseSpeakerBoost,
              ...(resolved.configuration.modelId === 'eleven_v3'
                ? {}
                : {
                  previousText:
                    Array.from(narrationSource.text)
                      .slice(
                        Math.max(0, chunk.textStartIndex - 1_000),
                        chunk.textStartIndex,
                      )
                      .join(''),
                  nextText:
                    Array.from(narrationSource.text)
                      .slice(
                        chunk.textEndIndex,
                        chunk.textEndIndex + 1_000,
                      )
                      .join(''),
                  previousRequestIds: [...previousRequestIds],
                }),
            };
            const chunkFingerprint = hashJson({
              chunk,
              request: chunkRequest,
            });
            let completedChunk =
              await voiceWorkspace.readGenerationChunk?.(
                currentProject.id,
                generationId,
                index,
                chunkFingerprint,
              ) ?? null;
            if (!completedChunk) {
              const chunkGeneration = await generateOnce(
                voiceSectionGenerations,
                `${generationKey}:chunk:${index + 1}`,
                JSON.stringify(chunkRequest),
                () =>
                  generationVoiceService.generateSection(chunkRequest),
                (error) =>
                  error instanceof ElevenLabsVoiceError &&
                  error.code === 'ELEVENLABS_TTS_RESULT_UNKNOWN',
                pipelineSafetyLimits.maximumVoiceChunks * 2,
              );
              completedChunk = {
                ...chunk,
                outputFormat: resolved.configuration.outputFormat,
                generated: chunkGeneration.result,
              };
              await voiceWorkspace.saveGenerationChunk?.(
                currentProject.id,
                generationId,
                index,
                chunkFingerprint,
                completedChunk,
              );
            }
            if (completedChunk.generated.requestId) {
              previousRequestIds.push(
                completedChunk.generated.requestId,
              );
            }
            generatedChunks.push(completedChunk);
          }
          const prepared = await voiceWorkspace.prepare(
            currentProject.id,
            generationId,
            {
              ...narrationSource,
              chunks: generatedChunks,
            },
          );
          const chunkKeyPrefix = `${generationKey}:chunk:`;
          voiceSectionGenerations.clearMatching((key) =>
            key.startsWith(chunkKeyPrefix),
          );
          return {
            configuration: resolved.configuration,
            prepared,
          };
        },
      );

      const voiceBundle: VoiceBundle = {
        // Narration-first projects have exactly one human voice gate: the
        // reviewed pronunciation snapshot. Audio is a deterministic output
        // of that snapshot, so it must not introduce a second approval.
        status: 'approved',
        contentRevision:
          (currentProject.voiceBundle?.contentRevision ?? 0) + 1,
        sourceNarrationRevision: plan.narrationRevision,
        workspacePath: generation.result.prepared.workspacePath,
        configuration: generation.result.configuration,
        track: generation.result.prepared.track,
        sections: generation.result.prepared.sections,
        totalDurationSeconds:
          generation.result.prepared.totalDurationSeconds,
        generation: {
          generationId,
          provider: 'elevenlabs',
          generatedAt: generation.generatedAt,
          characterCost: generation.result.prepared.characterCost,
          requestIds: generation.result.prepared.requestIds,
        },
      };
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {voiceBundle},
        expectedRevision,
      );
      if (!updatedProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      await voiceWorkspace
        .clearGenerationCheckpoint?.(currentProject.id, generationId)
        .catch(error => logger.error(error));
      sendProject(response, 200, updatedProject);
      return true;
    }

    if (voiceRoute?.action === 'audio' && request.method === 'GET') {
      const currentProject = await repository.getProject(
        voiceRoute.projectId,
      );
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      if (
        !currentProject.voiceBundle ||
        !voiceRoute.outlineSectionId
      ) {
        throw new RequestBodyError(
          404,
          'VOICE_AUDIO_NOT_FOUND',
          'Project chưa có audio voice này.',
        );
      }
      const requestedGeneration =
        requestUrl.searchParams.get('generation');
      if (
        requestedGeneration &&
        requestedGeneration !==
        currentProject.voiceBundle.generation.generationId
      ) {
        throw new RequestBodyError(
          404,
          'VOICE_GENERATION_NOT_FOUND',
          'Generation voice được yêu cầu không còn là bản hiện tại.',
        );
      }
      const result = await voiceWorkspace.readAudio(
        currentProject.id,
        currentProject.voiceBundle,
        voiceRoute.outlineSectionId,
      );
      sendMediaBuffer(
        request,
        response,
        result.audio,
        result.contentType,
        {
          'Cache-Control': 'private, max-age=31536000, immutable',
          ETag: `"${currentProject.voiceBundle.generation.generationId}:${voiceRoute.outlineSectionId}"`,
        },
      );
      return true;
    }

    return false;
  };
}

