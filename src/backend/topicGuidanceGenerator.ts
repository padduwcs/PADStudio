import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {
  TopicGuidanceSuggestionSchema,
  type CodexTokenUsage,
  type TopicGuidanceSuggestion,
  type TopicInput,
} from '../shared/topic.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  codexGenerationTimeoutMs,
  CodexStructuredGenerationError,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const TOPIC_GUIDANCE_PROMPT_VERSION = 'topic-guidance-v1';

const outputJsonSchema = z.toJSONSchema(TopicGuidanceSuggestionSchema, {
  target: 'draft-7',
});

export interface TopicGuidanceGenerationRequest {
  topicInput: TopicInput;
  model?: string;
  reasoningEffort?: string;
}

export interface TopicGuidanceGenerationResult {
  suggestion: TopicGuidanceSuggestion;
  model: string;
  usage: CodexTokenUsage | null;
}

export interface TopicGuidanceGenerator {
  generate(
    request: TopicGuidanceGenerationRequest,
  ): Promise<TopicGuidanceGenerationResult>;
}

export class TopicGuidanceGenerationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function buildPrompt(topicInput: TopicInput) {
  return [
    'Từ thông tin chủ đề trong JSON, đề xuất định hướng cho một video giáo dục bằng tiếng Việt.',
    'learningGoal phải mô tả kết quả học tập cụ thể mà người xem đạt được.',
    'videoDirection phải là một bản nháp giàu thông tin, có thể chỉnh sửa trực tiếp: cách mở đầu, mạch giải thích, nhịp điệu, phong cách hình ảnh, điểm cần nhấn mạnh và điều cần tránh khi phù hợp.',
    'suggestedAngles gồm các góc khai thác ngắn gọn để người dùng tham khảo; không lặp lại nguyên văn hai trường trên.',
    'Nếu người dùng đã nhập learningGoal hoặc videoDirection, hãy tôn trọng ràng buộc đó và phát triển chúng, không thay đổi ý định.',
    JSON.stringify({topicInput}),
  ].join('\n');
}

function mapStructuredError(error: CodexStructuredGenerationError) {
  const code =
    error.reason === 'timeout'
      ? 'CODEX_TOPIC_GUIDANCE_TIMEOUT'
      : error.reason === 'tool_used'
        ? 'CODEX_TOPIC_GUIDANCE_TOOL_USED'
        : error.reason === 'empty_response'
          ? 'CODEX_TOPIC_GUIDANCE_INVALID_RESPONSE'
          : 'CODEX_TOPIC_GUIDANCE_FAILED';
  return new TopicGuidanceGenerationError(
    code,
    error.reason === 'timeout'
      ? 'Codex mất quá nhiều thời gian để đề xuất định hướng.'
      : error.reason === 'tool_used'
        ? 'Codex đã cố dùng công cụ trong lượt chỉ được phép đề xuất nội dung.'
        : error.reason === 'empty_response'
          ? 'Codex không trả về nội dung định hướng.'
          : 'Codex không hoàn tất được đề xuất định hướng.',
    {cause: error},
  );
}

export function createCodexTopicGuidanceGenerator(
  client: CodexAppServerClient,
  options: {runtimeDirectory?: string; timeoutMs?: number} = {},
): TopicGuidanceGenerator {
  const runtimeDirectory = path.resolve(
    options.runtimeDirectory ??
      path.join(os.tmpdir(), 'pad-studio-ai-runtime'),
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
          prompt: buildPrompt(request.topicInput),
          baseInstructions:
            'Bạn hỗ trợ định hướng nội dung cho PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
          developerInstructions:
            'Đề xuất phải cụ thể, có giá trị biên tập và giữ đúng ý định của người dùng. Người dùng sẽ review và chỉnh sửa trước khi lưu.',
          model: request.model,
          reasoningEffort: request.reasoningEffort,
        });

        let responseJson: unknown;
        try {
          responseJson = JSON.parse(generated.responseText);
        } catch (error) {
          throw new TopicGuidanceGenerationError(
            'CODEX_TOPIC_GUIDANCE_INVALID_RESPONSE',
            'Codex trả về nội dung định hướng không đúng định dạng.',
            {cause: error},
          );
        }
        const suggestion = TopicGuidanceSuggestionSchema.safeParse(
          responseJson,
        );
        if (!suggestion.success) {
          throw new TopicGuidanceGenerationError(
            'CODEX_TOPIC_GUIDANCE_INVALID_RESPONSE',
            'Codex trả về nội dung định hướng chưa đúng cấu trúc yêu cầu.',
            {cause: suggestion.error},
          );
        }
        return {
          suggestion: suggestion.data,
          model: generated.model,
          usage: generated.usage,
        };
      } catch (error) {
        if (error instanceof TopicGuidanceGenerationError) throw error;
        if (error instanceof CodexStructuredGenerationError) {
          throw mapStructuredError(error);
        }
        throw new TopicGuidanceGenerationError(
          'CODEX_TOPIC_GUIDANCE_FAILED',
          'Không thể tạo định hướng chủ đề bằng Codex.',
          {cause: error},
        );
      }
    },
  };
}
