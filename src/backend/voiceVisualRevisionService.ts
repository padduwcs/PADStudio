import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {
  VoiceVisualAiPatchSchema,
  VoiceVisualCoherenceReviewSchema,
  type VoiceVisualAiPatch,
  type VoiceVisualBeatField,
  type VoiceVisualCoherenceReview,
  type VoiceVisualEditScope,
  type VoiceVisualGlobalField,
} from '../shared/voiceVisualHistory.ts';
import {
  VoiceVisualPlanContentSchema,
  type CodexTokenUsage,
  type TeachingOutline,
  type TopicInput,
  type VoiceVisualPlanContent,
} from '../shared/topic.ts';
import {plannedBeatDurationSeconds} from '../shared/narrationTiming.ts';
import {
  speechTextForBeat,
  toVietnameseSpeechText,
} from '../shared/vietnameseSpeech.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  CodexStructuredGenerationError,
  codexGenerationTimeoutMs,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const VOICE_VISUAL_REVISION_PROMPT_VERSION =
  'voice-visual-edit-v2';
export const VOICE_VISUAL_COHERENCE_PROMPT_VERSION =
  'voice-visual-coherence-v2';
const VOICE_VISUAL_CANDIDATE_REVIEW_TIMEOUT_MS = 90_000;

const patchOutputSchema = z.toJSONSchema(VoiceVisualAiPatchSchema, {
  target: 'draft-7',
});
const coherenceOutputSchema = z.toJSONSchema(
  VoiceVisualCoherenceReviewSchema,
  {target: 'draft-7'},
);

export interface VoiceVisualRevisionRequest {
  topicInput: TopicInput;
  outline: TeachingOutline;
  baseContent: VoiceVisualPlanContent;
  scope: VoiceVisualEditScope;
  guidance: string;
  model?: string;
  reasoningEffort?: string;
}

export interface VoiceVisualRevisionResult {
  patch: VoiceVisualAiPatch;
  content: VoiceVisualPlanContent;
  coherence: VoiceVisualCoherenceReview;
  model: string;
  editorUsage: CodexTokenUsage | null;
  reviewerUsage: CodexTokenUsage | null;
}

export type VoiceVisualReviewRequest = {
  topicInput: TopicInput;
  outline: TeachingOutline;
  content: VoiceVisualPlanContent;
  model?: string;
  reasoningEffort?: string;
} & (
  | {target: 'current'}
  | {
      target: 'candidate';
      baseContent: VoiceVisualPlanContent;
      scope: VoiceVisualEditScope;
      guidance: string;
      patch: VoiceVisualAiPatch;
    }
);

export interface VoiceVisualReviewResult {
  coherence: VoiceVisualCoherenceReview;
  model: string;
  usage: CodexTokenUsage | null;
}

export interface VoiceVisualRevisionService {
  revise(
    request: VoiceVisualRevisionRequest,
  ): Promise<VoiceVisualRevisionResult>;
  review(request: VoiceVisualReviewRequest): Promise<VoiceVisualReviewResult>;
}

export class VoiceVisualRevisionError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function scopeMaps(scope: VoiceVisualEditScope) {
  return {
    globalFields: new Set<VoiceVisualGlobalField>(scope.globalFields),
    beatFields: new Map(
      scope.beats.map(beat => [
        beat.beatId,
        new Set<VoiceVisualBeatField>(beat.fields),
      ]),
    ),
  };
}

function allBeatIds(content: VoiceVisualPlanContent) {
  return new Set(
    content.sections.flatMap(section => section.beats.map(beat => beat.id)),
  );
}

function assertScopeMatchesContent(
  content: VoiceVisualPlanContent,
  scope: VoiceVisualEditScope,
) {
  const beatIds = allBeatIds(content);
  if (scope.beats.some(beat => !beatIds.has(beat.beatId))) {
    throw new VoiceVisualRevisionError(
      'VOICE_VISUAL_SCOPE_STALE',
      'Phạm vi chỉnh sửa không còn khớp với kế hoạch voice–visual hiện tại.',
    );
  }
}

function assertAllowed(allowed: boolean, fieldDescription: string) {
  if (allowed) return;
  throw new VoiceVisualRevisionError(
    'VOICE_VISUAL_PATCH_OUT_OF_SCOPE',
    `AI đã đề xuất thay đổi ngoài phạm vi cho phép: ${fieldDescription}.`,
  );
}

