import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  PronunciationRuleSchema
} from '../shared/pronunciation.ts';
import {
  getPronunciationLibraryRuleRoute
} from './projectRoutes.ts';

import type {AppContext} from './appContext.ts';
import {sendApiError} from './appErrors.ts';
import {readJsonBody, sendJson, validationFields} from './httpTransport.ts';
const LibraryPronunciationRuleInputSchema = PronunciationRuleSchema.omit({id: true, scope: true}).strict();
import type {ApiRouteHandler} from './routeTypes.ts';

type PronunciationRouteContext = Pick<AppContext, 'pronunciationRuleStore'>;

export function createPronunciationRouteHandler(context: PronunciationRouteContext): ApiRouteHandler {
  const {pronunciationRuleStore} = context;
  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    const pronunciationLibraryRoute = getPronunciationLibraryRuleRoute(
      requestUrl.pathname,
    );

    if (pronunciationLibraryRoute?.ruleId === null && request.method === 'GET') {
      sendJson(response, 200, {rules: await pronunciationRuleStore.list()});
      return true;
    }

    if (pronunciationLibraryRoute?.ruleId === null && request.method === 'POST') {
      const parsed = LibraryPronunciationRuleInputSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Quy tắc từ điển dùng chung chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const rule = await pronunciationRuleStore.save(parsed.data);
      sendJson(response, 201, {rule});
      return true;
    }

    if (pronunciationLibraryRoute?.ruleId && request.method === 'PUT') {
      const parsed = LibraryPronunciationRuleInputSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Quy tắc từ điển dùng chung chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const rule = await pronunciationRuleStore.save({
        ...parsed.data,
        id: pronunciationLibraryRoute.ruleId,
      });
      sendJson(response, 200, {rule});
      return true;
    }

    if (pronunciationLibraryRoute?.ruleId && request.method === 'DELETE') {
      const removed = await pronunciationRuleStore.remove(
        pronunciationLibraryRoute.ruleId,
      );
      if (!removed) {
        sendApiError(response, 404, {
          code: 'PRONUNCIATION_RULE_NOT_FOUND',
          message: 'Không tìm thấy quy tắc từ điển dùng chung.',
        });
        return true;
      }
      response.writeHead(204, {'Cache-Control': 'no-store'});
      response.end();
      return true;
    }

    return false;
  };
}

