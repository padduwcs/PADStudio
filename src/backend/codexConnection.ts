import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import {access} from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {z} from 'zod';
import type {
  CodexConnectionStatus,
  CodexQuotaSummary,
  CodexLoginStart,
  CodexModelSummary,
} from '../shared/codex.ts';

const REQUEST_TIMEOUT_MS = 20_000;

const initializeResponseSchema = z
  .object({
    userAgent: z.string().min(1),
  })
  .passthrough();

const accountResponseSchema = z
  .object({
    account: z
      .discriminatedUnion('type', [
        z
          .object({
            type: z.literal('chatgpt'),
            email: z.string().nullable(),
            planType: z.string(),
          })
          .passthrough(),
        z.object({type: z.literal('apiKey')}).passthrough(),
        z.object({type: z.literal('amazonBedrock')}).passthrough(),
      ])
      .nullable(),
    requiresOpenaiAuth: z.boolean(),
  })
  .passthrough();

const rateLimitWindowSchema = z
  .object({
    usedPercent: z.number().finite(),
    windowDurationMins: z.number().int().positive().nullable().optional(),
    resetsAt: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();

const creditsSnapshotSchema = z
  .object({
    hasCredits: z.boolean(),
    unlimited: z.boolean(),
    balance: z.string().nullable().optional(),
  })
  .passthrough();

const individualLimitSchema = z
  .object({
    limit: z.string(),
    used: z.string(),
    remainingPercent: z.number().int(),
    resetsAt: z.number().int().nonnegative(),
  })
  .passthrough();

const rateLimitSnapshotSchema = z
  .object({
    limitId: z.string().nullable().optional(),
    limitName: z.string().nullable().optional(),
    planType: z.string().nullable().optional(),
    primary: rateLimitWindowSchema.nullable().optional(),
    secondary: rateLimitWindowSchema.nullable().optional(),
    credits: creditsSnapshotSchema.nullable().optional(),
    individualLimit: individualLimitSchema.nullable().optional(),
    rateLimitReachedType: z.string().nullable().optional(),
  })
  .passthrough();

const rateLimitsResponseSchema = z
  .object({
    rateLimits: rateLimitSnapshotSchema.nullable().optional(),
    rateLimitsByLimitId: z
      .record(z.string(), rateLimitSnapshotSchema)
      .nullable()
      .optional(),
  })
  .passthrough();

const modelListResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string().min(1),
            model: z.string().min(1).optional(),
            displayName: z.string().min(1).optional(),
            description: z.string().optional(),
            isDefault: z.boolean().optional(),
            supportedReasoningEfforts: z
              .array(
                z
                  .object({reasoningEffort: z.string().min(1)})
                  .passthrough(),
              )
              .optional(),
            defaultReasoningEffort: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const loginResponseSchema = z
  .object({
    type: z.literal('chatgpt'),
    loginId: z.string().min(1),
    authUrl: z.string().url(),
  })
  .passthrough();

const apiKeyLoginResponseSchema = z
  .object({type: z.literal('apiKey')})
  .passthrough();

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type CodexAppServerNotification = {
  method: string;
  params?: unknown;
};

export interface CodexAppServerClient {
  request(method: string, params?: unknown): Promise<unknown>;
  subscribe(
    listener: (notification: CodexAppServerNotification) => void,
  ): () => void;
  close(): void;
}

export interface CodexConnectionService {
  verifyConnection(): Promise<CodexConnectionStatus>;
  startChatGptLogin(): Promise<CodexLoginStart>;
  loginWithApiKey(apiKey: string): Promise<void>;
  logout(): Promise<void>;
  listModels(): Promise<CodexModelSummary[]>;
  close(): void;
}

export class CodexConnectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function percentage(value: number) {
  return Math.min(100, Math.max(0, value));
}

function resetTime(value: number | null | undefined) {
  if (!value) return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function quotaSummary(
  response: z.infer<typeof rateLimitsResponseSchema>,
  refreshedAt: string,
): CodexQuotaSummary | null {
  const namedSnapshots = Object.values(response.rateLimitsByLimitId ?? {});
  const snapshot =
    namedSnapshots.find((item) => item.limitId === 'codex') ??
    response.rateLimits ??
    namedSnapshots[0];
  if (!snapshot) return null;

  const mapWindow = (window: z.infer<typeof rateLimitWindowSchema> | null | undefined) =>
    window
      ? {
          usedPercent: percentage(window.usedPercent),
          remainingPercent: percentage(100 - window.usedPercent),
          windowDurationMinutes: window.windowDurationMins ?? null,
          resetsAt: resetTime(window.resetsAt),
        }
      : null;

  return {
    limitId: snapshot.limitId ?? null,
    limitName: snapshot.limitName ?? null,
    primary: mapWindow(snapshot.primary),
    secondary: mapWindow(snapshot.secondary),
    credits: snapshot.credits
      ? {
          hasCredits: snapshot.credits.hasCredits,
          unlimited: snapshot.credits.unlimited,
          balance: snapshot.credits.balance ?? null,
        }
      : null,
    individualLimit: snapshot.individualLimit
      ? {
          limit: snapshot.individualLimit.limit,
          used: snapshot.individualLimit.used,
          remainingPercent: percentage(
            snapshot.individualLimit.remainingPercent,
          ),
          resetsAt: resetTime(snapshot.individualLimit.resetsAt),
        }
      : null,
    rateLimitReachedType: snapshot.rateLimitReachedType ?? null,
    refreshedAt,
  };
}

class CodexAppServerProcessError extends Error {
  readonly unavailable: boolean;

  constructor(message: string, unavailable = false, options?: ErrorOptions) {
    super(message, options);
    this.unavailable = unavailable;
  }
}

async function findExecutable(candidate: string) {
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

async function resolveCodexLaunch() {
  const pathValue = process.env.Path ?? process.env.PATH ?? '';
  const pathEntries = pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => path.isAbsolute(entry));

  if (process.platform === 'win32') {
    for (const directory of pathEntries) {
      const executable = await findExecutable(
        path.join(directory, 'codex.exe'),
      );
      if (executable) {
        return {command: executable, args: ['app-server']};
      }

      const commandShim = await findExecutable(
        path.join(directory, 'codex.cmd'),
      );
      if (!commandShim) continue;

      const npmEntrypoint = await findExecutable(
        path.join(
          directory,
          'node_modules',
          '@openai',
          'codex',
          'bin',
          'codex.js',
        ),
      );
      if (npmEntrypoint) {
        return {
          command: process.execPath,
          args: [npmEntrypoint, 'app-server'],
        };
      }
    }
  } else {
    for (const directory of pathEntries) {
      const executable = await findExecutable(
        path.join(directory, 'codex'),
      );
      if (executable) {
        return {command: executable, args: ['app-server']};
      }
    }
  }

  throw new CodexAppServerProcessError(
    'Không tìm thấy Codex CLI trong PATH.',
    true,
  );
}

async function spawnCodexAppServer() {
  const launch = await resolveCodexLaunch();
  return spawn(launch.command, launch.args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export class StdioCodexAppServerClient implements CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lineReader: readline.Interface | null = null;
  private startPromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private notificationListeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();
  private initialized = false;
  private closing = false;

  async request(method: string, params?: unknown) {
    await this.ensureStarted();
    return this.sendRequest(method, params);
  }

  subscribe(listener: (notification: CodexAppServerNotification) => void) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  close() {
    this.closing = true;
    this.rejectPending(
      new CodexAppServerProcessError('Codex app-server đã đóng.'),
    );
    this.lineReader?.close();
    this.lineReader = null;
    this.child?.kill();
    this.child = null;
    this.startPromise = null;
    this.initialized = false;
    this.notificationListeners.clear();
  }

  private ensureStarted() {
    if (this.initialized) return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    this.closing = false;
    this.startPromise = this.start().catch((error) => {
      this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }

  private async start() {
    const child = await spawnCodexAppServer();
    this.child = child;
    child.stderr.on('data', () => {
      // Keep stderr drained without exposing paths or authentication details.
    });
    child.on('exit', (code) => this.handleExit(child, code));

    await new Promise<void>((resolve, reject) => {
      const handleSpawn = () => {
        child.off('error', handleError);
        resolve();
      };
      const handleError = (error: Error) => {
        child.off('spawn', handleSpawn);
        reject(
          new CodexAppServerProcessError(
            'Không thể khởi động Codex CLI.',
            true,
            {cause: error},
          ),
        );
      };

      child.once('spawn', handleSpawn);
      child.once('error', handleError);
    });

    child.on('error', (error) => {
      if (this.child !== child || this.closing) return;
      this.rejectPending(
        new CodexAppServerProcessError(
          'Codex app-server gặp lỗi tiến trình.',
          false,
          {cause: error},
        ),
      );
    });

    this.lineReader = readline.createInterface({input: child.stdout});
    this.lineReader.on('line', (line) => this.handleLine(line));

    const initializeResponse = initializeResponseSchema.parse(
      await this.sendRequest('initialize', {
        clientInfo: {
          name: 'pad_studio',
          title: 'PAD Studio',
          version: '0.1.0',
        },
        capabilities: null,
      }),
    );

    if (!initializeResponse.userAgent) {
      throw new CodexAppServerProcessError(
        'Codex app-server trả về thông tin khởi tạo không hợp lệ.',
      );
    }

    this.sendNotification('initialized', {});
    this.initialized = true;
  }

  private sendRequest(method: string, params?: unknown) {
    const child = this.child;
    if (!child?.stdin.writable) {
      return Promise.reject(
        new CodexAppServerProcessError(
          'Codex app-server chưa sẵn sàng.',
          true,
        ),
      );
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new CodexAppServerProcessError(
            `Codex không phản hồi yêu cầu “${method}” đúng hạn.`,
          ),
        );
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, {resolve, reject, timeout});
      child.stdin.write(
        `${JSON.stringify({method, id, params})}\n`,
        (error) => {
          if (!error) return;
          const pendingRequest = this.pendingRequests.get(id);
          if (!pendingRequest) return;
          clearTimeout(pendingRequest.timeout);
          this.pendingRequests.delete(id);
          reject(
            new CodexAppServerProcessError(
              'Không thể gửi yêu cầu đến Codex app-server.',
              false,
              {cause: error},
            ),
          );
        },
      );
    });
  }

  private sendNotification(method: string, params?: unknown) {
    this.child?.stdin.write(`${JSON.stringify({method, params})}\n`);
  }

  private handleLine(line: string) {
    let message: unknown;

    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (!message || typeof message !== 'object') return;

    if ('method' in message && typeof message.method === 'string') {
      if (!('id' in message)) {
        const notification = {
          method: message.method,
          ...('params' in message ? {params: message.params} : {}),
        };
        for (const listener of this.notificationListeners) {
          listener(notification);
        }
      }
      return;
    }

    if (!('id' in message) || typeof message.id !== 'number') {
      return;
    }

    const pendingRequest = this.pendingRequests.get(message.id);
    if (!pendingRequest) return;

    clearTimeout(pendingRequest.timeout);
    this.pendingRequests.delete(message.id);

    if (
      'error' in message &&
      message.error &&
      typeof message.error === 'object' &&
      'message' in message.error
    ) {
      pendingRequest.reject(
        new CodexAppServerProcessError(String(message.error.message)),
      );
      return;
    }

    pendingRequest.resolve('result' in message ? message.result : null);
  }

  private handleExit(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
  ) {
    if (this.child !== child) return;

    const wasInitialized = this.initialized;
    this.child = null;
    this.lineReader?.close();
    this.lineReader = null;
    this.startPromise = null;
    this.initialized = false;

    if (this.closing) return;

    this.rejectPending(
      new CodexAppServerProcessError(
        `Codex app-server đã dừng${code === null ? '' : ` (${code})`}.`,
        !wasInitialized,
      ),
    );
  }

  private rejectPending(error: Error) {
    for (const pendingRequest of this.pendingRequests.values()) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error);
    }
    this.pendingRequests.clear();
  }
}

export function createCodexConnectionService(
  client: CodexAppServerClient = new StdioCodexAppServerClient(),
): CodexConnectionService {
  return {
    async verifyConnection() {
      const checkedAt = new Date().toISOString();

      try {
        const accountResponse = accountResponseSchema.parse(
          await client.request('account/read', {refreshToken: true}),
        );

        if (!accountResponse.account) {
          return {
            state: 'disconnected',
            message: 'Codex CLI chưa đăng nhập tài khoản OpenAI.',
            checkedAt,
          };
        }

        if (accountResponse.account.type === 'amazonBedrock') {
          return {
            state: 'error',
            message:
              'PAD Studio hiện chỉ hỗ trợ kết nối Codex bằng ChatGPT hoặc OpenAI API key.',
            checkedAt,
          };
        }

        const [rateLimitsResponse, modelListResponse] = await Promise.all([
          client.request('account/rateLimits/read'),
          client.request('model/list', {
            limit: 1,
            includeHidden: false,
          }),
        ]);

        const parsedRateLimits = rateLimitsResponseSchema.parse(
          rateLimitsResponse,
        );
        modelListResponseSchema.parse(modelListResponse);

        return {
          state: 'connected',
          account:
            accountResponse.account.type === 'chatgpt'
              ? {
                  type: 'chatgpt',
                  email: accountResponse.account.email,
                  planType: accountResponse.account.planType,
                }
              : {type: 'apiKey'},
          quota: quotaSummary(parsedRateLimits, checkedAt),
          verifiedAt: checkedAt,
        };
      } catch (error) {
        const unavailable =
          error instanceof CodexAppServerProcessError &&
          error.unavailable;

        return {
          state: unavailable ? 'unavailable' : 'error',
          message: unavailable
            ? 'Không tìm thấy hoặc không thể khởi động Codex CLI.'
            : 'Không thể xác minh phiên Codex với dịch vụ OpenAI.',
          checkedAt,
        };
      }
    },

    async startChatGptLogin() {
      try {
        const response = loginResponseSchema.parse(
          await client.request('account/login/start', {
            type: 'chatgpt',
            codexStreamlinedLogin: true,
            useHostedLoginSuccessPage: true,
            appBrand: 'codex',
          }),
        );
        const authUrl = new URL(response.authUrl);
        const trustedLoginHost =
          authUrl.hostname === 'openai.com' ||
          authUrl.hostname.endsWith('.openai.com') ||
          authUrl.hostname === 'chatgpt.com' ||
          authUrl.hostname.endsWith('.chatgpt.com');

        if (authUrl.protocol !== 'https:' || !trustedLoginHost) {
          throw new CodexConnectionError(
            'CODEX_LOGIN_URL_INVALID',
            'Codex trả về URL đăng nhập không an toàn.',
          );
        }

        return {
          loginId: response.loginId,
          authUrl: authUrl.toString(),
        };
      } catch (error) {
        if (error instanceof CodexConnectionError) throw error;

        throw new CodexConnectionError(
          'CODEX_LOGIN_START_FAILED',
          'Không thể bắt đầu đăng nhập Codex.',
          {cause: error},
        );
      }
    },

    async loginWithApiKey(apiKey) {
      const normalized = apiKey.trim();
      if (!normalized) {
        throw new CodexConnectionError(
          'CODEX_API_KEY_REQUIRED',
          'OpenAI API key không được để trống.',
        );
      }
      try {
        apiKeyLoginResponseSchema.parse(
          await client.request('account/login/start', {
            type: 'apiKey',
            apiKey: normalized,
          }),
        );
      } catch (error) {
        if (error instanceof CodexConnectionError) throw error;
        throw new CodexConnectionError(
          'CODEX_API_KEY_LOGIN_FAILED',
          'Codex không chấp nhận OpenAI API key hoặc chưa thể xác minh kết nối.',
          {cause: error},
        );
      }
    },

    async logout() {
      try {
        await client.request('account/logout');
      } catch (error) {
        throw new CodexConnectionError(
          'CODEX_LOGOUT_FAILED',
          'Không thể đăng xuất Codex lúc này.',
          {cause: error},
        );
      }
    },

    async listModels() {
      try {
        const response = modelListResponseSchema.parse(
          await client.request('model/list', {
            limit: 100,
            includeHidden: false,
          }),
        );
        return response.data.map((item) => ({
          id: item.id,
          model: item.model ?? item.id,
          displayName: item.displayName ?? item.model ?? item.id,
          description: item.description ?? '',
          isDefault: item.isDefault ?? false,
          supportedReasoningEfforts:
            item.supportedReasoningEfforts?.map(
              (effort) => effort.reasoningEffort,
            ) ?? [],
          defaultReasoningEffort: item.defaultReasoningEffort ?? null,
        }));
      } catch (error) {
        throw new CodexConnectionError(
          'CODEX_MODEL_LIST_FAILED',
          'Không thể đọc danh sách model khả dụng từ Codex.',
          {cause: error},
        );
      }
    },

    close() {
      client.close();
    },
  };
}
