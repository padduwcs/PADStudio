import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import {access} from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import type {
  CodexConnectionStatus,
  CodexQuotaSummary,
  CodexLoginStart,
  CodexModelSummary,
} from '../shared/codex.ts';

const REQUEST_TIMEOUT_MS = 20_000;
export const CODEX_APP_SERVER_STDERR_MAX_CHARS = 8_000;
const STDERR_TRUNCATION_MARKER = '\n[stderr truncated]\n';

export type CodexLaunch = {
  command: string;
  args: string[];
  source?: 'path-codex-exe' | 'path-codex-cmd' | 'desktop-codex-exe' | 'path-codex';
};

export interface CodexLaunchDiagnostics {
  commandBasename: string;
  entrypointBasename: string | null;
  args: string[];
  pathEntryCount: number;
  pathHasCodexExe: boolean;
  pathHasCodexCmd: boolean;
  homeSource: 'HOME' | 'USERPROFILE' | 'HOMEDRIVE+HOMEPATH' | 'unset';
  codexHomeConfigured: boolean;
  cwdBasename: string;
}

export interface CodexAppServerProcessDiagnostics {
  exitCode: number | null;
  signal: string | null;
  commandBasename: string | null;
  entrypointBasename: string | null;
  cliVersion: string | null;
  method: string | null;
  pendingMethods: string[];
  stderr: string | null;
}

function pathBasename(value: string | null | undefined) {
  if (!value) return null;
  return path.basename(value).slice(0, 120) || null;
}

function sensitiveEnvironmentPaths(environment: NodeJS.ProcessEnv) {
  return [
    environment.HOME,
    environment.USERPROFILE,
    environment.HOMEDRIVE && environment.HOMEPATH
      ? path.join(environment.HOMEDRIVE, environment.HOMEPATH)
      : null,
  ].filter((value): value is string => Boolean(value?.trim()));
}

