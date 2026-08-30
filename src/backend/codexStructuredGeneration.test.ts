import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CodexStructuredGenerationError,
  codexGenerationTimeoutMs,
  DEFAULT_CODEX_GENERATION_TIMEOUT_MS,
  runCodexStructuredGeneration,
  strictCodexOutputSchema,
} from './codexStructuredGeneration.ts';
import type {
  CodexAppServerClient,
  CodexAppServerNotification,
} from './codexConnection.ts';
import {CodexAppServerError} from './codexConnection.ts';

test('schema structured output luôn strict ở mọi object lồng nhau', () => {
  const source = {
    type: 'object',
    properties: {
      beats: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            voiceover: {type: 'string'},
            spokenVoiceover: {
              anyOf: [{type: 'string'}, {type: 'null'}],
            },
          },
          required: ['voiceover'],
        },
      },
    },
    required: [],
  };

  const normalized = strictCodexOutputSchema(source) as typeof source & {
    additionalProperties: boolean;
  };
  const beatSchema = normalized.properties.beats.items as typeof source.properties.beats.items & {
    additionalProperties: boolean;
  };

  assert.deepEqual(normalized.required, ['beats']);
  assert.equal(normalized.additionalProperties, false);
  assert.deepEqual(beatSchema.required, [
    'voiceover',
    'spokenVoiceover',
  ]);
  assert.equal(beatSchema.additionalProperties, false);
  assert.deepEqual(source.required, []);
  assert.deepEqual(source.properties.beats.items.required, ['voiceover']);
});

test('timeout Codex tăng theo mức reasoning cao', {
  skip: Boolean(process.env.PAD_CODEX_GENERATION_TIMEOUT_MS?.trim()),
}, () => {
  const low = codexGenerationTimeoutMs('low');
  const medium = codexGenerationTimeoutMs('medium');
  const high = codexGenerationTimeoutMs('high');
  const ultra = codexGenerationTimeoutMs('ultra');
  const futureEffort = codexGenerationTimeoutMs('future-level');

  assert.ok(low >= DEFAULT_CODEX_GENERATION_TIMEOUT_MS);
  assert.ok(medium >= low);
  assert.ok(high > medium);
  assert.ok(ultra > high);
  assert.ok(futureEffort >= high);
  assert.ok(ultra <= 120 * 60 * 1000);
});

class StructuredGenerationFakeClient implements CodexAppServerClient {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  private listener: ((notification: CodexAppServerNotification) => void) | null = null;
  private readonly rejectImageInput: boolean;

  constructor(rejectImageInput = false) {
    this.rejectImageInput = rejectImageInput;
  }

  async request(method: string, params?: unknown) {
    this.calls.push({method, params});
    if (method === 'thread/start') {
      return {thread: {id: 'thread-test'}, model: 'model-test'};
    }
    if (method === 'turn/start') {
      const input = (params as {input: Array<{type: string}>}).input;
      if (this.rejectImageInput && input.some(item => item.type === 'image')) {
        throw new Error('image input is not supported by this app-server');
      }
      queueMicrotask(() => {
        this.listener?.({
          method: 'turn/completed',
          params: {
            threadId: 'thread-test',
            turn: {
              id: 'turn-test',
              status: 'completed',
              items: [{
                type: 'agentMessage',
                text: '{"name":"scene","source":"export default null;"}',
              }],
            },
          },
        });
      });
      return {turn: {id: 'turn-test'}};
    }
    throw new Error(`Unexpected method: ${method}`);
  }

  subscribe(listener: (notification: CodexAppServerNotification) => void) {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  close() {}
}

type TestInput = Array<
  | {type: 'text'; text: string}
  | {type: 'image'; url: string; detail: 'high'}
>;

async function structuredRunInput(client: CodexAppServerClient, input: TestInput) {
  return structuredRunInputWithTimeout(client, input, 1_000);
}

async function structuredRunInputWithTimeout(
  client: CodexAppServerClient,
  input: TestInput,
  timeoutMs: number,
) {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-codex-structured-test-'),
  );
  try {
    return await runCodexStructuredGeneration({
      client,
      runtimeDirectory,
      timeoutMs,
      outputSchema: {type: 'object', properties: {}, required: []},
      prompt: 'repair direct TSX',
      baseInstructions: 'base',
      developerInstructions: 'developer',
      input,
    });
  } finally {
    await rm(runtimeDirectory, {recursive: true, force: true});
  }
}

