import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {
  MotionCanvasCoherenceReviewSchema,
  type MotionCanvasCoherenceReview,
  type MotionCanvasEditScope,
} from '../shared/motionCanvasHistory.ts';
import type {
  CodexTokenUsage,
  TeachingOutline,
  TopicInput,
  VoiceVisualPlan,
} from '../shared/topic.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  CodexStructuredGenerationError,
  codexGenerationTimeoutMs,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const MOTION_CANVAS_COHERENCE_PROMPT_VERSION =
  'motion-canvas-coherence-v2';
// This review is advisory and runs after the candidate has compiled. A valid
// workspace must not be held behind the much longer source-generation timeout.
export const MOTION_CANVAS_COHERENCE_TIMEOUT_MS = 90_000;

const outputSchema = z.toJSONSchema(MotionCanvasCoherenceReviewSchema, {
  target: 'draft-7',
});

export interface MotionCanvasReviewScene {
  sceneId: string;
  outlineSectionId: string;
  name: string;
  changed: boolean;
  sourceExcerpt: string;
}

export interface MotionCanvasRevisionReviewRequest {
  topicInput: TopicInput;
  outline: TeachingOutline;
  voiceVisualPlan: VoiceVisualPlan;
  scope: MotionCanvasEditScope;
  guidance: string;
  scenes: MotionCanvasReviewScene[];
  model?: string;
  reasoningEffort?: string;
}

export interface MotionCanvasRevisionReviewResult {
  coherence: MotionCanvasCoherenceReview;
  model: string;
  usage: CodexTokenUsage | null;
}

export interface MotionCanvasRevisionReviewService {
  review(
    request: MotionCanvasRevisionReviewRequest,
  ): Promise<MotionCanvasRevisionReviewResult>;
}

export class MotionCanvasRevisionReviewError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function buildPrompt(request: MotionCanvasRevisionReviewRequest) {
  const changedIndexes = request.scenes
    .map((scene, index) => scene.changed ? index : -1)
    .filter(index => index >= 0);
  const relevantIndexes = new Set(
    changedIndexes.flatMap(index => [index - 1, index, index + 1]),
  );
  return [
    'Review tính mạch lạc của chuỗi scene Motion Canvas sau khi chỉ một số scene được sinh lại.',
    'Không viết lại code. Chỉ báo cáo lỗi thực sự có ý nghĩa.',
    'Đối chiếu outline, lời kể, visual/animation từng beat và source scene để kiểm tra mạch kể, tính đúng ý, phong cách màu/chữ/bố cục, chuyển tiếp và timing.',
    'Tập trung source của scene changed và nội dung hai scene kề bên. Danh sách flow toàn video vẫn có mặt để giữ ngữ cảnh nhưng source scene không đổi không cần đọc lại.',
    'Nếu sửa hợp lý bắt buộc sinh lại scene ngoài scope, đặt verdict=needs_scope_expansion và requiresScopeExpansion=true.',
    JSON.stringify({
      topicInput: request.topicInput,
      guidance: request.guidance,
      editScope: request.scope,
      outline: {
        centralMessage: request.outline.centralMessage,
        sections: request.outline.sections.map(section => ({
          id: section.id,
          title: section.title,
          goal: section.goal,
          content: section.content,
        })),
      },
      voiceVisual: {
        visualDirection: request.voiceVisualPlan.visualDirection,
        sections: request.voiceVisualPlan.sections
          .map((section, index) => ({
            index,
            relation: changedIndexes.includes(index)
              ? 'changed'
              : changedIndexes.some(
                    changedIndex => Math.abs(changedIndex - index) === 1,
                  )
                ? 'boundary'
                : 'unchanged',
            outlineSectionId: section.outlineSectionId,
            beats: section.beats,
          }))
          .filter(section => relevantIndexes.has(section.index)),
      },
      reviewedScenes: request.scenes
        .map((scene, index) => ({...scene, index}))
        .filter(scene => relevantIndexes.has(scene.index)),
    }),
  ].join('\n');
}

function reviewReasoningEffort(effort?: string) {
  return ['high', 'xhigh', 'max', 'ultra'].includes(effort ?? '')
    ? 'medium'
    : effort;
}

function mapError(error: CodexStructuredGenerationError) {
  if (error.reason === 'timeout') {
    return new MotionCanvasRevisionReviewError(
      'CODEX_MOTION_CANVAS_COHERENCE_TIMEOUT',
      'Codex mất quá nhiều thời gian để kiểm tra candidate scene.',
      {cause: error},
    );
  }
  if (error.reason === 'tool_used') {
    return new MotionCanvasRevisionReviewError(
      'CODEX_MOTION_CANVAS_COHERENCE_TOOL_USED',
      'Codex đã cố dùng công cụ trong khi kiểm tra candidate scene.',
      {cause: error},
    );
  }
  return new MotionCanvasRevisionReviewError(
    'CODEX_MOTION_CANVAS_COHERENCE_FAILED',
    error.message || 'Codex không hoàn tất kiểm tra candidate scene.',
    {cause: error},
  );
}

export function createCodexMotionCanvasRevisionReviewService(
  client: CodexAppServerClient,
  options: {runtimeDirectory?: string; timeoutMs?: number} = {},
): MotionCanvasRevisionReviewService {
  const runtimeDirectory = path.resolve(
    options.runtimeDirectory ?? path.join(os.tmpdir(), 'pad-studio-ai-runtime'),
  );
  return {
    async review(request) {
      try {
        const result = await runCodexStructuredGeneration({
          client,
          runtimeDirectory,
          timeoutMs:
            options.timeoutMs ??
            Math.min(
              codexGenerationTimeoutMs(
                reviewReasoningEffort(request.reasoningEffort),
              ),
              MOTION_CANVAS_COHERENCE_TIMEOUT_MS,
            ),
          outputSchema,
          prompt: buildPrompt(request),
          baseInstructions:
            'Bạn kiểm định mạch lạc chuỗi scene cho PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
          developerInstructions:
            'Review toàn bộ chuỗi nhưng tập trung ranh giới scene sửa/giữ. Phân biệt lỗi thật với sở thích thẩm mỹ.',
          model: request.model,
          reasoningEffort: reviewReasoningEffort(
            request.reasoningEffort,
          ),
        });
        let json: unknown;
        try {
          json = JSON.parse(result.responseText);
        } catch (error) {
          throw new MotionCanvasRevisionReviewError(
            'CODEX_MOTION_CANVAS_COHERENCE_INVALID_RESPONSE',
            'Codex trả về kết quả kiểm tra scene không đúng định dạng.',
            {cause: error},
          );
        }
        const parsed = MotionCanvasCoherenceReviewSchema.safeParse(json);
        if (!parsed.success) {
          throw new MotionCanvasRevisionReviewError(
            'CODEX_MOTION_CANVAS_COHERENCE_INVALID_RESPONSE',
            'Kết quả kiểm tra candidate scene chưa đúng cấu trúc.',
            {cause: parsed.error},
          );
        }
        return {coherence: parsed.data, model: result.model, usage: result.usage};
      } catch (error) {
        if (error instanceof MotionCanvasRevisionReviewError) throw error;
        if (error instanceof CodexStructuredGenerationError) {
          throw mapError(error);
        }
        throw new MotionCanvasRevisionReviewError(
          'CODEX_MOTION_CANVAS_COHERENCE_FAILED',
          'Không thể kiểm tra mạch lạc của candidate scene.',
          {cause: error},
        );
      }
    },
  };
}
