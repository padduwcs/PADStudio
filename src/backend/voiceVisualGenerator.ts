import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import type {
  CodexTokenUsage,
  TeachingOutline,
  TopicInput,
  VoiceVisualPlan,
  VoiceVisualPlanContent,
} from '../shared/topic.ts';
import {videoBackgroundTone} from '../shared/topic.ts';
import {
  DEFAULT_NARRATION_CALIBRATION,
  plannedBeatDurationSeconds,
  resolveNarrationDurationTarget,
  targetNarrationTokenCount,
} from '../shared/narrationTiming.ts';
import {
  hasSafeTotalBeatCount,
  pipelineSafetyLimits,
} from '../shared/pipelineLimits.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  CodexStructuredGenerationError,
  codexGenerationTimeoutMs,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const VOICE_VISUAL_PROMPT_VERSION = 'voice-visual-v6';

const generatedVoiceVisualSchema = z
  .object({
    voiceDirection: z.string().trim().min(6),
    visualDirection: z.string().trim().min(6),
    sections: z
      .array(
        z
          .object({
            beats: z
              .array(
                z
                  .object({
                    voiceover: z.string().trim().min(12),
                    spokenVoiceover: z.string().trim().min(1),
                    visualDescription: z.string().trim().min(12),
                    animationDescription: z.string().trim().min(8),
                  })
                  .strict(),
              )
              .min(pipelineSafetyLimits.minimumBeatsPerSection)
              .max(pipelineSafetyLimits.maximumBeatsPerSection),
          })
          .strict(),
      )
      .min(pipelineSafetyLimits.minimumSections)
      .max(pipelineSafetyLimits.maximumSections),
  })
  .strict()
  .refine(
    (value) => hasSafeTotalBeatCount(value.sections),
    `Tổng số beat vượt quá cầu chì an toàn ${pipelineSafetyLimits.maximumTotalBeats}.`,
  );

const outputJsonSchema = z.toJSONSchema(generatedVoiceVisualSchema, {
  target: 'draft-7',
});

function outputSchemaForOutline(outline: TeachingOutline) {
  const schema = structuredClone(outputJsonSchema) as {
    properties?: {
      sections?: {minItems?: number; maxItems?: number};
    };
  };
  const sections = schema.properties?.sections;
  if (sections) {
    sections.minItems = outline.sections.length;
    sections.maxItems = outline.sections.length;
  }
  return schema;
}

export interface VoiceVisualGenerationRequest {
  topicInput: TopicInput;
  outline: TeachingOutline;
  model?: string;
  reasoningEffort?: string;
  timingCalibration?: VoiceVisualPlanContent['timingCalibration'];
  guidance?: string;
  currentPlan?: VoiceVisualPlan;
}

export interface VoiceVisualGenerationResult {
  content: VoiceVisualPlanContent;
  model: string;
  usage: CodexTokenUsage | null;
}

export interface VoiceVisualGenerator {
  generate(
    request: VoiceVisualGenerationRequest,
  ): Promise<VoiceVisualGenerationResult>;
}

export class VoiceVisualGenerationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function outlineForPrompt(outline: TeachingOutline) {
  return {
    centralMessage: outline.centralMessage,
    sections: outline.sections.map(
      ({id: _id, title, goal, content, estimatedSeconds}) => ({
        title,
        goal,
        content,
        targetDurationSeconds: estimatedSeconds,
        targetNarrationTokenCount:
          targetNarrationTokenCount(estimatedSeconds),
      }),
    ),
  };
}

function currentPlanForPrompt(plan: VoiceVisualPlan) {
  return {
    voiceDirection: plan.voiceDirection,
    visualDirection: plan.visualDirection,
    timingCalibration: plan.timingCalibration,
    sections: plan.sections.map((section) => ({
      beats: section.beats.map(({id: _id, durationSeconds: _duration, ...beat}) => beat),
    })),
  };
}

