import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {
  NarrationDraftSchema,
  type CodexTokenUsage,
  type NarrationDraft,
  type TopicInput,
} from '../shared/topic.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  codexGenerationTimeoutMs,
  CodexStructuredGenerationError,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const NARRATION_DRAFT_PROMPT_VERSION = 'narration-draft-v1';

const outputJsonSchema = z.toJSONSchema(NarrationDraftSchema, {
  target: 'draft-7',
});

export interface NarrationDraftGenerationRequest {
  topicInput: TopicInput;
  userGuidance?: string;
  model?: string;
  reasoningEffort?: string;
}

export interface NarrationDraftGenerationResult {
  draft: NarrationDraft;
  model: string;
  usage: CodexTokenUsage | null;
}

export interface NarrationDraftGenerator {
  generate(
    request: NarrationDraftGenerationRequest,
  ): Promise<NarrationDraftGenerationResult>;
}

export class NarrationDraftGenerationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function buildPrompt(request: NarrationDraftGenerationRequest) {
  return [
    'Viết một bản lời thoại hoàn chỉnh bằng tiếng Việt cho video giáo dục từ JSON đầu vào.',
    'Chỉ viết phần người dẫn sẽ nói. Không dùng Markdown, tiêu đề, gạch đầu dòng, chỉ dẫn cảnh, ngoặc chú thích, hay lời chào ngoài nội dung cần thiết.',
    'Bản lời thoại phải tự nhiên khi đọc thành tiếng, chính xác, có mở bài ngắn, diễn giải theo mạch rõ ràng, ví dụ khi hữu ích và kết thúc gọn.',
    'Tôn trọng chủ đề, background, khung hình và các ràng buộc trong topicInput. Không tự bịa số liệu, nguồn, kết quả hay định nghĩa không chắc chắn.',
    'Người dùng sẽ tự review và chỉnh sửa toàn bộ bản nháp trước bước chuẩn hóa cách đọc; đừng nói về quy trình đó trong lời thoại.',
    request.userGuidance
      ? 'Ưu tiên đúng góp ý trực tiếp của người dùng, miễn vẫn giữ tính chính xác và dễ hiểu.'
      : 'Tự chọn cách diễn đạt dễ hiểu, phù hợp người xem Việt Nam.',
    JSON.stringify({
      topicInput: request.topicInput,
      ...(request.userGuidance ? {userGuidance: request.userGuidance} : {}),
    }),
  ].join('\n');
}

function mapStructuredError(error: CodexStructuredGenerationError) {
  const code =
    error.reason === 'timeout'
      ? 'CODEX_NARRATION_DRAFT_TIMEOUT'
      : error.reason === 'tool_used'
        ? 'CODEX_NARRATION_DRAFT_TOOL_USED'
        : error.reason === 'empty_response'
          ? 'CODEX_NARRATION_DRAFT_INVALID_RESPONSE'
          : 'CODEX_NARRATION_DRAFT_FAILED';
  const message =
    error.reason === 'timeout'
      ? 'Codex mất quá nhiều thời gian để tạo lời thoại.'
      : error.reason === 'tool_used'
        ? 'Codex đã cố dùng công cụ trong lượt chỉ được phép viết lời thoại.'
        : error.reason === 'empty_response'
          ? 'Codex không trả về lời thoại.'
          : 'Codex không hoàn tất được bản lời thoại.';
  return new NarrationDraftGenerationError(code, message, {cause: error});
}

export function createCodexNarrationDraftGenerator(
  client: CodexAppServerClient,
  options: {runtimeDirectory?: string; timeoutMs?: number} = {},
): NarrationDraftGenerator {
  const runtimeDirectory = path.resolve(
    options.runtimeDirectory ?? path.join(os.tmpdir(), 'pad-studio-ai-runtime'),
  );

  return {
    async generate(request) {
      try {
        const generated = await runCodexStructuredGeneration({
          client,
          runtimeDirectory,
          timeoutMs:
            options.timeoutMs ??
            codexGenerationTimeoutMs(request.reasoningEffort),
          outputSchema: outputJsonSchema,
          prompt: buildPrompt(request),
          baseInstructions:
            'Bạn hỗ trợ viết lời thoại cho PAD Studio. Không dùng công cụ hay đọc tệp. Chỉ trả JSON đúng schema.',
          developerInstructions:
            'Đây chỉ là bản nháp để người dùng chỉnh sửa. Nội dung phải là lời nói liền mạch, bằng tiếng Việt, không kèm giải thích hoặc hướng dẫn sản xuất.',
          model: request.model,
          reasoningEffort: request.reasoningEffort,
        });
        let responseJson: unknown;
        try {
          responseJson = JSON.parse(generated.responseText);
        } catch (error) {
          throw new NarrationDraftGenerationError(
            'CODEX_NARRATION_DRAFT_INVALID_RESPONSE',
            'Codex trả về lời thoại không đúng định dạng.',
            {cause: error},
          );
        }
        const draft = NarrationDraftSchema.safeParse(responseJson);
        if (!draft.success) {
          throw new NarrationDraftGenerationError(
            'CODEX_NARRATION_DRAFT_INVALID_RESPONSE',
            'Codex trả về lời thoại chưa đúng cấu trúc yêu cầu.',
            {cause: draft.error},
          );
        }
        return {draft: draft.data, model: generated.model, usage: generated.usage};
      } catch (error) {
        if (error instanceof NarrationDraftGenerationError) throw error;
        if (error instanceof CodexStructuredGenerationError) {
          throw mapStructuredError(error);
        }
        throw new NarrationDraftGenerationError(
          'CODEX_NARRATION_DRAFT_FAILED',
          'Không thể tạo lời thoại bằng Codex.',
          {cause: error},
        );
      }
    },
  };
}
