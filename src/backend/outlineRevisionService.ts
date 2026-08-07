import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {
  OutlineAiPatchSchema,
  OutlineCoherenceReviewSchema,
  type OutlineAiPatch,
  type OutlineCoherenceReview,
  type OutlineEditScope,
  type OutlineGlobalField,
  type OutlineSectionField,
} from '../shared/outlineHistory.ts';
import {
  TeachingOutlineContentSchema,
  type CodexTokenUsage,
  type TeachingOutlineContent,
  type TopicInput,
} from '../shared/topic.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  CodexStructuredGenerationError,
  codexGenerationTimeoutMs,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const OUTLINE_REVISION_PROMPT_VERSION = 'outline-edit-v2';
export const OUTLINE_COHERENCE_PROMPT_VERSION = 'outline-coherence-v1';

const patchOutputSchema = z.toJSONSchema(OutlineAiPatchSchema, {
  target: 'draft-7',
});
const coherenceOutputSchema = z.toJSONSchema(OutlineCoherenceReviewSchema, {
  target: 'draft-7',
});

export interface OutlineRevisionRequest {
  topicInput: TopicInput;
  baseContent: TeachingOutlineContent;
  scope: OutlineEditScope;
  guidance: string;
  model?: string;
  reasoningEffort?: string;
}

export interface OutlineRevisionResult {
  patch: OutlineAiPatch;
  content: TeachingOutlineContent;
  coherence: OutlineCoherenceReview;
  model: string;
  editorUsage: CodexTokenUsage | null;
  reviewerUsage: CodexTokenUsage | null;
}

export interface OutlineRevisionService {
  revise(request: OutlineRevisionRequest): Promise<OutlineRevisionResult>;
}

export class OutlineRevisionError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function scopeMaps(scope: OutlineEditScope) {
  return {
    globalFields: new Set<OutlineGlobalField>(scope.globalFields),
    sectionFields: new Map(
      scope.sections.map(section => [
        section.sectionId,
        new Set<OutlineSectionField>(section.fields),
      ]),
    ),
  };
}

function assertScopeMatchesContent(
  content: TeachingOutlineContent,
  scope: OutlineEditScope,
) {
  const sectionIds = new Set(content.sections.map(section => section.id));
  const missing = scope.sections.find(
    section => !sectionIds.has(section.sectionId),
  );
  if (missing) {
    throw new OutlineRevisionError(
      'OUTLINE_SCOPE_STALE',
      'Phạm vi chỉnh sửa không còn khớp với mạch giảng hiện tại.',
    );
  }
}