function buildPrompt(request: VoiceVisualGenerationRequest) {
  const durationTarget = resolveNarrationDurationTarget(request.topicInput);
  const payload: Record<string, unknown> = {
    topicInput: request.topicInput,
    outline: outlineForPrompt(request.outline),
    narrationBudget: {
      ...durationTarget,
      targetWhitespaceTokenCount: targetNarrationTokenCount(
        durationTarget.targetSeconds,
      ),
    },
    timingCalibration:
      request.timingCalibration ?? {
        source: 'default',
        ...DEFAULT_NARRATION_CALIBRATION,
      },
  };

  if (request.guidance) {
    payload.guidance = request.guidance;
    if (request.currentPlan) {
      payload.currentPlan = currentPlanForPrompt(request.currentPlan);
    }
  }

  return [
    'Tạo kế hoạch voice–visual tiếng Việt từ JSON sau.',
    'Giữ nguyên số lượng và thứ tự các section của outline; mỗi phần tử output tương ứng đúng một section.',
    `Tự chọn số beat cần thiết cho từng section theo nội dung và targetNarrationTokenCount; mỗi beat chỉ truyền đạt một ý. Không ép vào 1–4 beat. Cầu chì kỹ thuật là ${pipelineSafetyLimits.maximumBeatsPerSection} beat/section và ${pipelineSafetyLimits.maximumTotalBeats} beat/project.`,
    'voiceover là lời kể tự nhiên sẵn sàng cho TTS, không chứa chỉ dẫn sân khấu.',
    'Mỗi beat phải có spokenVoiceover là đúng nội dung voiceover nhưng ở dạng ElevenLabs có thể đọc ổn định. Giữ nguyên chính xác mọi từ, cụm từ, tên riêng, chữ viết tắt và thuật ngữ tiếng Anh; không dịch, không Việt hóa và không viết lại chúng theo cách phát âm tiếng Việt. Chỉ phiên âm ký hiệu, công thức, toán tử, truy cập mảng và phần không phải chữ có thể bị đọc sai thành âm tiết tự nhiên. Ví dụ Binary Search giữ nguyên “Binary Search”, API giữ nguyên “API”; O(n) → “ô nờ”, O(n^2) → “ô nờ bình”, O(log n) → “ô lốc nờ”, a[i] → “a tại chỉ số i”. Không để ký hiệu kỹ thuật khó đọc trong spokenVoiceover.',
    'Viết toàn bộ voiceover như một bài nói liên tục: section sau nối trực tiếp ý và nhịp của section trước, không lặp mở bài, không tự giới thiệu lại và không kết luận riêng từng section.',
    'Bám sát targetNarrationTokenCount của từng section và tổng narrationBudget; đây là ngân sách các đơn vị phân tách bằng khoảng trắng, không phải số từ ngôn ngữ học.',
    'visualDescription mô tả điều người xem cần thấy; animationDescription mô tả thay đổi hoặc chuyển động cụ thể.',
    'Visual phải tự truyền đạt ý cùng voice, không phụ thuộc caption, không hiển thị source code và không thêm chi tiết trang trí vô nghĩa.',
    `Toàn bộ visual phải phù hợp background ${request.topicInput.background.color} (${videoBackgroundTone(request.topicInput.background)}): chọn màu chữ, đường nét, thẻ và điểm nhấn có độ tương phản rõ, không tự thay nền chính sang tone đối nghịch.`,
    'Không tự ước lượng duration; PAD Studio sẽ tính timing từ chính lời thoại.',
    JSON.stringify(payload),
  ].join('\n');
}

function mapStructuredError(error: CodexStructuredGenerationError) {
  if (error.reason === 'timeout') {
    return new VoiceVisualGenerationError(
      'CODEX_VOICE_VISUAL_TIMEOUT',
      'Codex mất quá nhiều thời gian để tạo kế hoạch voice–visual.',
      {cause: error},
    );
  }
  if (error.reason === 'tool_used') {
    return new VoiceVisualGenerationError(
      'CODEX_VOICE_VISUAL_TOOL_USED',
      'Codex đã cố dùng công cụ trong khi tạo kế hoạch voice–visual.',
      {cause: error},
    );
  }
  if (error.reason === 'empty_response') {
    return new VoiceVisualGenerationError(
      'CODEX_VOICE_VISUAL_INVALID_RESPONSE',
      'Codex không trả về kế hoạch voice–visual.',
      {cause: error},
    );
  }

  return new VoiceVisualGenerationError(
    'CODEX_VOICE_VISUAL_GENERATION_FAILED',
    error.message || 'Codex không hoàn tất được kế hoạch voice–visual.',
    {cause: error},
  );
}

