import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import type {
  ElevenLabsCatalog,
  ElevenLabsModelSummary,
  ElevenLabsSharedVoiceSearch,
  ElevenLabsUsagePreset,
  ElevenLabsVoiceSummary,
} from '../shared/elevenLabs.ts';
import type {
  ElevenLabsVoiceSettings,
  VoiceConfiguration,
} from '../shared/topic.ts';

const ELEVENLABS_API_ORIGIN = 'https://api.elevenlabs.io';
const DEFAULT_TIMEOUT_MS = 30_000;

const voiceSchema = z
  .object({
    voice_id: z.string().min(1),
    name: z.string().min(1),
    category: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    preview_url: z.string().url().nullable().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    verified_languages: z
      .array(
        z
          .object({
            language: z.string().optional(),
            language_id: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    high_quality_base_model_ids: z.array(z.string()).optional(),
    is_owner: z.boolean().nullable().optional(),
  })
  .passthrough();

const voicesResponseSchema = z
  .object({
    voices: z.array(voiceSchema),
  })
  .passthrough();

const modelSchema = z
  .object({
    model_id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    can_do_text_to_speech: z.boolean(),
    can_use_style: z.boolean().optional(),
    can_use_speaker_boost: z.boolean().optional(),
    maximum_text_length_per_request: z.number().int().positive().optional(),
    model_rates_multiplier: z.number().positive().optional(),
    languages: z
      .array(
        z
          .object({
            language_id: z.string().min(1),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const historyResponseSchema = z
  .object({
    history: z.array(
      z
        .object({
          history_item_id: z.string().min(1),
          voice_id: z.string().min(1),
          voice_name: z.string().min(1),
          model_id: z.string().min(1),
          date_unix: z.number().int().nonnegative(),
          settings: z
            .object({
              stability: z.number().optional(),
              similarity_boost: z.number().optional(),
              style: z.number().optional(),
              use_speaker_boost: z.boolean().optional(),
              speed: z.number().optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const alignmentSchema = z
  .object({
    characters: z.array(z.string()),
    character_start_times_seconds: z.array(z.number().nonnegative()),
    character_end_times_seconds: z.array(z.number().nonnegative()),
  })
  .strict();

const timestampResponseSchema = z
  .object({
    audio_base64: z.string().min(1),
    alignment: alignmentSchema,
    normalized_alignment: alignmentSchema.nullable().optional(),
  })
  .passthrough();

export interface ElevenLabsAlignment {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
}

export interface ElevenLabsSectionGeneration {
  audio: Buffer;
  alignment: ElevenLabsAlignment;
  normalizedAlignment: ElevenLabsAlignment | null;
  requestId: string | null;
  characterCost: number;
}

export interface ElevenLabsVoiceService {
  getCatalog(
    search: string,
    localPresets?: ElevenLabsUsagePreset[],
  ): Promise<ElevenLabsCatalog>;
  searchSharedVoices(search: string): Promise<ElevenLabsSharedVoiceSearch>;
  resolveConfiguration(input: {
    voiceId: string;
    modelId: string;
    outputFormat: string;
    settings: ElevenLabsVoiceSettings;
    seed: number | null;
  }): Promise<{
    configuration: VoiceConfiguration;
    model: ElevenLabsModelSummary;
  }>;
  generateSection(input: {
    voiceId: string;
    modelId: string;
    outputFormat: string;
    text: string;
    settings: ElevenLabsVoiceSettings;
    seed: number | null;
    canUseStyle?: boolean;
    canUseSpeakerBoost?: boolean;
    previousText?: string;
    nextText?: string;
    previousRequestIds?: string[];
  }): Promise<ElevenLabsSectionGeneration>;
}

export class ElevenLabsVoiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(
    code: string,
    message: string,
    statusCode = 502,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function mapVoice(value: z.infer<typeof voiceSchema>): ElevenLabsVoiceSummary {
  return {
    voiceId: value.voice_id,
    name: value.name,
    category: value.category ?? null,
    description: value.description ?? null,
    previewUrl: value.preview_url ?? null,
    labels: value.labels ?? {},
    verifiedLanguages: [
      ...new Set(
        (value.verified_languages ?? [])
          .map((language) => language.language ?? language.language_id)
          .filter((language): language is string => Boolean(language)),
      ),
    ],
    highQualityBaseModelIds: value.high_quality_base_model_ids ?? [],
    isOwner: value.is_owner === true,
    requiresPaidApiOnFreeTier:
      value.category !== 'premade' && value.is_owner !== true,
  };
}

function mapModel(
  value: z.infer<typeof modelSchema>,
): ElevenLabsModelSummary {
  return {
    modelId: value.model_id,
    name: value.name,
    description: value.description ?? null,
    languages: (value.languages ?? []).map(
      (language) => language.language_id,
    ),
    maximumTextLengthPerRequest:
      value.maximum_text_length_per_request ?? null,
    costMultiplier: value.model_rates_multiplier ?? 1,
    canUseStyle: value.can_use_style ?? false,
    canUseSpeakerBoost: value.can_use_speaker_boost ?? false,
  };
}

function mapAlignment(
  alignment: z.infer<typeof alignmentSchema>,
): ElevenLabsAlignment {
  const length = alignment.characters.length;
  if (
    alignment.character_start_times_seconds.length !== length ||
    alignment.character_end_times_seconds.length !== length
  ) {
    throw new ElevenLabsVoiceError(
      'ELEVENLABS_INVALID_ALIGNMENT',
      'ElevenLabs trả về dữ liệu timing không đồng nhất.',
    );
  }
  return {
    characters: alignment.characters,
    characterStartTimesSeconds:
      alignment.character_start_times_seconds,
    characterEndTimesSeconds: alignment.character_end_times_seconds,
  };
}

async function errorForResponse(response: Response) {
  const status = response.status;
  const payload = (await response.json().catch(() => null)) as
    | {
        detail?:
          | string
          | {
              message?: string;
              code?: string;
            };
      }
    | null;
  const providerMessage =
    typeof payload?.detail === 'string'
      ? payload.detail
      : payload?.detail?.message;
  if (status === 401) {
    return new ElevenLabsVoiceError(
      'ELEVENLABS_UNAUTHORIZED',
      'ElevenLabs không chấp nhận API key hiện tại.',
      401,
    );
  }
  if (status === 403) {
    return new ElevenLabsVoiceError(
      'ELEVENLABS_FORBIDDEN',
      'API key chưa có quyền dùng endpoint ElevenLabs này.',
      403,
    );
  }
  if (status === 402) {
    return new ElevenLabsVoiceError(
      'ELEVENLABS_PAID_PLAN_REQUIRED',
      providerMessage ??
        'Voice đã chọn yêu cầu gói ElevenLabs trả phí khi dùng qua API.',
      402,
    );
  }
  if (status === 422) {
    return new ElevenLabsVoiceError(
      'ELEVENLABS_INVALID_REQUEST',
      providerMessage ??
        'ElevenLabs từ chối cấu hình voice hoặc nội dung TTS.',
      422,
    );
  }
  if (status === 429) {
    return new ElevenLabsVoiceError(
      'ELEVENLABS_RATE_LIMITED',
      'ElevenLabs đang giới hạn request hoặc tài khoản đã chạm hạn mức.',
      429,
    );
  }
  return new ElevenLabsVoiceError(
    'ELEVENLABS_UNAVAILABLE',
    providerMessage ??
      (status >= 500
      ? 'Dịch vụ ElevenLabs đang tạm thời không sẵn sàng.'
      : 'ElevenLabs từ chối yêu cầu.'),
    status >= 500 ? 503 : 502,
  );
}

export function createElevenLabsVoiceService(
  options: {
    apiKey?: string | null;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
    retryDelaysMs?: number[];
  } = {},
): ElevenLabsVoiceService {
  const apiKey = (options.apiKey ?? process.env.ELEVENLABS_API_KEY ?? '').trim();
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const retryDelaysMs = options.retryDelaysMs ?? [350, 900, 1_800];

  function assertConfigured() {
    if (!apiKey) {
      throw new ElevenLabsVoiceError(
        'ELEVENLABS_NOT_CONFIGURED',
        'Chưa cấu hình ELEVENLABS_API_KEY ở backend.',
        503,
      );
    }
  }

  async function request(
    pathname: string,
    init: RequestInit = {},
    retry = true,
  ) {
    assertConfigured();
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchRequest(
          `${ELEVENLABS_API_ORIGIN}${pathname}`,
          {
            ...init,
            headers: {
              Accept: 'application/json',
              'xi-api-key': apiKey,
              ...init.headers,
            },
            signal: controller.signal,
          },
        );
        const canRetry =
          retry &&
          attempt < retryDelaysMs.length &&
          (response.status === 429 || response.status >= 500);
        if (canRetry) {
          await response.arrayBuffer().catch(() => undefined);
          await delay(retryDelaysMs[attempt]);
          continue;
        }
        return response;
      } catch (error) {
        if (attempt < retryDelaysMs.length && retry) {
          await delay(retryDelaysMs[attempt]);
          continue;
        }
        throw new ElevenLabsVoiceError(
          'ELEVENLABS_UNAVAILABLE',
          error instanceof Error && error.name === 'AbortError'
            ? 'ElevenLabs không phản hồi trong thời hạn cho phép.'
            : 'Không thể kết nối tới dịch vụ ElevenLabs.',
          503,
          {cause: error},
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  async function readModels() {
    const response = await request('/v1/models');
    if (!response.ok) throw await errorForResponse(response);
    const parsed = z.array(modelSchema).safeParse(await response.json());
    if (!parsed.success) {
      throw new ElevenLabsVoiceError(
        'ELEVENLABS_INVALID_RESPONSE',
        'Danh sách model ElevenLabs không đúng cấu trúc hỗ trợ.',
      );
    }
    return parsed.data
      .filter((model) => model.can_do_text_to_speech)
      .map(mapModel);
  }

  async function readVoices(search: string) {
    const params = new URLSearchParams({page_size: '100'});
    if (search) params.set('search', search);
    const response = await request(`/v2/voices?${params.toString()}`);
    if (!response.ok) throw await errorForResponse(response);
    const parsed = voicesResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ElevenLabsVoiceError(
        'ELEVENLABS_INVALID_RESPONSE',
        'Danh sách voice ElevenLabs không đúng cấu trúc hỗ trợ.',
      );
    }
    const voices = parsed.data.voices.map(mapVoice);
    if (
      voices.length === 0 &&
      /^[A-Za-z0-9_-]{8,160}$/.test(search)
    ) {
      const directResponse = await request(
        `/v1/voices/${encodeURIComponent(search)}`,
        {},
        false,
      );
      if (directResponse.ok) {
        const directVoice = voiceSchema.safeParse(
          await directResponse.json(),
        );
        if (directVoice.success) return [mapVoice(directVoice.data)];
      }
    }
    return voices;
  }

  async function readHistory(
    models: ElevenLabsModelSummary[],
  ): Promise<{
    presets: ElevenLabsUsagePreset[];
    available: boolean;
    message: string | null;
  }> {
    const response = await request(
      '/v1/history?source=TTS&page_size=100',
      {},
      false,
    );
    if (response.status === 401 || response.status === 403) {
      return {
        presets: [],
        available: false,
        message:
          'Bật History → Read cho API key nếu muốn nhập cấu hình đã dùng trên web ElevenLabs.',
      };
    }
    if (!response.ok) {
      return {
        presets: [],
        available: false,
        message: 'Chưa thể đọc lịch sử ElevenLabs lúc này.',
      };
    }
    const parsed = historyResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        presets: [],
        available: false,
        message: 'Lịch sử ElevenLabs có cấu trúc chưa được hỗ trợ.',
      };
    }
    const modelNames = new Map(
      models.map((model) => [model.modelId, model.name]),
    );
    return {
      presets: parsed.data.history.slice(0, 20).map((item) => ({
        id: `elevenlabs-history:${item.history_item_id}`,
        source: 'elevenlabs-history',
        voiceId: item.voice_id,
        voiceName: item.voice_name,
        modelId: item.model_id,
        modelName: modelNames.get(item.model_id) ?? item.model_id,
        usedAt: new Date(item.date_unix * 1_000).toISOString(),
        successfulGenerations: 1,
        settings: item.settings
          ? {
              stability: item.settings.stability ?? 0.5,
              similarityBoost: item.settings.similarity_boost ?? 0.75,
              style: item.settings.style ?? 0,
              useSpeakerBoost: item.settings.use_speaker_boost ?? true,
              speed: item.settings.speed ?? 1,
            }
          : null,
        timingCalibration: null,
      })),
      available: true,
      message: null,
    };
  }

  return {
    async getCatalog(search, localPresets = []) {
      const [voices, models] = await Promise.all([
        readVoices(search.trim()),
        readModels(),
      ]);
      const history = await readHistory(models);
      const recentPresets = [...localPresets, ...history.presets]
        .sort((left, right) => right.usedAt.localeCompare(left.usedAt))
        .slice(0, 30);
      return {
        voices,
        models,
        recentPresets,
        history: {
          available: history.available,
          message: history.message,
        },
      };
    },

    async searchSharedVoices(search) {
      const params = new URLSearchParams({
        page_size: '50',
        search: search.trim(),
        language: 'vi',
      });
      const response = await request(
        `/v1/shared-voices?${params.toString()}`,
        {},
        false,
      );
      if (response.status === 403) {
        return {
          available: false,
          message:
            'Voice Library qua API chưa khả dụng cho gói hiện tại. Giọng của tài khoản vẫn dùng bình thường.',
          voices: [],
        };
      }
      if (!response.ok) throw await errorForResponse(response);
      const parsed = voicesResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ElevenLabsVoiceError(
          'ELEVENLABS_INVALID_RESPONSE',
          'Kết quả Voice Library không đúng cấu trúc hỗ trợ.',
        );
      }
      return {
        available: true,
        message: null,
        voices: parsed.data.voices.map(mapVoice),
      };
    },

    async resolveConfiguration(input) {
      const [voiceResponse, models] = await Promise.all([
        request(`/v1/voices/${encodeURIComponent(input.voiceId)}`),
        readModels(),
      ]);
      if (!voiceResponse.ok) throw await errorForResponse(voiceResponse);
      const parsedVoice = voiceSchema.safeParse(await voiceResponse.json());
      if (!parsedVoice.success) {
        throw new ElevenLabsVoiceError(
          'ELEVENLABS_INVALID_RESPONSE',
          'Thông tin voice ElevenLabs không đúng cấu trúc hỗ trợ.',
        );
      }
      const model = models.find((item) => item.modelId === input.modelId);
      if (!model) {
        throw new ElevenLabsVoiceError(
          'ELEVENLABS_MODEL_NOT_FOUND',
          'Model TTS đã chọn không còn khả dụng cho tài khoản.',
          422,
        );
      }
      if (!model.languages.includes('vi')) {
        throw new ElevenLabsVoiceError(
          'ELEVENLABS_MODEL_LANGUAGE_UNSUPPORTED',
          'Model TTS đã chọn không công bố hỗ trợ tiếng Việt.',
          422,
        );
      }
      const voice = mapVoice(parsedVoice.data);
      return {
        model,
        configuration: {
          voiceId: voice.voiceId,
          voiceName: voice.name,
          voiceCategory: voice.category,
          modelId: model.modelId,
          modelName: model.name,
          languageCode: 'vi',
          outputFormat: input.outputFormat,
          settings: input.settings,
          seed: input.seed,
        },
      };
    },

    async generateSection(input) {
      const supportsRequestStitching = input.modelId !== 'eleven_v3';
      const response = await request(
        `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}/with-timestamps?output_format=${encodeURIComponent(input.outputFormat)}`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            text: input.text,
            model_id: input.modelId,
            language_code: 'vi',
            voice_settings: {
              stability: input.settings.stability,
              similarity_boost: input.settings.similarityBoost,
              speed: input.settings.speed,
              ...(input.canUseStyle === false
                ? {}
                : {style: input.settings.style}),
              ...(input.canUseSpeakerBoost === false
                ? {}
                : {
                    use_speaker_boost:
                      input.settings.useSpeakerBoost,
                  }),
            },
            ...(input.seed === null ? {} : {seed: input.seed}),
            ...(supportsRequestStitching && input.previousText
              ? {previous_text: input.previousText}
              : {}),
            ...(supportsRequestStitching && input.nextText
              ? {next_text: input.nextText}
              : {}),
            ...(supportsRequestStitching &&
            input.previousRequestIds?.length
              ? {
                  previous_request_ids:
                    input.previousRequestIds.slice(-3),
                }
              : {}),
          }),
        },
      );
      if (!response.ok) throw await errorForResponse(response);
      const parsed = timestampResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ElevenLabsVoiceError(
          'ELEVENLABS_INVALID_RESPONSE',
          'ElevenLabs trả về audio hoặc alignment không đúng cấu trúc hỗ trợ.',
        );
      }
      const characterCost = Number(response.headers.get('character-cost'));
      return {
        audio: Buffer.from(parsed.data.audio_base64, 'base64'),
        alignment: mapAlignment(parsed.data.alignment),
        normalizedAlignment: parsed.data.normalized_alignment
          ? mapAlignment(parsed.data.normalized_alignment)
          : null,
        requestId: response.headers.get('request-id'),
        characterCost: Number.isSafeInteger(characterCost)
          ? characterCost
          : input.text.length,
      };
    },
  };
}
