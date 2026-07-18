import assert from 'node:assert/strict';
import test from 'node:test';
import {createElevenLabsConnectionService} from './elevenLabsConnection.ts';

const subscription = {
  tier: 'free',
  status: 'free',
  character_count: 250,
  character_limit: 10_000,
  next_character_count_reset_unix: 1_785_542_400,
};

const models = [
  {
    model_id: 'eleven_flash_v2_5',
    can_do_text_to_speech: true,
    languages: [
      {language_id: 'en', name: 'English'},
      {language_id: 'vi', name: 'Vietnamese'},
    ],
  },
  {
    model_id: 'speech-to-speech-only',
    can_do_text_to_speech: false,
    languages: [],
  },
];

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

test('ElevenLabs connection gọi subscription và model catalog thật', async () => {
  const calls: Array<{url: string; headers: Headers}> = [];
  const fetchRequest = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({url, headers: new Headers(init?.headers)});
    return url.endsWith('/v1/user/subscription')
      ? jsonResponse(subscription)
      : jsonResponse(models);
  }) as typeof fetch;
  const service = createElevenLabsConnectionService({
    apiKey: 'test-secret-key',
    fetch: fetchRequest,
    timeoutMs: 1_000,
  });

  const status = await service.verifyConnection();

  assert.equal(status.state, 'connected');
  if (status.state !== 'connected') return;
  assert.equal(status.subscription.tier, 'free');
  assert.equal(status.subscription.characterCount, 250);
  assert.equal(status.capabilities.textToSpeechModels, 1);
  assert.equal(status.capabilities.supportsVietnamese, true);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      'https://api.elevenlabs.io/v1/user/subscription',
      'https://api.elevenlabs.io/v1/models',
    ],
  );
  assert.equal(
    calls.every(
      (call) => call.headers.get('xi-api-key') === 'test-secret-key',
    ),
    true,
  );
});

test('ElevenLabs connection không gọi mạng khi chưa có API key', async () => {
  let fetchCalls = 0;
  const service = createElevenLabsConnectionService({
    apiKey: '',
    fetch: (async () => {
      fetchCalls += 1;
      return jsonResponse({});
    }) as typeof fetch,
  });

  const status = await service.verifyConnection();

  assert.equal(status.state, 'not_configured');
  assert.equal(fetchCalls, 0);
});

test('ElevenLabs connection phân biệt key sai và key bị giới hạn', async () => {
  for (const [responseStatus, expectedState] of [
    [401, 'disconnected'],
    [403, 'restricted'],
  ] as const) {
    const service = createElevenLabsConnectionService({
      apiKey: 'test-key',
      fetch: (async (input: string | URL | Request) =>
        String(input).endsWith('/v1/user/subscription')
          ? jsonResponse({}, responseStatus)
          : jsonResponse(models)) as typeof fetch,
    });

    const status = await service.verifyConnection();
    assert.equal(status.state, expectedState);
  }
});

test('ElevenLabs connection không coi response hỏng là đã kết nối', async () => {
  const service = createElevenLabsConnectionService({
    apiKey: 'test-key',
    fetch: (async (input: string | URL | Request) =>
      String(input).endsWith('/v1/user/subscription')
        ? jsonResponse({tier: 'free'})
        : jsonResponse(models)) as typeof fetch,
  });

  const status = await service.verifyConnection();

  assert.equal(status.state, 'error');
});

test('ElevenLabs connection báo unavailable khi request mạng thất bại', async () => {
  const service = createElevenLabsConnectionService({
    apiKey: 'test-key',
    fetch: (async () => {
      throw new TypeError('network unavailable');
    }) as typeof fetch,
  });

  const status = await service.verifyConnection();

  assert.equal(status.state, 'unavailable');
});
