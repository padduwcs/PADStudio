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
      return {rateLimits: {primary: null}};
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

test('close đóng app-server client', () => {
  const client = new FakeCodexClient(() => null);
  const service = createCodexConnectionService(client);

  service.close();
  assert.equal(client.closed, true);
});