export function createCodexVoiceVisualGenerator(
  client: CodexAppServerClient,
  options: {
    runtimeDirectory?: string;
    timeoutMs?: number;
  } = {},
): VoiceVisualGenerator {
  const runtimeDirectory = path.resolve(
    options.runtimeDirectory ??
      path.join(os.tmpdir(), 'pad-studio-ai-runtime'),
  );
  const configuredTimeoutMs = options.timeoutMs;

  return {
    async generate(request) {
      try {
        const generated = await runCodexStructuredGeneration({
          client,
          runtimeDirectory,
          timeoutMs:
            configuredTimeoutMs ??
            codexGenerationTimeoutMs(request.reasoningEffort),
          outputSchema: outputSchemaForOutline(request.outline),
          prompt: buildPrompt(request),
          baseInstructions:
            'Bạn lập kế hoạch voice–visual cho PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
          developerInstructions:
            'Ưu tiên sự rõ ràng, chính xác và đồng bộ voice với visual. Không dùng caption để gánh nội dung chính. AI chỉ đề xuất; người dùng sẽ review.',
          model: request.model,
          reasoningEffort: request.reasoningEffort,
        });

        let responseJson: unknown;
        try {
          responseJson = JSON.parse(generated.responseText);
        } catch (error) {
          throw new VoiceVisualGenerationError(
            'CODEX_VOICE_VISUAL_INVALID_RESPONSE',
            'Codex trả về kế hoạch voice–visual không đúng định dạng.',
            {cause: error},
          );
        }

        const parsedPlan = generatedVoiceVisualSchema.safeParse(responseJson);
        if (!parsedPlan.success) {
          throw new VoiceVisualGenerationError(
            'CODEX_VOICE_VISUAL_INVALID_RESPONSE',
            'Codex trả về kế hoạch voice–visual chưa đúng cấu trúc yêu cầu.',
            {cause: parsedPlan.error},
          );
        }
        if (
          parsedPlan.data.sections.length !== request.outline.sections.length
        ) {
          throw new VoiceVisualGenerationError(
            'CODEX_VOICE_VISUAL_INVALID_RESPONSE',
            'Kế hoạch voice–visual không bao phủ đúng các ý trong mạch giảng.',
          );
        }

        return {
          content: {
            voiceDirection: parsedPlan.data.voiceDirection,
            visualDirection: parsedPlan.data.visualDirection,
            timingCalibration:
              request.timingCalibration ?? {
                source: 'default',
                ...DEFAULT_NARRATION_CALIBRATION,
                voiceId: null,
                modelId: null,
                voiceName: null,
                sampleCount: 0,
              },
            sections: parsedPlan.data.sections.map((section, index) => ({
              outlineSectionId: request.outline.sections[index]!.id,
              beats: section.beats.map((beat) => {
                return {
                  id: randomUUID(),
                  ...beat,
                  visualHoldSeconds: 0,
                  durationSeconds: plannedBeatDurationSeconds(
                    beat.spokenVoiceover,
                    0,
                    request.timingCalibration ??
                      DEFAULT_NARRATION_CALIBRATION,
                  ),
                };
              }),
            })),
          },
          model: generated.model,
          usage: generated.usage,
        };
      } catch (error) {
        if (error instanceof VoiceVisualGenerationError) throw error;
        if (error instanceof CodexStructuredGenerationError) {
          throw mapStructuredError(error);
        }

        throw new VoiceVisualGenerationError(
          'CODEX_VOICE_VISUAL_GENERATION_FAILED',
          'Không thể tạo kế hoạch voice–visual bằng Codex.',
          {cause: error},
        );
      }
    },
  };
}
