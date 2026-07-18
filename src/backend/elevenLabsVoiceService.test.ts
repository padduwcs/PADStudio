import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createElevenLabsVoiceService,
  ElevenLabsVoiceError,
} from './elevenLabsVoiceService.ts';

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {'Content-Type': 'application/json', ...init.headers},
  });
}

const model = {
  model_id: 'eleven_multilingual_v2',
  name: 'Multilingual v2',
  can_do_text_to_speech: true,
  can_use_style: true,
  can_use_speaker_boost: true,
  maximum_text_length_per_request: 10_000,
  model_rates_multiplier: 1,
  languages: [{language_id: 'vi'}],
};

const voice = {
  voice_id: 'voice-test-123',
  name: 'Giọng thử',
  category: 'premade',
  preview_url: 'https://example.com/preview.mp3',
  labels: {accent: 'Vietnamese'},
  verified_languages: [{language: 'vi'}],
  high_quality_base_model_ids: ['eleven_multilingual_v2'],
};

test('ElevenLabs voice catalog dùng endpoint thật và hạ cấp mềm khi thiếu History Read', async () => {
  const calls: string[] = [];
  const service = createElevenLabsVoiceService({
    apiKey: 'test-key',
    retryDelaysMs: [],
    fetch: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/v2/voices')) {
        return jsonResponse({voices: [voice]});
      }
      if (url.endsWith('/v1/models')) return jsonResponse([model]);
      if (url.includes('/v1/history')) {
        return jsonResponse({detail: 'forbidden'}, {status: 403});
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const catalog = await service.getCatalog('Giọng');
  assert.equal(catalog.voices[0]?.voiceId, voice.voice_id);
  assert.equal(catalog.models[0]?.modelId, model.model_id);
  assert.equal(catalog.models[0]?.languages[0], 'vi');
  assert.equal(catalog.history.available, false);
  assert.match(catalog.history.message ?? '', /History/);
  assert.ok(calls.some((url) => url.includes('search=Gi%E1%BB%8Dng')));
});

test('ElevenLabs TTS with timestamps gửi cấu hình đầy đủ và đọc request metadata', async () => {
  const text = 'Xin chào';
  let sentBody: Record<string, unknown> = {};
  const characters = Array.from(text);
  const service = createElevenLabsVoiceService({
    apiKey: 'test-key',
    retryDelaysMs: [],
    fetch: async (_input, init) => {
      sentBody = JSON.parse(String(init?.body));
      return jsonResponse(
        {
          audio_base64: Buffer.from('audio-data').toString('base64'),
          alignment: {
            characters,
            character_start_times_seconds: characters.map(
              (_character, index) => index * 0.1,
            ),
            character_end_times_seconds: characters.map(
              (_character, index) => (index + 1) * 0.1,
            ),
          },
          normalized_alignment: null,
        },
        {
          headers: {
            'request-id': 'request-123',
            'character-cost': '8',
          },
        },
      );
    },
  });

  const result = await service.generateSection({
    voiceId: voice.voice_id,
    modelId: model.model_id,
    outputFormat: 'mp3_44100_128',
    text,
    settings: {
      stability: 0.45,
      similarityBoost: 0.8,
      style: 0.1,
      useSpeakerBoost: true,
      speed: 0.95,
    },
    seed: 42,
    previousText: 'Trước đó',
    nextText: 'Tiếp theo',
  });

  assert.equal(sentBody.model_id, model.model_id);
  assert.equal(sentBody.language_code, 'vi');
  assert.deepEqual(sentBody.voice_settings, {
    stability: 0.45,
    similarity_boost: 0.8,
    style: 0.1,
    use_speaker_boost: true,
    speed: 0.95,
  });
  assert.equal(result.requestId, 'request-123');
  assert.equal(result.characterCost, 8);
  assert.equal(result.audio.toString(), 'audio-data');
  assert.equal(result.alignment.characters.join(''), text);
});

test('Eleven v3 bỏ capability không hỗ trợ và không gửi Request Stitching', async () => {
  const text = 'Đệ quy cần điểm dừng.';
  let sentBody: Record<string, unknown> = {};
  const characters = Array.from(text);
  const service = createElevenLabsVoiceService({
    apiKey: 'test-key',
    retryDelaysMs: [],
    fetch: async (_input, init) => {
      sentBody = JSON.parse(String(init?.body));
      return jsonResponse({
        audio_base64: Buffer.from('audio-data').toString('base64'),
        alignment: {
          characters,
          character_start_times_seconds: characters.map(
            (_character, index) => index * 0.1,
          ),
          character_end_times_seconds: characters.map(
            (_character, index) => (index + 1) * 0.1,
          ),
        },
      });
    },
  });

  await service.generateSection({
    voiceId: voice.voice_id,
    modelId: 'eleven_v3',
    outputFormat: 'mp3_44100_128',
    text,
    settings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.8,
      useSpeakerBoost: true,
      speed: 1,
    },
    seed: null,
    canUseStyle: false,
    canUseSpeakerBoost: false,
    previousText: 'Nội dung trước.',
    nextText: 'Nội dung sau.',
  });

  const voiceSettings = sentBody.voice_settings as Record<string, unknown>;
  assert.equal('style' in voiceSettings, false);
  assert.equal('use_speaker_boost' in voiceSettings, false);
  assert.equal('previous_text' in sentBody, false);
  assert.equal('next_text' in sentBody, false);
});

test('resolveConfiguration chấp nhận is_owner null từ voice premade', async () => {
  const service = createElevenLabsVoiceService({
    apiKey: 'test-key',
    retryDelaysMs: [],
    fetch: async (input) => {
      const url = String(input);
      if (url.includes('/v1/voices/')) {
        return jsonResponse({...voice, is_owner: null});
      }
      if (url.endsWith('/v1/models')) return jsonResponse([model]);
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const resolved = await service.resolveConfiguration({
    voiceId: voice.voice_id,
    modelId: model.model_id,
    outputFormat: 'mp3_44100_128',
    settings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      useSpeakerBoost: true,
      speed: 1,
    },
    seed: null,
  });

  assert.equal(resolved.configuration.voiceId, voice.voice_id);
  assert.equal(resolved.configuration.voiceName, voice.name);
});

test('ElevenLabs trả lỗi 402 rõ ràng khi gói Free không dùng được Voice Library', async () => {
  const service = createElevenLabsVoiceService({
    apiKey: 'test-key',
    retryDelaysMs: [],
    fetch: async () =>
      jsonResponse(
        {
          detail: {
            code: 'paid_plan_required',
            message:
              'Free users cannot use library voices via the API.',
          },
        },
        {status: 402},
      ),
  });

  await assert.rejects(
    () =>
      service.generateSection({
        voiceId: 'library-voice',
        modelId: 'eleven_v3',
        outputFormat: 'mp3_44100_128',
        text: 'Kiểm tra.',
        settings: {
          stability: 0.5,
          similarityBoost: 0.75,
          style: 0,
          useSpeakerBoost: false,
          speed: 1,
        },
        seed: null,
      }),
    (error) =>
      error instanceof ElevenLabsVoiceError &&
      error.code === 'ELEVENLABS_PAID_PLAN_REQUIRED' &&
      error.statusCode === 402 &&
      /Free users/.test(error.message),
  );
});

test('ElevenLabs voice service không coi key thiếu là kết nối thành công', async () => {
  const service = createElevenLabsVoiceService({
    apiKey: '',
    retryDelaysMs: [],
  });
  await assert.rejects(
    () => service.getCatalog(''),
    (error) =>
      error instanceof ElevenLabsVoiceError &&
      error.code === 'ELEVENLABS_NOT_CONFIGURED',
  );
});
