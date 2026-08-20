import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {z} from 'zod';
import {normalizePronunciationBaseText} from '../shared/pronunciation.ts';
import {
  ApproveNarrationSchema,
  SaveNarrationSchema
} from '../shared/topic.ts';
import {
  textEncodingIssue
} from '../shared/vietnameseSpeech.ts';
import {
  hashJson
} from './motionCanvasHistoryStore.ts';
import {
  ProjectConflictError
} from './projectRepository.ts';
import {
  getProjectNarrationRoute
} from './projectRoutes.ts';

import type {AppContext} from './appContext.ts';
import {RequestBodyError, sendApiError} from './appErrors.ts';
import {readExpectedRevision, readJsonBody, sendJson, sendProject, validationFields} from './httpTransport.ts';
const AuditNarrationSchema = z.object({generationId: z.string().uuid(), model: z.string().trim().min(1).max(160).optional(), reasoningEffort: z.string().trim().min(1).max(80).optional()}).strict();
function narrationReviewSourceHash(sourceText: string, normalizedText: string) {
  return hashJson({sourceText, normalizedText});
}

import type {ApiRouteHandler} from './routeTypes.ts';

type NarrationRouteContext = Pick<AppContext, 'repository' | 'pronunciationAuditService' | 'pronunciationAuditGenerations' | 'pronunciationRuleStore' | 'generateOnce'>;

export function createNarrationRouteHandler(context: NarrationRouteContext): ApiRouteHandler {
  const {repository, pronunciationAuditService, pronunciationAuditGenerations, pronunciationRuleStore, generateOnce} = context;
  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    const narrationRoute = getProjectNarrationRoute(requestUrl.pathname);

    if (narrationRoute?.action === 'read' && request.method === 'GET') {
      const currentProject = await repository.getProject(narrationRoute.projectId);
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const libraryRules = await pronunciationRuleStore.list();
      sendJson(response, 200, {
        narration: currentProject.narration ?? null,
        libraryRules,
      });
      return true;
    }

    if (narrationRoute?.action === 'read' && request.method === 'PUT') {
      const expectedRevision = readExpectedRevision(request);
      const parsed = SaveNarrationSchema.safeParse(await readJsonBody(request));
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Lời thoại hoặc quy tắc phát âm chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const currentProject = await repository.getProject(narrationRoute.projectId);
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
      const libraryRules = await pronunciationRuleStore.list();
      const allRules = [...libraryRules, ...parsed.data.projectRules];
      // Step 1 deliberately omits normalizedText. Only neutral whitespace
      // cleanup is automatic; dictionary/notation changes still require an
      // explicit Apply action (or a manual edit) in step 2.
      const normalizedText = parsed.data.normalizedText ??
        normalizePronunciationBaseText(parsed.data.sourceText);
      const encodingIssue =
        textEncodingIssue(parsed.data.sourceText) ??
        textEncodingIssue(normalizedText);
      if (encodingIssue) {
        throw new RequestBodyError(
          422,
          'NARRATION_TEXT_ENCODING_INVALID',
          `${encodingIssue} Hãy dán lại lời thoại đúng Unicode trước khi duyệt.`,
        );
      }
      const review = {
        sourceText: parsed.data.sourceText,
        normalizedText,
        rules: allRules,
        aiPatches: [],
        sourceHash: narrationReviewSourceHash(parsed.data.sourceText, normalizedText),
        rulesHash: hashJson(allRules),
        reviewedAt: null,
      };
      const project = await repository.updateProject(
        currentProject.id,
        {
          narration: {
            sourceText: parsed.data.sourceText,
            projectRules: parsed.data.projectRules,
            review,
            approvedSourceHash: null,
            approvedAt: null,
          },
        },
        expectedRevision,
      );
      if (!project) throw new Error('Project vừa biến mất khi lưu lời thoại.');
      sendProject(response, 200, project);
      return true;
    }

    if (narrationRoute?.action === 'audit' && request.method === 'POST') {
      const expectedRevision = readExpectedRevision(request);
      const parsed = AuditNarrationSchema.safeParse(await readJsonBody(request));
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu AI rà soát cách đọc chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const currentProject = await repository.getProject(narrationRoute.projectId);
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
      const narration = currentProject.narration;
      if (!narration?.review) {
        throw new RequestBodyError(
          409,
          'NARRATION_NOT_READY',
          'Hãy lưu lời thoại trước khi yêu cầu AI rà soát.',
        );
      }
      const review = narration.review;
      const auditGenerationKey = `${currentProject.id}:${parsed.data.generationId}`;
      const auditFingerprint = JSON.stringify({
        sourceText: narration.sourceText,
        normalizedText: review.normalizedText,
        rules: review.rules,
        model: parsed.data.model ?? null,
        reasoningEffort: parsed.data.reasoningEffort ?? null,
      });
      const auditGeneration = await generateOnce(
        pronunciationAuditGenerations,
        auditGenerationKey,
        auditFingerprint,
        () => pronunciationAuditService.audit({
          sourceText: narration.sourceText,
          normalizedText: review.normalizedText,
          rules: review.rules,
          model: parsed.data.model,
          reasoningEffort: parsed.data.reasoningEffort,
        }),
      );
      const audit = auditGeneration.result;
      const nextReview = {
        ...narration.review,
        // An audit produces a proposal only. It must not silently replace the
        // user's editable/saved pronunciation snapshot.
        normalizedText: narration.review.normalizedText,
        aiPatches: audit.patches,
        sourceHash: narrationReviewSourceHash(
          narration.sourceText,
          narration.review.normalizedText,
        ),
        reviewedAt: null,
      };
      const project = await repository.updateProject(
        currentProject.id,
        {
          narration: {
            ...narration,
            review: nextReview,
            approvedSourceHash: null,
            approvedAt: null,
          },
        },
        expectedRevision,
      );
      if (!project) throw new Error('Project vừa biến mất khi rà soát lời thoại.');
      sendProject(response, 200, project);
      return true;
    }

    if (narrationRoute?.action === 'approve' && request.method === 'POST') {
      const expectedRevision = readExpectedRevision(request);
      const parsed = ApproveNarrationSchema.safeParse(await readJsonBody(request));
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Snapshot lời thoại cần duyệt không hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const currentProject = await repository.getProject(narrationRoute.projectId);
      if (!currentProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const narration = currentProject.narration;
      const currentRulesHash = narration
        ? hashJson([
          ...(await pronunciationRuleStore.list()),
          ...narration.projectRules,
        ])
        : null;
      if (!narration?.review ||
        narration.review.sourceHash !== parsed.data.sourceHash ||
        narration.review.rulesHash !== parsed.data.rulesHash ||
        narration.review.rulesHash !== currentRulesHash) {
        throw new RequestBodyError(
          409,
          'NARRATION_REVIEW_STALE',
          'Bản đọc hoặc từ điển đã thay đổi. Hãy kiểm tra lại trước khi duyệt.',
        );
      }
      const approvedAt = new Date().toISOString();
      const project = await repository.updateProject(
        currentProject.id,
        {
          narration: {
            ...narration,
            review: {...narration.review, reviewedAt: approvedAt},
            approvedSourceHash: narration.review.sourceHash,
            approvedAt,
          },
        },
        expectedRevision,
      );
      if (!project) throw new Error('Project vừa biến mất khi duyệt lời thoại.');
      sendProject(response, 200, project);
      return true;
    }

    return false;
  };
}
