import {z} from 'zod';
import type {ElevenLabsConnectionStatus} from '../shared/elevenLabs.ts';

const ELEVENLABS_API_ORIGIN = 'https://api.elevenlabs.io';
const DEFAULT_TIMEOUT_MS = 10_000;

const subscriptionSchema = z
  .object({
    tier: z.string().min(1).max(80),
    status: z.string().min(1).max(80),
    character_count: z.number().int().nonnegative(),
    character_limit: z.number().int().nonnegative(),
    next_character_count_reset_unix: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
  })
  .passthrough();

const modelSchema = z
  .object({
    model_id: z.string().min(1).max(160),
    can_do_text_to_speech: z.boolean(),
    languages: z
      .array(
        z
          .object({
            language_id: z.string().min(1).max(20),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const modelsSchema = z.array(modelSchema).min(1);

export interface ElevenLabsConnectionService {
  verifyConnection(): Promise<ElevenLabsConnectionStatus>;
}

function failedStatus(
  state: Exclude<ElevenLabsConnectionStatus['state'], 'connected'>,
  message: string,
  checkedAt: string,
): ElevenLabsConnectionStatus {
  return {state, message, checkedAt};
}

function responseFailure(
  status: number,
  checkedAt: string,
): ElevenLabsConnectionStatus {
  if (status === 401) {
    return failedStatus(
      'disconnected',
      'ElevenLabs không chấp nhận API key hiện tại.',
      checkedAt,
    );
  }

  if (status === 403) {
    return failedStatus(
      'restricted',
      'API key bị giới hạn quyền hoặc địa chỉ IP. Hãy cho phép đọc subscription và dùng Text to Speech.',
      checkedAt,
    );
  }

  if (status === 429) {
    return failedStatus(
      'unavailable',
      'ElevenLabs đang giới hạn số request. Hãy thử kiểm tra lại sau.',
      checkedAt,
    );
  }

  if (status >= 500) {
    return failedStatus(
      'unavailable',
      'Dịch vụ ElevenLabs đang tạm thời không sẵn sàng.',
      checkedAt,
    );
  }

  return failedStatus(
    'error',
    'ElevenLabs từ chối yêu cầu xác minh kết nối.',
    checkedAt,
  );
}

function resetAt(value: number | null | undefined) {
  if (!value) return null;

  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function createElevenLabsConnectionService(
  options: {
    apiKey?: string | null;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
  } = {},
): ElevenLabsConnectionService {
  const apiKey = (options.apiKey ?? process.env.ELEVENLABS_API_KEY ?? '').trim();
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  return {
    async verifyConnection() {
      const checkedAt = new Date().toISOString();

      if (!apiKey) {
        return failedStatus(
          'not_configured',
          'Chưa cấu hình ELEVENLABS_API_KEY ở backend.',
          checkedAt,
        );
      }

      if (apiKey.length > 512 || /[\r\n]/.test(apiKey)) {
        return failedStatus(
          'disconnected',
          'ELEVENLABS_API_KEY không có định dạng an toàn.',
          checkedAt,
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const requestOptions = {
        headers: {
          Accept: 'application/json',
          'xi-api-key': apiKey,
        },
        signal: controller.signal,
      } satisfies RequestInit;

      try {
        const [subscriptionResponse, modelsResponse] = await Promise.all([
          fetchRequest(
            `${ELEVENLABS_API_ORIGIN}/v1/user/subscription`,
            requestOptions,
          ),
          fetchRequest(
            `${ELEVENLABS_API_ORIGIN}/v1/models`,
            requestOptions,
          ),
        ]);

        if (!subscriptionResponse.ok) {
          return responseFailure(subscriptionResponse.status, checkedAt);
        }
        if (!modelsResponse.ok) {
          return responseFailure(modelsResponse.status, checkedAt);
        }

        const [subscriptionJson, modelsJson] = await Promise.all([
          subscriptionResponse.json(),
          modelsResponse.json(),
        ]);
        const subscription = subscriptionSchema.safeParse(subscriptionJson);
        const models = modelsSchema.safeParse(modelsJson);

        if (!subscription.success || !models.success) {
          return failedStatus(
            'error',
            'ElevenLabs trả về dữ liệu xác minh không đúng cấu trúc hỗ trợ.',
            checkedAt,
          );
        }

        const textToSpeechModels = models.data.filter(
          (model) => model.can_do_text_to_speech,
        );
        if (textToSpeechModels.length === 0) {
          return failedStatus(
            'restricted',
            'Tài khoản không có model Text to Speech khả dụng.',
            checkedAt,
          );
        }

        return {
          state: 'connected',
          subscription: {
            tier: subscription.data.tier,
            status: subscription.data.status,
            characterCount: subscription.data.character_count,
            characterLimit: subscription.data.character_limit,
            nextResetAt: resetAt(
              subscription.data.next_character_count_reset_unix,
            ),
          },
          capabilities: {
            textToSpeechModels: textToSpeechModels.length,
            supportsVietnamese: textToSpeechModels.some((model) =>
              model.languages?.some(
                (language) => language.language_id.toLowerCase() === 'vi',
              ),
            ),
          },
          verifiedAt: checkedAt,
        };
      } catch (error) {
        return failedStatus(
          'unavailable',
          error instanceof Error && error.name === 'AbortError'
            ? 'ElevenLabs không phản hồi yêu cầu xác minh đúng hạn.'
            : 'Không thể kết nối tới dịch vụ ElevenLabs.',
          checkedAt,
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
