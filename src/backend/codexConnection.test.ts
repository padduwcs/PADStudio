import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexConnectionError,
  createCodexConnectionService,
  type CodexAppServerClient,
} from './codexConnection.ts';

class FakeCodexClient implements CodexAppServerClient {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  closed = false;
  private readonly handler: (
    method: string,
    params?: unknown,
  ) => Promise<unknown> | unknown;

  constructor(
    handler: (
      method: string,
      params?: unknown,
    ) => Promise<unknown> | unknown,
  ) {
    this.handler = handler;
  }

  request(method: string, params?: unknown) {
    this.calls.push({method, params});
    return Promise.resolve(this.handler(method, params));
  }

  subscribe() {
    return () => undefined;
  }

  close() {
    this.closed = true;
  }
}

test('verifyConnection xác minh phiên bằng các request live', async () => {
  const client = new FakeCodexClient((method) => {
    if (method === 'account/read') {
      return {
        account: {
          type: 'chatgpt',
          email: 'user@example.com',
          planType: 'plus',
        },
        requiresOpenaiAuth: true,
      };
    }
    if (method === 'account/rateLimits/read') {
      return {
        rateLimits: {
          limitId: 'codex',
          limitName: 'Codex',
          primary: {
            usedPercent: 27,
            windowDurationMins: 300,
            resetsAt: 1_800_000_000,
          },
          secondary: null,
          credits: {hasCredits: true, unlimited: false, balance: '4.50'},
          individualLimit: null,
          rateLimitReachedType: null,
        },
      };
    }
    if (method === 'model/list') {
      return {data: [{id: 'available-model'}], nextCursor: null};
    }
    throw new Error(`Unexpected method: ${method}`);
  });
  const service = createCodexConnectionService(client);

  const status = await service.verifyConnection();

  assert.equal(status.state, 'connected');
  assert.deepEqual(
    client.calls.map((call) => call.method),
    ['account/read', 'account/rateLimits/read', 'model/list'],
  );
  assert.deepEqual(client.calls[0]?.params, {refreshToken: true});
  assert.equal(status.state === 'connected' && status.quota?.limitId, 'codex');
  assert.deepEqual(status.state === 'connected' && status.quota?.primary, {
    usedPercent: 27,
    remainingPercent: 73,
    windowDurationMinutes: 300,
    resetsAt: new Date(1_800_000_000_000).toISOString(),
  });
});

test('verifyConnection phân biệt chưa đăng nhập với lỗi kết nối', async () => {
  const disconnectedClient = new FakeCodexClient(() => ({
    account: null,
    requiresOpenaiAuth: true,
  }));
  const disconnectedService =
    createCodexConnectionService(disconnectedClient);
  const disconnected = await disconnectedService.verifyConnection();

  assert.equal(disconnected.state, 'disconnected');
  assert.equal(disconnectedClient.calls.length, 1);

  const failingClient = new FakeCodexClient((method) => {
    if (method === 'account/read') {
      return {
        account: {type: 'apiKey'},
        requiresOpenaiAuth: true,
      };
    }
    throw new Error('network unavailable');
  });
  const failingService = createCodexConnectionService(failingClient);
  const failed = await failingService.verifyConnection();

  assert.equal(failed.state, 'error');
});

test('startChatGptLogin chỉ chấp nhận URL HTTPS từ app-server', async () => {
  const client = new FakeCodexClient(() => ({
    type: 'chatgpt',
    loginId: 'login-123',
    authUrl: 'https://auth.openai.com/codex',
  }));
  const service = createCodexConnectionService(client);

  assert.deepEqual(await service.startChatGptLogin(), {
    loginId: 'login-123',
    authUrl: 'https://auth.openai.com/codex',
  });

  const unsafeClient = new FakeCodexClient(() => ({
    type: 'chatgpt',
    loginId: 'login-unsafe',
    authUrl: 'http://example.com/codex',
  }));
  const unsafeService = createCodexConnectionService(unsafeClient);

  await assert.rejects(
    () => unsafeService.startChatGptLogin(),
    (error) =>
      error instanceof CodexConnectionError &&
      error.code === 'CODEX_LOGIN_URL_INVALID',
  );
});

test('Codex API key login và logout do app-server quản lý', async () => {
  const client = new FakeCodexClient((method, params) => {
    if (method === 'account/login/start') {
      assert.deepEqual(params, {type: 'apiKey', apiKey: 'sk-test'});
      return {type: 'apiKey'};
    }
    if (method === 'account/logout') return {};
    throw new Error(`Unexpected method: ${method}`);
  });
  const service = createCodexConnectionService(client);

  await service.loginWithApiKey('  sk-test  ');
  await service.logout();
  assert.deepEqual(
    client.calls.map((call) => call.method),
    ['account/login/start', 'account/logout'],
  );
});

test('Codex model catalog giữ capability do app-server công bố', async () => {
  const client = new FakeCodexClient(() => ({
    data: [
      {
        id: 'model-id',
        model: 'model-name',
        displayName: 'Model Name',
        description: 'Chất lượng cao',
        isDefault: true,
        supportedReasoningEfforts: [
          {reasoningEffort: 'medium'},
          {reasoningEffort: 'high'},
        ],
        defaultReasoningEffort: 'medium',
      },
    ],
  }));
  const service = createCodexConnectionService(client);

  assert.deepEqual(await service.listModels(), [
    {
      id: 'model-id',
      model: 'model-name',
      displayName: 'Model Name',
      description: 'Chất lượng cao',
      isDefault: true,
      supportedReasoningEfforts: ['medium', 'high'],
      defaultReasoningEffort: 'medium',
    },
  ]);
});

test('close đóng app-server client', () => {
  const client = new FakeCodexClient(() => null);
  const service = createCodexConnectionService(client);

  service.close();
  assert.equal(client.closed, true);
});