export function redactCodexDiagnosticText(
  value: string,
  sensitivePaths: readonly string[] = sensitiveEnvironmentPaths(process.env),
) {
  let redacted = String(value);
  for (const sensitivePath of [...sensitivePaths]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(sensitivePath).join('[REDACTED_PATH]');
  }
  return redacted
    .replace(
      /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/giu,
      '[REDACTED_DATA_URL]',
    )
    .replace(
      /(?:[a-z]:[\\/]+Users[\\/][^\\/\s]+(?:[\\/][^\s"'`),;]+)*)/giu,
      '[REDACTED_PATH]',
    )
    .replace(
      /(?:\/(?:home|Users)\/[^\s"'`),;]+(?:\/[^\s"'`),;]+)*)/gu,
      '[REDACTED_PATH]',
    )
    .replace(
      /\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{12,}\b/gu,
      '[REDACTED_CREDENTIAL]',
    )
    .replace(
      /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/giu,
      'Bearer [REDACTED_TOKEN]',
    )
    .replace(
      /((?:(?:api|access|auth|refresh|client|private)[_-]?(?:key|token|secret)|token|secret|password|credential|authorization)\s*[:=]\s*["'`]?)(?!\[REDACTED_[A-Z_]+\])[^"'`\s,;)}\]]+/giu,
      '$1[REDACTED_SECRET]',
    )
    .replace(
      /(?<![a-z0-9+/=_-])[a-z0-9+/=_-]{96,}(?![a-z0-9+/=_-])/giu,
      '[REDACTED_BASE64]',
    );
}

class BoundedStderrCapture {
  private value = '';

  append(chunk: string | Buffer) {
    if (this.value.length >= CODEX_APP_SERVER_STDERR_MAX_CHARS) return;
    const remaining = CODEX_APP_SERVER_STDERR_MAX_CHARS - this.value.length;
    this.value += String(chunk).slice(0, remaining);
  }

  text(sensitivePaths: readonly string[]) {
    const redacted = redactCodexDiagnosticText(this.value, sensitivePaths);
    if (redacted.length <= CODEX_APP_SERVER_STDERR_MAX_CHARS) return redacted;
    const contentLength = CODEX_APP_SERVER_STDERR_MAX_CHARS - STDERR_TRUNCATION_MARKER.length;
    return `${redacted.slice(0, Math.max(0, contentLength))}${STDERR_TRUNCATION_MARKER}`;
  }
}

/** UserInput variants emitted by the current app-server protocol. The image
 * shape is intentionally kept here, next to the stdio transport, so callers
 * cannot accidentally use the different `input_image` agent-content shape. */
export type CodexImageDetail = 'auto' | 'low' | 'high' | 'original';

export type CodexUserInput =
  | {
      type: 'text';
      text: string;
      text_elements?: readonly unknown[];
    }
  | {
      type: 'image';
      url: string;
      detail?: CodexImageDetail | null;
    }
  | {
      type: 'localImage';
      path: string;
      detail?: CodexImageDetail | null;
    }
  | {type: 'audio'; url: string}
  | {type: 'localAudio'; path: string}
  | {type: 'skill'; name: string; path: string}
  | {type: 'mention'; name: string; path: string};

export interface CodexTurnStartParams {
  threadId: string;
  input: CodexUserInput[];
  [key: string]: unknown;
}

export function isCodexImageInput(item: CodexUserInput): item is Extract<
  CodexUserInput,
  {type: 'image' | 'localImage'}
> {
  return item.type === 'image' || item.type === 'localImage';
}

/** Detects a protocol-level rejection so older app-servers can fall back to
 * text without treating ordinary model/provider failures as image fallback. */
export function isCodexImageInputUnsupported(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b(?:image|localImage|input_image|image_url|image input)\b/iu.test(message) &&
    /\b(?:unsupported|not supported|unknown|unrecognized|invalid|unexpected|cannot|can't)\b/iu.test(message)
  );
}

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
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type CodexAppServerNotification = {
  method: string;
  params?: unknown;
};

export interface CodexAppServerClient {
  request(method: 'turn/start', params: CodexTurnStartParams): Promise<unknown>;
  request(method: string, params?: unknown): Promise<unknown>;
  subscribe(
    listener: (notification: CodexAppServerNotification) => void,
  ): () => void;
  /** Transport failures that occur while waiting for a turn completion are
   * not JSON-RPC notifications, so structured generation can classify them
   * separately from a model-reported failed turn. */
  subscribeErrors?(listener: (error: Error) => void): () => void;
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

/** Stable transport-level signals used by structured generation diagnostics.
 * The provider/app-server message is kept on the error only long enough for
 * the caller to redact and bound it before persistence. */
export type CodexAppServerErrorCode =
  | 'CODEX_APP_SERVER_NOT_FOUND'
  | 'CODEX_APP_SERVER_SPAWN_FAILED'
  | 'CODEX_APP_SERVER_CLOSED'
  | 'CODEX_APP_SERVER_PROCESS_ERROR'
  | 'CODEX_APP_SERVER_NOT_READY'
  | 'CODEX_APP_SERVER_REQUEST_TIMEOUT'
  | 'CODEX_APP_SERVER_REQUEST_WRITE_FAILED'
  | 'CODEX_APP_SERVER_REQUEST_REJECTED'
  | 'CODEX_APP_SERVER_INVALID_RESPONSE'
  | 'CODEX_APP_SERVER_DISCONNECTED';

export type CodexAppServerErrorReason =
  | 'not_found'
  | 'spawn_failed'
  | 'closed'
  | 'process_error'
  | 'not_ready'
  | 'request_timeout'
  | 'request_write_failed'
  | 'request_rejected'
  | 'invalid_response'
  | 'disconnected';

function appServerErrorReason(code: CodexAppServerErrorCode): CodexAppServerErrorReason {
  const reasons: Record<CodexAppServerErrorCode, CodexAppServerErrorReason> = {
    CODEX_APP_SERVER_NOT_FOUND: 'not_found',
    CODEX_APP_SERVER_SPAWN_FAILED: 'spawn_failed',
    CODEX_APP_SERVER_CLOSED: 'closed',
    CODEX_APP_SERVER_PROCESS_ERROR: 'process_error',
    CODEX_APP_SERVER_NOT_READY: 'not_ready',
    CODEX_APP_SERVER_REQUEST_TIMEOUT: 'request_timeout',
    CODEX_APP_SERVER_REQUEST_WRITE_FAILED: 'request_write_failed',
    CODEX_APP_SERVER_REQUEST_REJECTED: 'request_rejected',
    CODEX_APP_SERVER_INVALID_RESPONSE: 'invalid_response',
    CODEX_APP_SERVER_DISCONNECTED: 'disconnected',
  };
  return reasons[code];
}

export class CodexAppServerError extends Error {
  readonly code: CodexAppServerErrorCode;
  readonly reason: CodexAppServerErrorReason;
  readonly unavailable: boolean;
  readonly method: string | null;
  readonly remoteCode: string | null;
  readonly processDiagnostics: CodexAppServerProcessDiagnostics | null;

  constructor(
    code: CodexAppServerErrorCode,
    message: string,
    options: ErrorOptions & {
      unavailable?: boolean;
      method?: string | null;
      remoteCode?: string | number | null;
      processDiagnostics?: CodexAppServerProcessDiagnostics | null;
    } = {},
  ) {
    super(message, options);
    this.code = code;
    this.reason = appServerErrorReason(code);
    this.unavailable = options.unavailable ?? false;
    this.method = options.method ?? null;
    this.remoteCode = options.remoteCode === null || options.remoteCode === undefined
      ? null
      : String(options.remoteCode).slice(0, 120);
    this.processDiagnostics = options.processDiagnostics ?? null;
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

async function findExecutable(candidate: string) {
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function resolveCodexLaunch(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CodexLaunch> {
  const pathValue = environment.Path ?? environment.PATH ?? '';
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
        return {command: executable, args: ['app-server'], source: 'path-codex-exe'};
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
          source: 'path-codex-cmd',
        };
      }
    }

    // The Windows desktop app registers Codex as an App Path, which makes it
    // available to interactive shells even when its bin directory is absent
    // from a child process' PATH. The backend launches the CLI directly, so
    // discover that standard per-user install location as well. This keeps a
    // working desktop installation from looking disconnected in PAD Studio.
    const localAppData = environment.LOCALAPPDATA?.trim();
    if (localAppData) {
      const desktopCli = await findExecutable(
        path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
      );
      if (desktopCli) return {command: desktopCli, args: ['app-server'], source: 'desktop-codex-exe'};
    }
  } else {
    for (const directory of pathEntries) {
      const executable = await findExecutable(
        path.join(directory, 'codex'),
      );
      if (executable) {
        return {command: executable, args: ['app-server'], source: 'path-codex'};
      }
    }
  }

  throw new CodexAppServerError(
    'CODEX_APP_SERVER_NOT_FOUND',
    'Không tìm thấy Codex CLI trong PATH.',
    {unavailable: true},
  );
}

export function createCodexProcessEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const configuredHomeDirectory = environment.HOME?.trim();
  const profileDirectory = environment.USERPROFILE?.trim();
  const driveDirectory = environment.HOMEDRIVE?.trim();
  const homePath = environment.HOMEPATH?.trim();
  const resolvedHomeDirectory =
    configuredHomeDirectory ||
    profileDirectory ||
    (driveDirectory && homePath ? path.join(driveDirectory, homePath) : null);

  if (!resolvedHomeDirectory) return environment;

  const withHome = configuredHomeDirectory
    ? environment
    : {...environment, HOME: resolvedHomeDirectory};
  if (withHome.CODEX_HOME?.trim()) return withHome;
  return {
    ...withHome,
    CODEX_HOME: path.join(resolvedHomeDirectory, '.codex'),
  };
}

export function describeCodexLaunch(
  launch: CodexLaunch,
  environment: NodeJS.ProcessEnv = process.env,
): CodexLaunchDiagnostics {
  const pathValue = environment.Path ?? environment.PATH ?? '';
  const pathEntries = pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => path.isAbsolute(entry));
  const homeSource = environment.HOME?.trim()
    ? 'HOME'
    : environment.USERPROFILE?.trim()
      ? 'USERPROFILE'
      : environment.HOMEDRIVE?.trim() && environment.HOMEPATH?.trim()
        ? 'HOMEDRIVE+HOMEPATH'
        : 'unset';
  const pathLikeArg = launch.args.find((argument) => path.isAbsolute(argument));
  return {
    commandBasename: pathBasename(launch.command) ?? 'unknown',
    entrypointBasename: pathBasename(pathLikeArg),
    args: launch.args.map((argument) => path.isAbsolute(argument)
      ? pathBasename(argument) ?? 'unknown'
      : argument.slice(0, 80)),
    pathEntryCount: pathEntries.length,
    pathHasCodexExe: launch.source === 'path-codex-exe' || launch.source === 'desktop-codex-exe',
    pathHasCodexCmd: launch.source === 'path-codex-cmd',
    homeSource,
    codexHomeConfigured: Boolean(environment.CODEX_HOME?.trim()),
    cwdBasename: pathBasename(process.cwd()) ?? 'unknown',
  };
}

function cliVersionFromStderr(stderr: string) {
  const match = /\b(?:codex(?:\s+cli)?|openai\s+codex)[^\d]{0,24}v?(\d+(?:\.\d+){1,3}(?:[-+][a-z0-9.-]+)?)\b/iu.exec(stderr);
  return match?.[1]?.slice(0, 80) ?? null;
}

export type CodexAppServerSpawnProcess = (
  launch: CodexLaunch,
  environment: NodeJS.ProcessEnv,
) => ChildProcessWithoutNullStreams;

export interface StdioCodexAppServerClientOptions {
  resolveLaunch?: () => Promise<CodexLaunch>;
  spawnProcess?: CodexAppServerSpawnProcess;
  environment?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

type CodexAppServerProcessState = {
  child: ChildProcessWithoutNullStreams;
  launch: CodexLaunch;
  environment: NodeJS.ProcessEnv;
  stderr: BoundedStderrCapture;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

function defaultSpawnCodexAppServer(
  launch: CodexLaunch,
  environment: NodeJS.ProcessEnv,
) {
  return spawn(launch.command, launch.args, {
    cwd: process.cwd(),
    env: environment,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function processDiagnostics(
  state: CodexAppServerProcessState | null,
  options: {
    method?: string | null;
    pendingMethods?: readonly string[];
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
  } = {},
): CodexAppServerProcessDiagnostics | null {
  if (!state) return null;
  const pendingMethods = [...new Set(
    (options.pendingMethods ?? []).filter(method => Boolean(method)),
  )].slice(0, 16);
  const method = options.method === undefined
    ? pendingMethods[0] ?? null
    : options.method;
  const stderr = state.stderr.text(sensitiveEnvironmentPaths(state.environment));
  return {
    exitCode: options.exitCode === undefined ? state.exitCode : options.exitCode,
    signal: options.signal === undefined ? state.signal : options.signal,
    commandBasename: pathBasename(state.launch.command),
    entrypointBasename: pathBasename(
      state.launch.args.find(argument => path.isAbsolute(argument)),
    ),
    cliVersion: cliVersionFromStderr(stderr),
    method,
    pendingMethods,
    stderr: stderr || null,
  };
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
  private errorListeners = new Set<(error: Error) => void>();
  private initialized = false;
  private closing = false;
  private processState: CodexAppServerProcessState | null = null;
  private lastProcessError: CodexAppServerError | null = null;
  private readonly resolveLaunch: () => Promise<CodexLaunch>;
  private readonly spawnProcess: CodexAppServerSpawnProcess;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly requestTimeoutMs: number;

  constructor(options: StdioCodexAppServerClientOptions = {}) {
    this.resolveLaunch = options.resolveLaunch ?? (() => resolveCodexLaunch());
    this.spawnProcess = options.spawnProcess ?? defaultSpawnCodexAppServer;
    this.environment = options.environment ?? process.env;
    this.requestTimeoutMs = Math.max(
      1,
      options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    );
  }

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
    const pendingMethods = [...this.pendingRequests.values()].map(
      pending => pending.method,
    );
    const error = new CodexAppServerError(
      'CODEX_APP_SERVER_CLOSED',
      'Codex app-server đã đóng.',
      {
        method: pendingMethods[0] ?? null,
        processDiagnostics: processDiagnostics(this.processState, {
          method: pendingMethods[0] ?? null,
          pendingMethods,
        }),
      },
    );
    this.rejectPending(error);
    this.emitError(error);
    this.lineReader?.close();
    this.lineReader = null;
    this.child?.kill();
    this.child = null;
    this.processState = null;
    this.lastProcessError = null;
    this.startPromise = null;
    this.initialized = false;
    this.notificationListeners.clear();
    this.errorListeners.clear();
  }

  subscribeErrors(listener: (error: Error) => void) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Starts the exact app-server transport and waits only for initialize.
   * This is intentionally separate from request(): a health probe must never
   * create a thread or spend a generation turn. */
  async healthProbe(stabilityMs = 250) {
    await this.ensureStarted();
    await delay(Math.max(0, Math.min(2_000, stabilityMs)));
    if (!this.initialized || !this.child || this.lastProcessError) {
      throw this.lastProcessError ?? new CodexAppServerError(
        'CODEX_APP_SERVER_DISCONNECTED',
        'Codex app-server khÃ´ng á»•n Ä‘á»‹nh sau initialize.',
        {
          processDiagnostics: processDiagnostics(this.processState),
        },
      );
    }
    return {
      initialize: 'passed' as const,
      stable: true as const,
      launch: describeCodexLaunch(this.processState!.launch, this.processState!.environment),
      processDiagnostics: processDiagnostics(this.processState),
    };
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
    const launch = await this.resolveLaunch();
    const environment = createCodexProcessEnvironment(this.environment);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(launch, environment);
    } catch (error) {
      throw new CodexAppServerError(
        'CODEX_APP_SERVER_SPAWN_FAILED',
        'Không thể khởi động Codex CLI.',
        {
          unavailable: true,
          cause: error,
          method: 'initialize',
        },
      );
    }
    this.processState = {
      child,
      launch,
      environment,
      stderr: new BoundedStderrCapture(),
      exitCode: null,
      signal: null,
    };
    this.lastProcessError = null;
    this.child = child;
    child.stderr.on('data', (chunk: Buffer | string) => {
      this.processState?.stderr.append(chunk);
    });
    child.on('close', (code, signal) => this.handleExit(child, code, signal));

    await new Promise<void>((resolve, reject) => {
      const handleSpawn = () => {
        child.off('error', handleError);
        resolve();
      };
      const handleError = (error: Error) => {
        child.off('spawn', handleSpawn);
        reject(
          new CodexAppServerError(
            'CODEX_APP_SERVER_SPAWN_FAILED',
            'Không thể khởi động Codex CLI.',
            {
              unavailable: true,
              cause: error,
              processDiagnostics: processDiagnostics(this.processState),
            },
          ),
        );
      };

      child.once('spawn', handleSpawn);
      child.once('error', handleError);
    });

    child.on('error', (error) => {
      if (this.child !== child || this.closing) return;
      const processError = new CodexAppServerError(
        'CODEX_APP_SERVER_PROCESS_ERROR',
        'Codex app-server gặp lỗi tiến trình.',
        {
          cause: error,
          method: [...this.pendingRequests.values()][0]?.method ?? null,
          processDiagnostics: processDiagnostics(this.processState, {
            pendingMethods: [...this.pendingRequests.values()].map(
              pending => pending.method,
            ),
          }),
        },
      );
      this.lastProcessError = processError;
      this.rejectPending(processError);
      this.emitError(processError);
    });

    this.lineReader = readline.createInterface({input: child.stdout});
    this.lineReader.on('line', (line) => this.handleLine(line));

    let initializeResponse: z.infer<typeof initializeResponseSchema>;
    try {
      initializeResponse = initializeResponseSchema.parse(
        await this.sendRequest('initialize', {
          clientInfo: {
            name: 'pad_studio',
            title: 'PAD Studio',
            version: '0.1.0',
          },
          capabilities: null,
        }),
      );
    } catch (error) {
      if (error instanceof CodexAppServerError) throw error;
      throw new CodexAppServerError(
        'CODEX_APP_SERVER_INVALID_RESPONSE',
        'Codex app-server trả về thông tin khởi tạo không hợp lệ.',
        {
          method: 'initialize',
          cause: error,
          processDiagnostics: processDiagnostics(this.processState, {
            method: 'initialize',
            pendingMethods: ['initialize'],
          }),
        },
      );
    }

    if (!initializeResponse.userAgent) {
      throw new CodexAppServerError(
        'CODEX_APP_SERVER_INVALID_RESPONSE',
        'Codex app-server trả về thông tin khởi tạo không hợp lệ.',
        {
          method: 'initialize',
          processDiagnostics: processDiagnostics(this.processState, {
            method: 'initialize',
            pendingMethods: ['initialize'],
          }),
        },
      );
    }

    this.sendNotification('initialized', {});
    this.initialized = true;
  }

  private sendRequest(method: string, params?: unknown) {
    const child = this.child;
    if (!child?.stdin.writable) {
      return Promise.reject(
        new CodexAppServerError(
          'CODEX_APP_SERVER_NOT_READY',
          'Codex app-server chưa sẵn sàng.',
          {
            unavailable: true,
            method,
            processDiagnostics: processDiagnostics(this.processState, {method}),
          },
        ),
      );
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        const pendingMethods = [...this.pendingRequests.values()].map(
          pending => pending.method,
        );
        reject(
          new CodexAppServerError(
            'CODEX_APP_SERVER_REQUEST_TIMEOUT',
            `Codex không phản hồi yêu cầu “${method}” đúng hạn.`,
            {
              method,
              processDiagnostics: processDiagnostics(this.processState, {
                method,
                pendingMethods: [method, ...pendingMethods],
              }),
            },
          ),
        );
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {method, resolve, reject, timeout});
      child.stdin.write(
        `${JSON.stringify({method, id, params})}\n`,
        (error) => {
          if (!error) return;
          const pendingRequest = this.pendingRequests.get(id);
          if (!pendingRequest) return;
          clearTimeout(pendingRequest.timeout);
          this.pendingRequests.delete(id);
          reject(
            new CodexAppServerError(
              'CODEX_APP_SERVER_REQUEST_WRITE_FAILED',
              'Không thể gửi yêu cầu đến Codex app-server.',
              {
                method,
                cause: error,
                processDiagnostics: processDiagnostics(this.processState, {
                  method,
                  pendingMethods: [
                    method,
                    ...[...this.pendingRequests.values()].map(
                      pending => pending.method,
                    ),
                  ],
                }),
              },
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

    if ('error' in message && message.error && typeof message.error === 'object') {
      const remoteMessage =
        'message' in message.error && message.error.message !== undefined
          ? redactCodexDiagnosticText(String(message.error.message))
          : 'Codex app-server rejected the request.';
      const remoteCode =
        'code' in message.error &&
        (typeof message.error.code === 'string' ||
          typeof message.error.code === 'number')
          ? message.error.code
          : null;
      pendingRequest.reject(
        new CodexAppServerError(
          'CODEX_APP_SERVER_REQUEST_REJECTED',
          remoteMessage,
          {
            method: pendingRequest.method,
            remoteCode,
            processDiagnostics: processDiagnostics(this.processState, {
              method: pendingRequest.method,
              pendingMethods: [pendingRequest.method],
            }),
          },
        ),
      );
      return;
    }

    pendingRequest.resolve('result' in message ? message.result : null);
  }

  private handleExit(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ) {
    if (this.child !== child) return;

    const pendingMethods = [...this.pendingRequests.values()].map(
      pending => pending.method,
    );
    const state = this.processState;
    if (state) {
      state.exitCode = code;
      state.signal = signal;
    }

    this.child = null;
    this.lineReader?.close();
    this.lineReader = null;
    this.startPromise = null;
    this.initialized = false;

    if (this.closing) return;

    const error = new CodexAppServerError(
      'CODEX_APP_SERVER_DISCONNECTED',
      `Codex app-server đã dừng${code === null ? '' : ` (${code})`}.`,
      {
        method: pendingMethods[0] ?? null,
        processDiagnostics: processDiagnostics(state, {
          method: pendingMethods[0] ?? null,
          pendingMethods,
          exitCode: code,
          signal,
        }),
      },
    );
    this.lastProcessError = error;
    this.rejectPending(error);
    this.emitError(error);
  }

  private rejectPending(error: Error) {
    for (const pendingRequest of this.pendingRequests.values()) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error);
    }
    this.pendingRequests.clear();
  }

  private emitError(error: Error) {
    for (const listener of this.errorListeners) listener(error);
  }
}

export async function runCodexAppServerHealthProbe(options: {
  stabilityMs?: number;
  client?: StdioCodexAppServerClient;
} = {}) {
  const client = options.client ?? new StdioCodexAppServerClient();
  try {
    return await client.healthProbe(options.stabilityMs);
  } finally {
    if (!options.client) client.close();
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
          error instanceof CodexAppServerError &&
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
