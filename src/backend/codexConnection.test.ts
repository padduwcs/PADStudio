import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CODEX_APP_SERVER_STDERR_MAX_CHARS,
  CodexAppServerError,
  CodexConnectionError,
  createCodexProcessEnvironment,
  createCodexConnectionService,
  redactCodexDiagnosticText,
  runCodexAppServerHealthProbe,
  StdioCodexAppServerClient,
  type CodexAppServerClient,
} from './codexConnection.ts';

async function withFakeAppServer(
  mode: 'exit-initialize' | 'pending-exit' | 'stable' | 'ignore-request',
  run: (client: StdioCodexAppServerClient) => Promise<void>,
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-codex-connection-test-'),
  );
  const scriptPath = path.join(directory, 'fake-app-server.mjs');
  await writeFile(
    scriptPath,
    `
const mode = process.argv[2];
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      if (mode === 'exit-initialize') {
        process.stderr.write(
          'codex cli v9.8.7 token=super-secret-token data:image/png;base64,AAAA\\nC:\\\\Users\\\\SecretUser\\\\private\\\\file\\n' + 'X'.repeat(12000),
          () => process.exit(1),
        );
        continue;
      }
      process.stdout.write(JSON.stringify({
        id: message.id,
        result: {userAgent: 'fake-codex/1.0.0'},
      }) + '\\n');
      continue;
    }
    if (message.method === 'initialized') continue;
    if (mode === 'pending-exit' && message.method === 'account/read') {
      process.stderr.write(
        'codex cli v9.8.7 authorization=Bearer super-secret-token C:\\\\Users\\\\SecretUser\\\\pending\\\\file\\n',
        () => process.exit(1),
      );
      continue;
    }
    if (mode === 'ignore-request') continue;
    if (message.method !== 'initialized') {
      process.stderr.write('unexpected method: ' + message.method + '\\n', () => process.exit(2));
    }
  }
});
`,
    'utf8',
  );
  const environment = {
    ...process.env,
    HOME: 'C:\\Users\\SecretUser',
    USERPROFILE: 'C:\\Users\\SecretUser',
  };
  const client = new StdioCodexAppServerClient({
    environment,
    requestTimeoutMs: 1_000,
    resolveLaunch: async () => ({
      command: process.execPath,
      args: [scriptPath, mode],
      source: 'path-codex-exe',
    }),
    spawnProcess: (launch, childEnvironment) =>
      spawn(launch.command, launch.args, {
        cwd: directory,
        env: childEnvironment,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
  });
  try {
    await run(client);
  } finally {
    client.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    await rm(directory, {recursive: true, force: true});
  }
}

test('Codex app-server diagnostics redact bounded stderr content', () => {
  const secret = 'super-secret-token';
  const dataUrl = 'data:image/png;base64,' + 'A'.repeat(128);
  const redacted = redactCodexDiagnosticText(
    `token=${secret} ${dataUrl} C:\\Users\\SecretUser\\private\\file`,
    ['C:\\Users\\SecretUser'],
  );

  assert.ok(!redacted.includes(secret));
  assert.ok(!redacted.includes(dataUrl));
  assert.ok(!redacted.includes('C:\\Users\\SecretUser'));
});

test('Codex app-server exit code 1 during initialize keeps stderr and pending method', async () => {
  await withFakeAppServer('exit-initialize', async client => {
    await assert.rejects(
      () => client.request('account/read', {}),
      error => {
        assert.ok(error instanceof CodexAppServerError);
        assert.equal(error.code, 'CODEX_APP_SERVER_DISCONNECTED');
        assert.equal(error.reason, 'disconnected');
        assert.equal(error.processDiagnostics?.exitCode, 1);
        assert.equal(error.processDiagnostics?.signal, null);
        assert.equal(error.processDiagnostics?.method, 'initialize');
        assert.deepEqual(error.processDiagnostics?.pendingMethods, ['initialize']);
        assert.equal(error.processDiagnostics?.commandBasename, path.basename(process.execPath));
        assert.equal(error.processDiagnostics?.cliVersion, '9.8.7');
        const stderr = error.processDiagnostics?.stderr ?? '';
        assert.ok(stderr.length <= CODEX_APP_SERVER_STDERR_MAX_CHARS);
        assert.ok(stderr.includes('[REDACTED_SECRET]'));
        assert.ok(stderr.includes('[REDACTED_DATA_URL]'));
        assert.ok(!stderr.includes('super-secret-token'));
        assert.ok(!stderr.includes('C:\\Users\\SecretUser'));
        return true;
      },
    );
  });
});

test('Codex app-server disconnect while a request is pending records that method', async () => {
  await withFakeAppServer('pending-exit', async client => {
    await assert.rejects(
      () => client.request('account/read', {}),
      error => {
        assert.ok(error instanceof CodexAppServerError);
        assert.equal(error.code, 'CODEX_APP_SERVER_DISCONNECTED');
        assert.equal(error.processDiagnostics?.exitCode, 1);
        assert.equal(error.processDiagnostics?.method, 'account/read');
        assert.deepEqual(error.processDiagnostics?.pendingMethods, ['account/read']);
        assert.ok(!(error.processDiagnostics?.stderr ?? '').includes('super-secret-token'));
        return true;
      },
    );
  });
});

test('Codex app-server request timeout keeps the pending method without inventing a process exit', async () => {
  await withFakeAppServer('ignore-request', async client => {
    await assert.rejects(
      () => client.request('account/read', {}),
      error => {
        assert.ok(error instanceof CodexAppServerError);
        assert.equal(error.code, 'CODEX_APP_SERVER_REQUEST_TIMEOUT');
        assert.equal(error.reason, 'request_timeout');
        assert.equal(error.processDiagnostics?.method, 'account/read');
        assert.equal(error.processDiagnostics?.exitCode, null);
        return true;
      },
    );
  });
});

test('Codex app-server health probe only initializes and remains stable', async () => {
  await withFakeAppServer('stable', async client => {
    const result = await runCodexAppServerHealthProbe({
      client,
      stabilityMs: 25,
    });
    assert.equal(result.initialize, 'passed');
    assert.equal(result.stable, true);
    assert.equal(result.launch.commandBasename, path.basename(process.execPath));
    assert.equal(result.processDiagnostics?.exitCode, null);
  });
});

test('Codex app-server inherits a usable Windows home directory', () => {
  const fromProfile = createCodexProcessEnvironment({
    USERPROFILE: 'C:\\Users\\PAD',
  });
  assert.equal(fromProfile.HOME, 'C:\\Users\\PAD');
  assert.equal(fromProfile.CODEX_HOME, 'C:\\Users\\PAD\\.codex');

  const fromDriveAndPath = createCodexProcessEnvironment({
    HOMEDRIVE: 'D:',
    HOMEPATH: '\\Profiles\\PAD',
  });
  assert.equal(fromDriveAndPath.HOME, 'D:\\Profiles\\PAD');
  assert.equal(fromDriveAndPath.CODEX_HOME, 'D:\\Profiles\\PAD\\.codex');

  const alreadyConfigured = createCodexProcessEnvironment({
    HOME: 'E:\\CodexHome',
    USERPROFILE: 'C:\\Users\\PAD',
  });
  assert.equal(alreadyConfigured.HOME, 'E:\\CodexHome');

  const customCodexHome = createCodexProcessEnvironment({
    HOME: 'E:\\CodexHome',
    CODEX_HOME: 'F:\\CodexState',
  });
  assert.equal(customCodexHome.CODEX_HOME, 'F:\\CodexState');
});

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