export function applyVoiceVisualPatch(
  baseContent: VoiceVisualPlanContent,
  scope: VoiceVisualEditScope,
  patch: VoiceVisualAiPatch,
): VoiceVisualPlanContent {
  assertScopeMatchesContent(baseContent, scope);
  const allowed = scopeMaps(scope);
  const next: VoiceVisualPlanContent = structuredClone(baseContent);

  if (patch.voiceDirection !== null) {
    assertAllowed(
      allowed.globalFields.has('voiceDirection'),
      'định hướng giọng kể',
    );
    next.voiceDirection = patch.voiceDirection;
  }
  if (patch.visualDirection !== null) {
    assertAllowed(
      allowed.globalFields.has('visualDirection'),
      'định hướng hình ảnh',
    );
    next.visualDirection = patch.visualDirection;
  }

  const seenBeatIds = new Set<string>();
  for (const beatPatch of patch.beats) {
    if (seenBeatIds.has(beatPatch.beatId)) {
      throw new VoiceVisualRevisionError(
        'VOICE_VISUAL_PATCH_INVALID',
        'AI trả về nhiều patch cho cùng một beat.',
      );
    }
    seenBeatIds.add(beatPatch.beatId);
    const beat = next.sections
      .flatMap(section => section.beats)
      .find(candidate => candidate.id === beatPatch.beatId);
    const allowedFields = allowed.beatFields.get(beatPatch.beatId);
    if (!beat || !allowedFields) {
      throw new VoiceVisualRevisionError(
        'VOICE_VISUAL_PATCH_OUT_OF_SCOPE',
        'AI đã đề xuất thay đổi một beat không được chọn.',
      );
    }

    let timingChanged = false;
    for (const field of [
      'voiceover',
      'spokenVoiceover',
      'visualDescription',
      'animationDescription',
      'visualHoldSeconds',
    ] as const) {
      const value = beatPatch[field];
      if (value == null) continue;
      assertAllowed(allowedFields.has(field), `beat ${beat.id} · ${field}`);
      beat[field] = value as never;
      timingChanged ||=
        field === 'voiceover' ||
        field === 'spokenVoiceover' ||
        field === 'visualHoldSeconds';
    }
    if (
      beatPatch.voiceover !== null &&
      beatPatch.spokenVoiceover == null
    ) {
      beat.spokenVoiceover = toVietnameseSpeechText(beat.voiceover);
    }
    if (timingChanged) {
      beat.durationSeconds = plannedBeatDurationSeconds(
        speechTextForBeat(beat),
        beat.visualHoldSeconds,
        next.timingCalibration,
      );
    }
  }

  const parsed = VoiceVisualPlanContentSchema.safeParse(next);
  if (!parsed.success) {
    throw new VoiceVisualRevisionError(
      'VOICE_VISUAL_PATCH_INVALID',
      'Đề xuất của AI không tạo thành kế hoạch voice–visual hợp lệ.',
      {cause: parsed.error},
    );
  }
  if (JSON.stringify(parsed.data) === JSON.stringify(baseContent)) {
    throw new VoiceVisualRevisionError(
      'VOICE_VISUAL_PATCH_EMPTY',
      'AI không tạo ra thay đổi thực tế nào trong phạm vi đã chọn.',
    );
  }
  return parsed.data;
}

