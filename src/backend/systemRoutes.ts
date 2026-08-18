import type {IncomingMessage, ServerResponse} from 'node:http';
import {z} from 'zod';
import {GenerateNarrationDraftSchema} from '../shared/topic.ts';
import type {AppContext} from './appContext.ts';
import {sendApiError} from './appErrors.ts';
import {localVoicePresets} from './appRouteSupport.ts';
import {CodexConnectionError} from './codexConnection.ts';
import {readJsonBody, sendJson, validationFields} from './httpTransport.ts';
import {NARRATION_DRAFT_PROMPT_VERSION} from './narrationDraftGenerator.ts';
import type {ApiRouteHandler} from './routeTypes.ts';

const CodexApiKeyLoginSchema = z.object({apiKey: z.string().trim().min(1).max(512)}).strict();
const ElevenLabsApiKeySchema = z.object({apiKey: z.string().trim().min(1).max(512)}).strict();

type SystemRouteContext = Pick<AppContext, 'runtimeDiagnostics' | 'codexConnection' | 'elevenLabsConnection' | 'credentialStore' | 'elevenLabsConnectionFactory' | 'elevenLabsVoiceService' | 'repository' | 'narrationDraftGenerator' | 'narrationDraftGenerations' | 'generateOnce'>;

export function createSystemRouteHandler(context: SystemRouteContext): ApiRouteHandler {
  const {runtimeDiagnostics, codexConnection, elevenLabsConnection, credentialStore, elevenLabsConnectionFactory, elevenLabsVoiceService, repository, narrationDraftGenerator, narrationDraftGenerations, generateOnce} = context;
  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    if (requestUrl.pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, {status: 'ok'});
      return true;
    }

    if (
      requestUrl.pathname === '/api/runtime/diagnostics' &&
      request.method === 'GET'
    ) {
      sendJson(response, 200, {
        diagnostics: await runtimeDiagnostics.inspect(),
      });
      return true;
    }

    if (
      requestUrl.pathname === '/api/integrations/codex/status' &&
      request.method === 'GET'
    ) {
      const status = await codexConnection.verifyConnection();
      sendJson(response, 200, {status});
      return true;
    }

    if (
      requestUrl.pathname === '/api/integrations/codex/login' &&
      request.method === 'POST'
    ) {
      const login = await codexConnection.startChatGptLogin();
      sendJson(response, 200, {login});
      return true;
    }

    if (
      requestUrl.pathname === '/api/integrations/codex/api-key' &&
      request.method === 'POST'
    ) {
      const body = await readJsonBody(request);
      const parsed = CodexApiKeyLoginSchema.safeParse(body);
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'OpenAI API key chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      await codexConnection.loginWithApiKey(parsed.data.apiKey);
      const status = await codexConnection.verifyConnection();
      if (status.state !== 'connected') {
        throw new CodexConnectionError(
          'CODEX_API_KEY_VERIFICATION_FAILED',
          status.message,
        );
      }
      response.setHeader('Cache-Control', 'no-store');
      sendJson(response, 200, {status});
      return true;
    }

    if (
      requestUrl.pathname === '/api/integrations/codex/logout' &&
      request.method === 'POST'
    ) {
      await codexConnection.logout();
      response.setHeader('Cache-Control', 'no-store');
      sendJson(response, 200, {status: 'disconnected'});
      return true;
    }

    if (
      requestUrl.pathname === '/api/integrations/codex/models' &&
      request.method === 'GET'
    ) {
      const models = await codexConnection.listModels();
      response.setHeader('Cache-Control', 'no-store');
      sendJson(response, 200, {models});
      return true;
    }

    if (
      requestUrl.pathname === '/api/narration-drafts/generate' &&
      request.method === 'POST'
    ) {
      const body = await readJsonBody(request);
      const parsedRequest = GenerateNarrationDraftSchema.safeParse(body);
      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Thông tin để tạo lời thoại chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }
      const {
        generationId,
        topicInput,
        userGuidance,
        model,
        reasoningEffort,
      } = parsedRequest.data;
      const fingerprint = JSON.stringify({
        topicInput,
        userGuidance: userGuidance ?? null,
        model: model ?? null,
        reasoningEffort: reasoningEffort ?? null,
      });
      const generated = await generateOnce(
        narrationDraftGenerations,
        generationId,
        fingerprint,
        () => narrationDraftGenerator.generate({
          topicInput,
          ...(userGuidance ? {userGuidance} : {}),
          ...(model ? {model} : {}),
          ...(reasoningEffort ? {reasoningEffort} : {}),
        }),
      );
      sendJson(response, 200, {
        draft: generated.result.draft,
        generation: {
          generationId,
          provider: 'codex',
          model: generated.result.model,
          ...(model ? {requestedModel: model} : {}),
          ...(reasoningEffort ? {reasoningEffort} : {}),
          promptVersion: NARRATION_DRAFT_PROMPT_VERSION,
          generatedAt: generated.generatedAt,
          usage: generated.result.usage,
        },
      });
      return true;
    }

    if (
      requestUrl.pathname === '/api/integrations/elevenlabs/status' &&
      request.method === 'GET'
    ) {
      const status = await elevenLabsConnection.verifyConnection();
      sendJson(response, 200, {status});
      return true;
    }

    if (
      requestUrl.pathname === '/api/integrations/elevenlabs/credential' &&
      request.method === 'GET'
    ) {
      const stored = Boolean(await credentialStore.get('elevenlabs'));
      sendJson(response, 200, {
        credential: {
          configured: stored || Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
          source: stored
            ? 'secure-store'
            : process.env.ELEVENLABS_API_KEY?.trim()
              ? 'environment'
              : 'none',
          persistence: credentialStore.persistence,
        },
      });
      return true;
    }

    if (
      requestUrl.pathname === '/api/integrations/elevenlabs/credential' &&
      request.method === 'PUT'
    ) {
      const body = await readJsonBody(request);
      const parsed = ElevenLabsApiKeySchema.safeParse(body);
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'ElevenLabs API key chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const status = await elevenLabsConnectionFactory(
        parsed.data.apiKey,
      ).verifyConnection();
      if (status.state !== 'connected') {
        sendApiError(response, 422, {
          code: 'ELEVENLABS_API_KEY_VERIFICATION_FAILED',
          message: status.message,
        });
        return true;
      }
      await credentialStore.set('elevenlabs', parsed.data.apiKey);
      response.setHeader('Cache-Control', 'no-store');
      sendJson(response, 200, {
        status,
        credential: {
          configured: true,
          source: 'secure-store',
          persistence: credentialStore.persistence,
        },
      });
      return true;
    }

    if (
      requestUrl.pathname === '/api/integrations/elevenlabs/credential' &&
      request.method === 'DELETE'
    ) {
      await credentialStore.delete('elevenlabs');
      response.setHeader('Cache-Control', 'no-store');
      sendJson(response, 200, {
        credential: {
          configured: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
          source: process.env.ELEVENLABS_API_KEY?.trim()
            ? 'environment'
            : 'none',
          persistence: credentialStore.persistence,
        },
      });
      return true;
    }

    if (
      requestUrl.pathname === '/api/integrations/elevenlabs/catalog' &&
      request.method === 'GET'
    ) {
      const catalog = await elevenLabsVoiceService.getCatalog(
        requestUrl.searchParams.get('search')?.trim() ?? '',
        await localVoicePresets(repository),
      );
      sendJson(response, 200, {catalog});
      return true;
    }

    return false;
  };
}

