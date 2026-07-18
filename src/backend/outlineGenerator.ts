import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import type {
  CodexTokenUsage,
  TeachingOutline,
  TeachingOutlineContent,
  TopicInput,
} from '../shared/topic.ts';
import {
  narrationDurationTargets,
  targetNarrationTokenCount,
} from '../shared/narrationTiming.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  CodexStructuredGenerationError,
  DEFAULT_CODEX_GENERATION_TIMEOUT_MS,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const OUTLINE_PROMPT_VERSION = 'outline-v2';

const generatedOutlineSchema = z
  .object({
    brief: z
      .object({
        summary: z.string().trim().min(12).max(700),
        assumptions: z.array(z.string().trim().min(3).max(220)).max(6),
      })
      .strict(),
    centralMessage: z.string().trim().min(10).max(400),
    sections: z
      .array(
        z
          .object({
            title: z.string().trim().min(3).max(120),
            goal: z.string().trim().min(6).max(280),
            content: z.string().trim().min(12).max(900),
            estimatedSeconds: z.number().int().min(10).max(240),
          })
          .strict(),
      )
      .min(2)
      .max(10),
  })
  .strict();

const outputJsonSchema = z.toJSONSchema(generatedOutlineSchema, {
  target: 'draft-7',
});

const durationInstructions: Record<TopicInput['duration'], string> = {
  concise: '60–120 giây, mục tiêu 90 giây, thường 2–4 ý',
  standard: '180–300 giây, mục tiêu 240 giây, thường 4–6 ý',
  deep: '360–480 giây, mục tiêu 420 giây, thường 5–8 ý',
};

export interface OutlineGenerationRequest {
  topicInput: TopicInput;
  guidance?: string;
  currentOutline?: TeachingOutline;
}

export interface OutlineGenerationResult {
  content: TeachingOutlineContent;
  model: string;
  usage: CodexTokenUsage | null;
}

export interface OutlineGenerator {
  generate(request: OutlineGenerationRequest): Promise<OutlineGenerationResult>;
}

export class OutlineGenerationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function currentOutlineForPrompt(outline: TeachingOutline) {
  return {
    brief: outline.brief,
    centralMessage: outline.centralMessage,
    sections: outline.sections.map(({id: _id, ...section}) => section),
  };
}

function buildPrompt(request: OutlineGenerationRequest) {
  const durationTarget = narrationDurationTargets[request.topicInput.duration];
  const payload: Record<string, unknown> = {
    topicInput: request.topicInput,
    targetDuration: durationInstructions[request.topicInput.duration],
    narrationBudget: {
      ...durationTarget,
      minimumWhitespaceTokenCount: targetNarrationTokenCount(
        durationTarget.minimumSeconds,
      ),
      targetWhitespaceTokenCount: targetNarrationTokenCount(
        durationTarget.targetSeconds,
      ),
      maximumWhitespaceTokenCount: targetNarrationTokenCount(
        durationTarget.maximumSeconds,
      ),
      targetSpeakingRate: '180 đơn vị phân tách bằng khoảng trắng mỗi phút',
    },
  };

  if (request.guidance) {
    payload.guidance = request.guidance;
    if (request.currentOutline) {
      payload.currentOutline = currentOutlineForPrompt(request.currentOutline);
    }
  }

  return [
    'Tạo mạch giảng tiếng Việt từ JSON sau.',
    'Giữ đúng ý người dùng; nêu giả định khi đầu vào chưa rõ.',
    'Mỗi ý phải có vai trò riêng; phân bổ estimatedSeconds sao cho tổng gần targetSeconds và đủ ngân sách narration tương ứng.',
    'Không viết lời thoại, code, cảnh quay, caption hay hướng dẫn animation.',
    JSON.stringify(payload),
  ].join('\n');
}