function promptOutline(outline: TeachingOutline) {
  return {
    centralMessage: outline.centralMessage,
    sections: outline.sections.map(section => ({
      id: section.id,
      title: section.title,
      goal: section.goal,
      content: section.content,
      estimatedSeconds: section.estimatedSeconds,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nullableValue(
  source: Record<string, unknown>,
  key: string,
) {
  return key in source ? source[key] ?? null : null;
}

/**
 * Structured output models occasionally omit fields whose value is null or
 * wrap the requested object in `patch`. Normalize those equivalent sparse
 * shapes before applying the strict, persisted patch contract.
 */
export function normalizeVoiceVisualPatchResponse(value: unknown) {
  const root =
    isRecord(value) && isRecord(value.patch) ? value.patch : value;
  if (!isRecord(root)) return value;
  const directions = isRecord(root.directions) ? root.directions : {};
  const rawBeats =
    Array.isArray(root.beats)
      ? root.beats
      : isRecord(root.beats)
        ? Object.entries(root.beats).map(([beatId, patch]) => ({
            beatId,
            ...(isRecord(patch) ? patch : {}),
          }))
        : [];

  return {
    editSummary:
      typeof root.editSummary === 'string'
        ? root.editSummary
        : typeof root.summary === 'string'
          ? root.summary
          : '',
    voiceDirection:
      'voiceDirection' in root
        ? root.voiceDirection ?? null
        : nullableValue(directions, 'voiceDirection'),
    visualDirection:
      'visualDirection' in root
        ? root.visualDirection ?? null
        : nullableValue(directions, 'visualDirection'),
    beats: rawBeats.map((rawBeat) => {
      if (!isRecord(rawBeat)) return rawBeat;
      const changes = isRecord(rawBeat.changes)
        ? rawBeat.changes
        : isRecord(rawBeat.fields)
          ? rawBeat.fields
          : rawBeat;
      const hold = nullableValue(changes, 'visualHoldSeconds');
      return {
        beatId:
          typeof rawBeat.beatId === 'string'
            ? rawBeat.beatId
            : rawBeat.id,
        voiceover: nullableValue(changes, 'voiceover'),
        spokenVoiceover: nullableValue(changes, 'spokenVoiceover'),
        visualDescription: nullableValue(changes, 'visualDescription'),
        animationDescription: nullableValue(
          changes,
          'animationDescription',
        ),
        visualHoldSeconds:
          typeof hold === 'string' && hold.trim() !== ''
            ? Number(hold)
            : hold,
      };
    }),
  };
}

function parseAgentJson(responseText: string) {
  const trimmed = responseText.trim();
  const fenced = trimmed.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/iu,
  );
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function parseVoiceVisualPatch(responseText: string) {
  const json = parseAgentJson(responseText);
  return VoiceVisualAiPatchSchema.safeParse(
    normalizeVoiceVisualPatchResponse(json),
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

function reviewReasoningEffort(effort?: string) {
  return ['high', 'xhigh', 'max', 'ultra'].includes(effort ?? '')
    ? 'medium'
    : effort;
}

function buildRevisionPrompt(request: VoiceVisualRevisionRequest) {
  const editableBeatIds = new Set(request.scope.beats.map(beat => beat.beatId));
  return [
    'Chỉnh kế hoạch voice–visual tiếng Việt theo góp ý trong JSON.',
    'Đọc TOÀN BỘ outline và kế hoạch để giữ mạch kể, chuyển tiếp, thuật ngữ, nhịp và ngôn ngữ hình ảnh.',
    'Chỉ trả giá trị mới cho đúng trường trong editScope; có thể bỏ hẳn các trường không đổi hoặc đặt chúng là null. Không được patch beat ngoài scope.',
    'Không thêm, xóa, đổi ID, đổi thứ tự beat/section hoặc sửa timingCalibration. Không viết lại phần đang tốt.',
    'Nếu sửa voiceover, câu mới phải nối tự nhiên với beat ngay trước và ngay sau. Nếu sửa visual/animation, phải tiếp tục khớp chính xác với lời kể hiện có.',
    'Khi sửa voiceover, đồng thời cung cấp spokenVoiceover là cách TTS tiếng Việt cần đọc; phiên âm ký hiệu/công thức như O(n) → “ô nờ”, O(n^2) → “ô nờ bình”, O(log n) → “ô lốc nờ”, a[i] → “a tại chỉ số i”.',
    JSON.stringify({
      topicInput: request.topicInput,
      outline: promptOutline(request.outline),
      guidance: request.guidance,
      editScope: request.scope,
      protectedBeatIds: request.baseContent.sections
        .flatMap(section => section.beats)
        .filter(beat => !editableBeatIds.has(beat.id))
        .map(beat => beat.id),
      currentPlan: request.baseContent,
    }),
  ].join('\n');
}

function buildPatchRepairPrompt(
  request: VoiceVisualRevisionRequest,
  invalidResponse: string,
  issues: Array<{path: PropertyKey[]; message: string}>,
) {
  return [
    buildRevisionPrompt(request),
    'Phản hồi trước chưa khớp schema. Hãy trả lại đúng một JSON patch đã sửa; không giải thích.',
    'Có thể bỏ các trường không đổi. Không đổi beatId và không thêm beat ngoài editScope.',
    JSON.stringify({
      validationIssues: issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
      invalidResponse: invalidResponse.slice(0, 20_000),
    }),
  ].join('\n');
}

function buildReviewPrompt(request: VoiceVisualReviewRequest) {
  const instructions = [
    'Review BẢN VOICE–VISUAL HOÀN CHỈNH được cung cấp.',
    'Không viết lại nội dung. Chỉ báo cáo lỗi thực sự có ý nghĩa.',
    'Kiểm tra câu nối giữa mọi beat và section, tính nhất quán chủ thể/thuật ngữ, lặp ý, voice khớp visual/animation, phong cách hình ảnh và timing.',
  ];
  if (request.target === 'candidate') {
    instructions.push(
      'Đặc biệt kiểm tra hai ranh giới trước/sau mỗi beat được sửa với các beat được giữ nguyên.',
      'Nếu sửa hợp lý bắt buộc đụng phần ngoài editScope, đặt verdict=needs_scope_expansion và requiresScopeExpansion=true.',
    );
  } else {
    instructions.push(
      'Đây là review độc lập trên bản hiện tại, không có phạm vi chỉnh sửa bị khóa.',
      'Không dùng verdict=needs_scope_expansion và luôn đặt requiresScopeExpansion=false; dùng affectedBeatIds để chỉ rõ nơi người dùng nên xem.',
    );
  }
  return [
    ...instructions,
    JSON.stringify(
      request.target === 'candidate'
        ? {
            reviewTarget: request.target,
            topicInput: request.topicInput,
            outline: promptOutline(request.outline),
            guidance: request.guidance,
            editScope: request.scope,
            originalPlan: request.baseContent,
            appliedPatch: request.patch,
            reviewedPlan: request.content,
          }
        : {
            reviewTarget: request.target,
            topicInput: request.topicInput,
            outline: promptOutline(request.outline),
            reviewedPlan: request.content,
          },
    ),
  ].join('\n');
}

function mapStructuredError(error: CodexStructuredGenerationError) {
  if (error.reason === 'timeout') {
    return new VoiceVisualRevisionError(
      'CODEX_VOICE_VISUAL_REVISION_TIMEOUT',
      'Codex mất quá nhiều thời gian để tạo hoặc kiểm tra đề xuất.',
      {cause: error},
    );
  }
  if (error.reason === 'tool_used') {
    return new VoiceVisualRevisionError(
      'CODEX_VOICE_VISUAL_REVISION_TOOL_USED',
      'Codex đã cố dùng công cụ trong khi chỉnh kế hoạch voice–visual.',
      {cause: error},
    );
  }
  return new VoiceVisualRevisionError(
    'CODEX_VOICE_VISUAL_REVISION_FAILED',
    error.message || 'Codex không hoàn tất được đề xuất chỉnh sửa.',
    {cause: error},
  );
}

export function createCodexVoiceVisualRevisionService(
  client: CodexAppServerClient,
  options: {runtimeDirectory?: string; timeoutMs?: number} = {},
): VoiceVisualRevisionService {
  const runtimeDirectory = path.resolve(
    options.runtimeDirectory ?? path.join(os.tmpdir(), 'pad-studio-ai-runtime'),
  );
  async function review(
    request: VoiceVisualReviewRequest,
  ): Promise<VoiceVisualReviewResult> {
    try {
      const reasoningEffort = reviewReasoningEffort(
        request.reasoningEffort,
      );
      const reviewer = await runCodexStructuredGeneration({
        client,
        runtimeDirectory,
        timeoutMs:
          options.timeoutMs ??
          (request.target === 'candidate'
            ? Math.min(
                codexGenerationTimeoutMs(reasoningEffort),
                VOICE_VISUAL_CANDIDATE_REVIEW_TIMEOUT_MS,
              )
            : codexGenerationTimeoutMs(reasoningEffort)),
        outputSchema: coherenceOutputSchema,
        prompt: buildReviewPrompt(request),
        baseInstructions:
          'Bạn kiểm định tính mạch lạc voice–visual cho PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
        developerInstructions:
          'Review toàn bộ nội dung, chỉ ra đúng beat liên quan và phân biệt lỗi thực sự với sở thích diễn đạt. Bạn chỉ tư vấn, không quyết định thay người dùng.',
        model: request.model,
        reasoningEffort,
      });
      let reviewerJson: unknown;
      try {
        reviewerJson = JSON.parse(reviewer.responseText);
      } catch (error) {
        throw new VoiceVisualRevisionError(
          'CODEX_VOICE_VISUAL_COHERENCE_INVALID_RESPONSE',
          'Codex trả về kết quả kiểm tra mạch lạc không đúng định dạng.',
          {cause: error},
        );
      }
      const parsedReview = VoiceVisualCoherenceReviewSchema.safeParse(
        reviewerJson,
      );
      if (!parsedReview.success) {
        throw new VoiceVisualRevisionError(
          'CODEX_VOICE_VISUAL_COHERENCE_INVALID_RESPONSE',
          'Kết quả kiểm tra mạch lạc chưa đúng cấu trúc yêu cầu.',
          {cause: parsedReview.error},
        );
      }
      const coherence = request.target === 'current'
        ? {
            ...parsedReview.data,
            verdict:
              parsedReview.data.verdict === 'needs_scope_expansion'
                ? 'warning' as const
                : parsedReview.data.verdict,
            issues: parsedReview.data.issues.map(issue => ({
              ...issue,
              requiresScopeExpansion: false,
            })),
          }
        : parsedReview.data;
      return {
        coherence,
        model: reviewer.model,
        usage: reviewer.usage,
      };
    } catch (error) {
      if (error instanceof VoiceVisualRevisionError) throw error;
      if (error instanceof CodexStructuredGenerationError) {
        throw mapStructuredError(error);
      }
      throw new VoiceVisualRevisionError(
        'CODEX_VOICE_VISUAL_COHERENCE_FAILED',
        'Không thể kiểm tra kế hoạch voice–visual bằng Codex.',
        {cause: error},
      );
    }
  }
  return {
    review,
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
            'Bạn là biên tập viên voice–visual của PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
          developerInstructions:
            'Đọc rộng nhưng sửa hẹp. Giữ nguyên mọi phần tốt, mọi ID và cấu trúc. Chất lượng bản ghép quan trọng hơn viết lại cho khác.',
          model: request.model,
          reasoningEffort: request.reasoningEffort,
        });
        let parsedPatch:
          | ReturnType<typeof parseVoiceVisualPatch>
          | null = null;
        let initialIssues: Array<{path: PropertyKey[]; message: string}> = [];
        try {
          parsedPatch = parseVoiceVisualPatch(editor.responseText);
          if (!parsedPatch.success) {
            initialIssues = parsedPatch.error.issues;
          }
        } catch (error) {
          initialIssues = [{
            path: [],
            message:
              error instanceof Error
                ? error.message
                : 'JSON không hợp lệ.',
          }];
        }

        if (!parsedPatch?.success) {
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
              initialIssues,
            ),
            baseInstructions:
              'Bạn sửa một JSON patch voice–visual cho PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
            developerInstructions:
              'Chỉ sửa cấu trúc phản hồi và các giá trị sai schema. Không mở rộng editScope, không đổi ID và không viết lại thêm nội dung.',
            model: request.model,
            reasoningEffort: request.reasoningEffort,
          });
          const combinedUsage = addUsage(editor.usage, repaired.usage);
          const combinedModel = [...new Set([editor.model, repaired.model])]
            .join(', ')
            .slice(0, 160);
          editor = {
            ...repaired,
            model: combinedModel,
            usage: combinedUsage,
          };
          try {
            parsedPatch = parseVoiceVisualPatch(repaired.responseText);
          } catch (error) {
            throw new VoiceVisualRevisionError(
              'CODEX_VOICE_VISUAL_REVISION_INVALID_RESPONSE',
              'Codex chưa sửa được patch JSON sau lượt tự khắc phục.',
              {cause: error},
            );
          }
        }
        if (!parsedPatch.success) {
          throw new VoiceVisualRevisionError(
            'CODEX_VOICE_VISUAL_REVISION_INVALID_RESPONSE',
            'Codex chưa sửa được cấu trúc patch sau lượt tự khắc phục.',
            {cause: parsedPatch.error},
          );
        }
        const content = applyVoiceVisualPatch(
          request.baseContent,
          request.scope,
          parsedPatch.data,
        );

        let coherence: VoiceVisualCoherenceReview;
        let reviewerUsage: CodexTokenUsage | null = null;
        try {
          const reviewed = await review({
            target: 'candidate',
            topicInput: request.topicInput,
            outline: request.outline,
            baseContent: request.baseContent,
            content,
            scope: request.scope,
            guidance: request.guidance,
            patch: parsedPatch.data,
            model: request.model,
            reasoningEffort: request.reasoningEffort,
          });
          coherence = reviewed.coherence;
          reviewerUsage = reviewed.usage;
        } catch (error) {
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
                'Xem trước candidate và chạy lại góp ý toàn bộ nếu cần kiểm tra thêm.',
              affectedBeatIds: request.scope.beats.map(
                item => item.beatId,
              ),
              requiresScopeExpansion: false,
            }],
          };
          if (
            !(error instanceof VoiceVisualRevisionError) &&
            !(error instanceof CodexStructuredGenerationError)
          ) {
            throw error;
          }
        }
        return {
          patch: parsedPatch.data,
          content,
          coherence,
          model: editor.model,
          editorUsage: editor.usage,
          reviewerUsage,
        };
      } catch (error) {
        if (error instanceof VoiceVisualRevisionError) throw error;
        if (error instanceof CodexStructuredGenerationError) {
          throw mapStructuredError(error);
        }
        throw new VoiceVisualRevisionError(
          'CODEX_VOICE_VISUAL_REVISION_FAILED',
          'Không thể tạo đề xuất chỉnh sửa bằng Codex.',
          {cause: error},
        );
      }
    },
  };
}