type StructuredFailureMode =
  | 'turn-start-reject'
  | 'turn-start-transport'
  | 'turn-failed'
  | 'timeout'
  | 'empty'
  | 'malformed'
  | 'disconnect'
  | 'initialize-disconnect';

class StructuredFailureFakeClient implements CodexAppServerClient {
  private listener: ((notification: CodexAppServerNotification) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;
  private readonly mode: StructuredFailureMode;

  constructor(mode: StructuredFailureMode) {
    this.mode = mode;
  }

  async request(method: string, params?: unknown) {
    if (method === 'thread/start') {
      if (this.mode === 'initialize-disconnect') {
        throw new CodexAppServerError(
          'CODEX_APP_SERVER_DISCONNECTED',
          'Codex app-server stopped.',
          {
            method: 'initialize',
            processDiagnostics: {
              exitCode: 1,
              signal: null,
              commandBasename: 'node.exe',
              entrypointBasename: 'codex.js',
              cliVersion: '1.2.3',
              method: 'initialize',
              pendingMethods: ['initialize'],
              stderr: 'authentication failed [REDACTED_SECRET]',
            },
          },
        );
      }
      return {thread: {id: 'thread-failure'}, model: 'model-failure'};
    }
    if (method === 'turn/start') {
      const threadId = (params as {threadId: string}).threadId;
      const turnId = `turn-${this.mode}`;
      if (this.mode === 'turn-start-reject') {
        throw new Error('turn/start rejected by app-server; provider request was refused');
      }
      if (this.mode === 'turn-start-transport') {
        throw new Error('socket write failed while sending turn/start');
      }
      if (this.mode === 'disconnect') {
        setTimeout(() => {
          this.errorListener?.(
            new CodexAppServerError(
              'CODEX_APP_SERVER_DISCONNECTED',
              'Codex app-server disconnected.',
            ),
          );
        }, 0);
      } else if (this.mode !== 'timeout') {
        queueMicrotask(() => {
          this.listener?.({
            method: 'turn/completed',
            params: {
              threadId,
              turn: {
                id: turnId,
                status: this.mode === 'turn-failed'
                  ? 'failed'
                  : this.mode === 'malformed'
                    ? 'unknown'
                    : 'completed',
                ...(this.mode === 'turn-failed'
                  ? {error: {message: 'The provider refused this turn.'}}
                  : {}),
                items: this.mode === 'empty'
                  ? [{type: 'agentMessage', text: '', phase: 'final_answer'}]
                  : [],
              },
            },
          });
        });
      }
      return {turn: {id: turnId}};
    }
    if (method === 'turn/interrupt') return {};
    throw new Error(`Unexpected method: ${method}`);
  }

  subscribe(listener: (notification: CodexAppServerNotification) => void) {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  subscribeErrors(listener: (error: Error) => void) {
    this.errorListener = listener;
    return () => {
      this.errorListener = null;
    };
  }

  close() {}
}

test('turn/start reject được phân loại và giữ operation/provider message đã sanitize', async () => {
  await assert.rejects(
    structuredRunInput(
      new StructuredFailureFakeClient('turn-start-reject'),
      [{type: 'text', text: 'repair direct TSX'}],
    ),
    (error: unknown) =>
      error instanceof CodexStructuredGenerationError &&
      error.reason === 'turn_start_rejected' &&
      error.code === 'CODEX_TURN_START_REJECTED' &&
      error.operation === 'turn/start' &&
      error.providerMessage?.includes('turn/start rejected') === true,
  );
});

test('turn/completed failed giữ provider message và không bị biến thành empty response', async () => {
  await assert.rejects(
    structuredRunInput(
      new StructuredFailureFakeClient('turn-failed'),
      [{type: 'text', text: 'repair direct TSX'}],
    ),
    (error: unknown) =>
      error instanceof CodexStructuredGenerationError &&
      error.reason === 'turn_failed' &&
      error.code === 'CODEX_TURN_FAILED' &&
      error.operation === 'turn/completed' &&
      error.providerMessage === 'The provider refused this turn.',
  );
});

test('structured generation preserves initialize process diagnostics', async () => {
  await assert.rejects(
    structuredRunInput(
      new StructuredFailureFakeClient('initialize-disconnect'),
      [{type: 'text', text: 'generate direct TSX'}],
    ),
    (error: unknown) =>
      error instanceof CodexStructuredGenerationError &&
      error.reason === 'app_server_disconnect' &&
      error.operation === 'thread/start' &&
      error.appServerDiagnostics?.exitCode === 1 &&
      error.appServerDiagnostics.method === 'initialize' &&
      error.appServerDiagnostics.stderr === 'authentication failed [REDACTED_SECRET]',
  );
});

test('turn/start transport error is not classified as a request rejection', async () => {
  await assert.rejects(
    structuredRunInput(
      new StructuredFailureFakeClient('turn-start-transport'),
      [{type: 'text', text: 'repair direct TSX'}],
    ),
    (error: unknown) =>
      error instanceof CodexStructuredGenerationError &&
      error.reason === 'transport_error' &&
      error.code === 'CODEX_TRANSPORT_ERROR' &&
      error.operation === 'turn/start',
  );
});

test('structured generation phân biệt timeout cục bộ', async () => {
  await assert.rejects(
    structuredRunInputWithTimeout(
      new StructuredFailureFakeClient('timeout'),
      [{type: 'text', text: 'repair direct TSX'}],
      10,
    ),
    (error: unknown) =>
      error instanceof CodexStructuredGenerationError &&
      error.reason === 'timeout' &&
      error.code === 'CODEX_TURN_TIMEOUT' &&
      error.operation === 'turn/completed',
  );
});

test('structured generation phân biệt response rỗng', async () => {
  await assert.rejects(
    structuredRunInput(
      new StructuredFailureFakeClient('empty'),
      [{type: 'text', text: 'repair direct TSX'}],
    ),
    (error: unknown) =>
      error instanceof CodexStructuredGenerationError &&
      error.reason === 'empty_response' &&
      error.code === 'CODEX_EMPTY_RESPONSE' &&
      error.operation === 'turn/completed',
  );
});

test('structured generation phân biệt app-server disconnect khi đang chờ turn', async () => {
  await assert.rejects(
    structuredRunInput(
      new StructuredFailureFakeClient('disconnect'),
      [{type: 'text', text: 'repair direct TSX'}],
    ),
    (error: unknown) =>
      error instanceof CodexStructuredGenerationError &&
      error.reason === 'app_server_disconnect' &&
      error.code === 'CODEX_APP_SERVER_DISCONNECTED' &&
      error.operation === 'turn/completed',
  );
});

test('structured generation phân biệt turn/completed sai schema', async () => {
  await assert.rejects(
    structuredRunInput(
      new StructuredFailureFakeClient('malformed'),
      [{type: 'text', text: 'repair direct TSX'}],
    ),
    (error: unknown) =>
      error instanceof CodexStructuredGenerationError &&
      error.reason === 'transport_error' &&
      error.code === 'CODEX_APP_SERVER_INVALID_RESPONSE' &&
      error.operation === 'turn/completed',
  );
});

test('turn/start serializes the confirmed image UserInput shape', async () => {
  const client = new StructuredGenerationFakeClient();
  await structuredRunInput(client, [
    {type: 'text', text: 'repair direct TSX'},
    {type: 'image', url: 'data:image/png;base64,AA==', detail: 'high'},
  ]);

  const turn = client.calls.find(call => call.method === 'turn/start');
  assert.deepEqual((turn?.params as {input: unknown}).input, [
    {type: 'text', text: 'repair direct TSX'},
    {type: 'image', url: 'data:image/png;base64,AA==', detail: 'high'},
  ]);
});

test('image input rejection falls back to a text-only turn', async () => {
  const client = new StructuredGenerationFakeClient(true);
  await structuredRunInput(client, [
    {type: 'text', text: 'repair direct TSX'},
    {type: 'image', url: 'data:image/png;base64,AA==', detail: 'high'},
  ]);

  const turnInputs = client.calls
    .filter(call => call.method === 'turn/start')
    .map(call => (call.params as {input: unknown}).input);
  assert.equal(turnInputs.length, 2);
  assert.deepEqual(turnInputs[1], [{type: 'text', text: 'repair direct TSX'}]);
});