function allocateTargetDurations(
  sections: Array<{estimatedSeconds: number}>,
  targetSeconds: number,
) {
  const totalWeight = sections.reduce(
    (total, section) => total + section.estimatedSeconds,
    0,
  );
  const durations = sections.map((section) =>
    Math.max(
      10,
      Math.min(
        240,
        Math.round((section.estimatedSeconds / totalWeight) * targetSeconds),
      ),
    ),
  );
  let difference =
    targetSeconds - durations.reduce((total, value) => total + value, 0);
  while (difference !== 0) {
    const direction = Math.sign(difference);
    const index = durations.findIndex((value) =>
      direction > 0 ? value < 240 : value > 10,
    );
    if (index < 0) break;
    durations[index] = durations[index]! + direction;
    difference -= direction;
  }
  return durations;
}

function mapStructuredError(error: CodexStructuredGenerationError) {
  if (error.reason === 'timeout') {
    return new OutlineGenerationError(
      'CODEX_OUTLINE_TIMEOUT',
      'Codex mất quá nhiều thời gian để tạo mạch giảng.',
      {cause: error},
    );
  }
  if (error.reason === 'tool_used') {
    return new OutlineGenerationError(
      'CODEX_OUTLINE_TOOL_USED',
      'Codex đã cố dùng công cụ trong khi tạo mạch giảng.',
      {cause: error},
    );
  }
  if (error.reason === 'empty_response') {
    return new OutlineGenerationError(
      'CODEX_OUTLINE_INVALID_RESPONSE',
      'Codex không trả về nội dung mạch giảng.',
      {cause: error},
    );
  }

  return new OutlineGenerationError(
    'CODEX_OUTLINE_GENERATION_FAILED',
    error.message || 'Codex không hoàn tất được mạch giảng.',
    {cause: error},
  );
}

export function createCodexOutlineGenerator(
  client: CodexAppServerClient,
  options: {
    runtimeDirectory?: string;
    timeoutMs?: number;
  } = {},
): OutlineGenerator {
  const runtimeDirectory = path.resolve(
    options.runtimeDirectory ??
      path.join(os.tmpdir(), 'pad-studio-ai-runtime'),
  );
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_CODEX_GENERATION_TIMEOUT_MS;

  return {
    async generate(request) {
      try {
        const generated = await runCodexStructuredGeneration({
          client,
          runtimeDirectory,
          timeoutMs,
          outputSchema: outputJsonSchema,
          prompt: buildPrompt(request),
          baseInstructions:
            'Bạn lập mạch giảng cho PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
          developerInstructions:
            'Ưu tiên bản chất, trực giác và thứ tự dễ hiểu. AI chỉ đề xuất; người dùng sẽ review.',
        });

        let responseJson: unknown;
        try {
          responseJson = JSON.parse(generated.responseText);
        } catch (error) {
          throw new OutlineGenerationError(
            'CODEX_OUTLINE_INVALID_RESPONSE',
            'Codex trả về mạch giảng không đúng định dạng.',
            {cause: error},
          );
        }

        const parsedOutline = generatedOutlineSchema.safeParse(responseJson);
        if (!parsedOutline.success) {
          throw new OutlineGenerationError(
            'CODEX_OUTLINE_INVALID_RESPONSE',
            'Codex trả về mạch giảng chưa đúng cấu trúc yêu cầu.',
            {cause: parsedOutline.error},
          );
        }

        const targetDurations = allocateTargetDurations(
          parsedOutline.data.sections,
          narrationDurationTargets[request.topicInput.duration].targetSeconds,
        );
        return {
          content: {
            ...parsedOutline.data,
            sections: parsedOutline.data.sections.map((section, index) => ({
              id: randomUUID(),
              ...section,
              estimatedSeconds: targetDurations[index]!,
            })),
          },
          model: generated.model,
          usage: generated.usage,
        };
      } catch (error) {
        if (error instanceof OutlineGenerationError) throw error;
        if (error instanceof CodexStructuredGenerationError) {
          throw mapStructuredError(error);
        }

        throw new OutlineGenerationError(
          'CODEX_OUTLINE_GENERATION_FAILED',
          'Không thể tạo mạch giảng bằng Codex.',
          {cause: error},
        );
      }
    },
  };
}