function assertAllowed(
  allowed: boolean,
  fieldDescription: string,
) {
  if (allowed) return;
  throw new OutlineRevisionError(
    'OUTLINE_PATCH_OUT_OF_SCOPE',
    `AI đã đề xuất thay đổi ngoài phạm vi cho phép: ${fieldDescription}.`,
  );
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Models sometimes echo protected fields instead of returning null. Remove
 * those fields deterministically before the strict apply guard runs. The
 * guard remains in place as the final invariant for every persisted patch.
 */
export function constrainOutlinePatch(
  baseContent: TeachingOutlineContent,
  scope: OutlineEditScope,
  patch: OutlineAiPatch,
): OutlineAiPatch {
  assertScopeMatchesContent(baseContent, scope);
  const allowed = scopeMaps(scope);
  const summary = patch.brief.summary;
  const assumptions = patch.brief.assumptions;
  const centralMessage = patch.centralMessage;

  return {
    ...patch,
    brief: {
      summary:
        summary !== null &&
        allowed.globalFields.has('brief.summary') &&
        !sameValue(summary, baseContent.brief.summary)
          ? summary
          : null,
      assumptions:
        assumptions !== null &&
        allowed.globalFields.has('brief.assumptions') &&
        !sameValue(assumptions, baseContent.brief.assumptions)
          ? assumptions
          : null,
    },
    centralMessage:
      centralMessage !== null &&
      allowed.globalFields.has('centralMessage') &&
      !sameValue(centralMessage, baseContent.centralMessage)
        ? centralMessage
        : null,
    sections: patch.sections.flatMap(sectionPatch => {
      const baseSection = baseContent.sections.find(
        section => section.id === sectionPatch.sectionId,
      );
      const allowedFields = allowed.sectionFields.get(sectionPatch.sectionId);
      if (!baseSection || !allowedFields) return [];

      const constrained = {
        sectionId: sectionPatch.sectionId,
        title:
          sectionPatch.title !== null &&
          allowedFields.has('title') &&
          !sameValue(sectionPatch.title, baseSection.title)
            ? sectionPatch.title
            : null,
        goal:
          sectionPatch.goal !== null &&
          allowedFields.has('goal') &&
          !sameValue(sectionPatch.goal, baseSection.goal)
            ? sectionPatch.goal
            : null,
        content:
          sectionPatch.content !== null &&
          allowedFields.has('content') &&
          !sameValue(sectionPatch.content, baseSection.content)
            ? sectionPatch.content
            : null,
        estimatedSeconds:
          sectionPatch.estimatedSeconds !== null &&
          allowedFields.has('estimatedSeconds') &&
          !sameValue(
            sectionPatch.estimatedSeconds,
            baseSection.estimatedSeconds,
          )
            ? sectionPatch.estimatedSeconds
            : null,
      };
      return constrained.title !== null ||
        constrained.goal !== null ||
        constrained.content !== null ||
        constrained.estimatedSeconds !== null
        ? [constrained]
        : [];
    }),
  };
}

export function applyOutlinePatch(
  baseContent: TeachingOutlineContent,
  scope: OutlineEditScope,
  patch: OutlineAiPatch,
): TeachingOutlineContent {
  assertScopeMatchesContent(baseContent, scope);
  const allowed = scopeMaps(scope);
  const next: TeachingOutlineContent = structuredClone(baseContent);

  if (patch.brief.summary !== null) {
    assertAllowed(
      allowed.globalFields.has('brief.summary'),
      'tóm tắt yêu cầu',
    );
    next.brief.summary = patch.brief.summary;
  }
  if (patch.brief.assumptions !== null) {
    assertAllowed(
      allowed.globalFields.has('brief.assumptions'),
      'các giả định',
    );
    next.brief.assumptions = patch.brief.assumptions;
  }
  if (patch.centralMessage !== null) {
    assertAllowed(
      allowed.globalFields.has('centralMessage'),
      'thông điệp trung tâm',
    );
    next.centralMessage = patch.centralMessage;
  }

  const seenSectionIds = new Set<string>();
  for (const sectionPatch of patch.sections) {
    if (seenSectionIds.has(sectionPatch.sectionId)) {
      throw new OutlineRevisionError(
        'OUTLINE_PATCH_INVALID',
        'AI trả về nhiều patch cho cùng một section.',
      );
    }
    seenSectionIds.add(sectionPatch.sectionId);
    const section = next.sections.find(
      candidate => candidate.id === sectionPatch.sectionId,
    );
    const allowedFields = allowed.sectionFields.get(sectionPatch.sectionId);
    if (!section || !allowedFields) {
      throw new OutlineRevisionError(
        'OUTLINE_PATCH_OUT_OF_SCOPE',
        'AI đã đề xuất thay đổi một section không được chọn.',
      );
    }

    for (const field of [
      'title',
      'goal',
      'content',
      'estimatedSeconds',
    ] as const) {
      const value = sectionPatch[field];
      if (value === null) continue;
      assertAllowed(
        allowedFields.has(field),
        `${section.title} · ${field}`,
      );
      section[field] = value as never;
    }
  }

  const parsed = TeachingOutlineContentSchema.safeParse(next);
  if (!parsed.success) {
    throw new OutlineRevisionError(
      'OUTLINE_PATCH_INVALID',
      'Đề xuất của AI không tạo thành mạch giảng hợp lệ.',
      {cause: parsed.error},
    );
  }
  if (JSON.stringify(parsed.data) === JSON.stringify(baseContent)) {
    throw new OutlineRevisionError(
      'OUTLINE_PATCH_EMPTY',
      'AI không tạo ra thay đổi thực tế nào trong phạm vi đã chọn.',
    );
  }

  return parsed.data;
}

function buildRevisionPrompt(request: OutlineRevisionRequest) {
  const editableSectionIds = new Set(
    request.scope.sections.map(section => section.sectionId),
  );
  const protectedSections = request.baseContent.sections
    .filter(section => !editableSectionIds.has(section.id))
    .map(section => section.id);
  return [
    'Chỉnh mạch giảng tiếng Việt theo góp ý trong JSON.',
    'Bạn được đọc TOÀN BỘ mạch giảng để giữ logic, chuyển tiếp, thuật ngữ và giọng điệu.',
    'Chỉ trả giá trị mới cho đúng trường có trong editScope; mọi trường khác phải là null hoặc không xuất hiện trong sections patch.',
    'Không thêm, xóa, đổi ID hoặc đổi thứ tự section. Không viết lại phần đang tốt nếu góp ý không yêu cầu.',
    'Tự kiểm tra bản sau khi ghép với các phần được bảo vệ để tránh mâu thuẫn, lặp ý và đứt mạch.',
    JSON.stringify({
      topicInput: request.topicInput,
      guidance: request.guidance,
      editScope: request.scope,
      protectedSectionIds: protectedSections,
      currentOutline: request.baseContent,
    }),
  ].join('\n');
}

function buildPatchRepairPrompt(
  request: OutlineRevisionRequest,
  invalidResponse: string,
  issue: string,
) {
  return [
    buildRevisionPrompt(request),
    'Phản hồi trước không thể áp dụng an toàn. Hãy trả lại đúng một JSON patch đã sửa; không giải thích.',
    'Mọi trường ngoài editScope và mọi giá trị không đổi phải là null. Không thêm section ngoài editScope.',
    JSON.stringify({
      validationIssue: issue,
      invalidResponse: invalidResponse.slice(0, 20_000),
    }),
  ].join('\n');
}

function buildCoherencePrompt(
  request: OutlineRevisionRequest,
  patch: OutlineAiPatch,
  candidate: TeachingOutlineContent,
) {
  return [
    'Review tính mạch lạc của BẢN HOÀN CHỈNH sau khi ghép patch vào mạch giảng.',
    'Không viết lại nội dung. Chỉ báo cáo vấn đề thực sự có ý nghĩa.',
    'Kiểm tra logic trước-sau, câu chuyển tiếp, mâu thuẫn, thuật ngữ, đại từ/chủ thể, lặp ý và nhịp thời lượng.',
    'Nếu cách sửa bắt buộc phải đụng phần ngoài editScope, đặt verdict=needs_scope_expansion và requiresScopeExpansion=true cho issue tương ứng.',
    'Nếu không có vấn đề, verdict=coherent và issues rỗng.',
    JSON.stringify({
      topicInput: request.topicInput,
      guidance: request.guidance,
      editScope: request.scope,
      originalOutline: request.baseContent,
      appliedPatch: patch,
      mergedCandidateOutline: candidate,
    }),
  ].join('\n');
}

function mapStructuredError(error: CodexStructuredGenerationError) {
  if (error.reason === 'timeout') {
    return new OutlineRevisionError(
      'CODEX_OUTLINE_REVISION_TIMEOUT',
      'Codex mất quá nhiều thời gian để tạo hoặc kiểm tra đề xuất.',
      {cause: error},
    );
  }
  if (error.reason === 'tool_used') {
    return new OutlineRevisionError(
      'CODEX_OUTLINE_REVISION_TOOL_USED',
      'Codex đã cố dùng công cụ trong khi chỉnh mạch giảng.',
      {cause: error},
    );
  }
  return new OutlineRevisionError(
    'CODEX_OUTLINE_REVISION_FAILED',
    error.message || 'Codex không hoàn tất được đề xuất chỉnh sửa.',
    {cause: error},
  );
}

function addUsage(
  left: CodexTokenUsage | null,
  right: CodexTokenUsage | null,
) {
  if (!left || !right) return left ?? right;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens:
      left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function parseAndApplyPatch(
  responseText: string,
  request: OutlineRevisionRequest,
) {
  let editorJson: unknown;
  try {
    const trimmed = responseText.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
    editorJson = JSON.parse(fenced?.[1] ?? trimmed);
  } catch (error) {
    throw new OutlineRevisionError(
      'CODEX_OUTLINE_REVISION_INVALID_RESPONSE',
      'Codex trả về patch không đúng định dạng.',
      {cause: error},
    );
  }
  const parsedPatch = OutlineAiPatchSchema.safeParse(editorJson);
  if (!parsedPatch.success) {
    throw new OutlineRevisionError(
      'CODEX_OUTLINE_REVISION_INVALID_RESPONSE',
      'Codex trả về patch chưa đúng cấu trúc yêu cầu.',
      {cause: parsedPatch.error},
    );
  }
  const patch = constrainOutlinePatch(
    request.baseContent,
    request.scope,
    parsedPatch.data,
  );
  return {
    patch,
    content: applyOutlinePatch(request.baseContent, request.scope, patch),
  };
}

export function createCodexOutlineRevisionService(
  client: CodexAppServerClient,
  options: {runtimeDirectory?: string; timeoutMs?: number} = {},
): OutlineRevisionService {
  const runtimeDirectory = path.resolve(
    options.runtimeDirectory ??
      path.join(os.tmpdir(), 'pad-studio-ai-runtime'),
  );

  return {
    async revise(request) {
      assertScopeMatchesContent(request.baseContent, request.scope);
      try {
        let editor = await runCodexStructuredGeneration({
          client,
          runtimeDirectory,
          timeoutMs:
            options.timeoutMs ??
            codexGenerationTimeoutMs(request.reasoningEffort),
          outputSchema: patchOutputSchema,
          prompt: buildRevisionPrompt(request),
          baseInstructions:
            'Bạn là biên tập viên mạch giảng của PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
          developerInstructions:
            'Đọc rộng nhưng sửa hẹp. Giữ nguyên mọi phần tốt và mọi ID. Tính mạch lạc của bản ghép quan trọng hơn việc viết lại cho khác.',
          model: request.model,
          reasoningEffort: request.reasoningEffort,
        });

        let prepared: ReturnType<typeof parseAndApplyPatch>;
        try {
          prepared = parseAndApplyPatch(editor.responseText, request);
        } catch (error) {
          if (!(error instanceof OutlineRevisionError)) throw error;
          const repaired = await runCodexStructuredGeneration({
            client,
            runtimeDirectory,
            timeoutMs:
              options.timeoutMs ??
              codexGenerationTimeoutMs(request.reasoningEffort),
            outputSchema: patchOutputSchema,
            prompt: buildPatchRepairPrompt(
              request,
              editor.responseText,
              error.message,
            ),
            baseInstructions:
              'Bạn sửa một JSON patch mạch giảng cho PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
            developerInstructions:
              'Chỉ sửa patch để có thay đổi thực tế đúng editScope. Mọi phần được bảo vệ phải là null; không mở rộng scope hoặc đổi ID.',
            model: request.model,
            reasoningEffort: request.reasoningEffort,
          });
          editor = {
            ...repaired,
            model: [...new Set([editor.model, repaired.model])]
              .join(', ')
              .slice(0, 160),
            usage: addUsage(editor.usage, repaired.usage),
          };
          try {
            prepared = parseAndApplyPatch(repaired.responseText, request);
          } catch (repairError) {
            throw new OutlineRevisionError(
              'CODEX_OUTLINE_REVISION_REPAIR_FAILED',
              'Codex chưa tạo được thay đổi hợp lệ đúng phần đã chọn sau lượt tự khắc phục.',
              {cause: repairError},
            );
          }
        }

        let coherence: OutlineCoherenceReview;
        let reviewerUsage: CodexTokenUsage | null = null;
        try {
          const reviewer = await runCodexStructuredGeneration({
            client,
            runtimeDirectory,
            timeoutMs:
              options.timeoutMs ??
              codexGenerationTimeoutMs(request.reasoningEffort),
            outputSchema: coherenceOutputSchema,
            prompt: buildCoherencePrompt(
              request,
              prepared.patch,
              prepared.content,
            ),
            baseInstructions:
              'Bạn kiểm định mạch lạc cho PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
            developerInstructions:
              'Review toàn bộ bản đã ghép, không đề xuất viết lại rộng. Phân biệt lỗi thực sự với sở thích diễn đạt.',
            model: request.model,
            reasoningEffort: request.reasoningEffort,
          });
          const trimmed = reviewer.responseText.trim();
          const fenced = trimmed.match(
            /^```(?:json)?\s*([\s\S]*?)\s*```$/iu,
          );
          const reviewerJson = JSON.parse(fenced?.[1] ?? trimmed) as unknown;
          const parsedReview = OutlineCoherenceReviewSchema.safeParse(
            reviewerJson,
          );
          if (!parsedReview.success) {
            throw new OutlineRevisionError(
              'CODEX_OUTLINE_COHERENCE_INVALID_RESPONSE',
              'Kết quả kiểm tra mạch lạc chưa đúng cấu trúc yêu cầu.',
              {cause: parsedReview.error},
            );
          }
          coherence = parsedReview.data;
          reviewerUsage = reviewer.usage;
        } catch (error) {
          if (
            !(error instanceof OutlineRevisionError) &&
            !(error instanceof CodexStructuredGenerationError) &&
            !(error instanceof SyntaxError)
          ) {
            throw error;
          }
          coherence = {
            verdict: 'warning',
            summary:
              'Patch đã hợp lệ và được áp dụng đúng phạm vi, nhưng lượt kiểm tra mạch lạc tự động chưa hoàn tất.',
            issues: [{
              severity: 'warning',
              category: 'scope',
              message:
                'Reviewer Codex tạm thời không phản hồi; candidate vẫn được giữ để bạn không mất phần chỉnh sửa đã sinh.',
              suggestedFix:
                'Xem trước candidate và chỉnh tiếp nếu cần kiểm tra thêm.',
              affectedSectionIds: request.scope.sections.map(
                item => item.sectionId,
              ),
              requiresScopeExpansion: false,
            }],
          };
        }

        return {
          patch: prepared.patch,
          content: prepared.content,
          coherence,
          model: editor.model,
          editorUsage: editor.usage,
          reviewerUsage,
        };
      } catch (error) {
        if (error instanceof OutlineRevisionError) throw error;
        if (error instanceof CodexStructuredGenerationError) {
          throw mapStructuredError(error);
        }
        throw new OutlineRevisionError(
          'CODEX_OUTLINE_REVISION_FAILED',
          'Không thể tạo đề xuất chỉnh sửa bằng Codex.',
          {cause: error},
        );
      }
    },
  };
}
