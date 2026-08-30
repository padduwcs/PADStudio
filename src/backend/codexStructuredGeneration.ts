import {mkdir} from 'node:fs/promises';
import {z} from 'zod';
import type {CodexTokenUsage} from '../shared/topic.ts';
import type {
  CodexAppServerClient,
  CodexAppServerNotification,
  CodexTurnStartParams,
  CodexUserInput,
} from './codexConnection.ts';
import type {CodexAppServerProcessDiagnostics} from './codexConnection.ts';
import {
  CodexAppServerError,
  isCodexImageInput,
  isCodexImageInputUnsupported,
  redactCodexDiagnosticText,
} from './codexConnection.ts';

function configuredGenerationTimeoutMs() {
  const raw = process.env.PAD_CODEX_GENERATION_TIMEOUT_MS?.trim();
  if (!raw) return null;
  const configured = Number(raw);
  if (!Number.isFinite(configured)) return null;
  return Math.max(
    60_000,
    Math.min(3 * 60 * 60 * 1000, Math.floor(configured)),
  );
}

const configuredTimeoutMs = configuredGenerationTimeoutMs();

// Larger reasoning models can legitimately need several minutes, especially
// for structured TSX. Keep a finite guard, but do not interrupt a healthy turn
// after the old three-minute window.
export const DEFAULT_CODEX_GENERATION_TIMEOUT_MS =
  configuredTimeoutMs ?? 15 * 60 * 1000;

const reasoningTimeoutsMs: Record<string, number> = {
  none: 15 * 60 * 1000,
  minimal: 15 * 60 * 1000,
  low: 15 * 60 * 1000,
  medium: 25 * 60 * 1000,
  high: 40 * 60 * 1000,
  xhigh: 60 * 60 * 1000,
  max: 90 * 60 * 1000,
  ultra: 120 * 60 * 1000,
};

export function codexGenerationTimeoutMs(
  reasoningEffort?: string,
  minimumMs = DEFAULT_CODEX_GENERATION_TIMEOUT_MS,
) {
  if (configuredTimeoutMs !== null) return configuredTimeoutMs;
  return Math.max(
    minimumMs,
    reasoningTimeoutsMs[reasoningEffort ?? ''] ??
      60 * 60 * 1000,
  );
}

const threadStartResponseSchema = z
  .object({
    thread: z.object({id: z.string().min(1)}).passthrough(),
    model: z.string().min(1),
  })
  .passthrough();

const turnStartResponseSchema = z
  .object({
    turn: z.object({id: z.string().min(1)}).passthrough(),
  })
  .passthrough();

const turnCompletedSchema = z
  .object({
    threadId: z.string(),
    turn: z
      .object({
        id: z.string(),
        status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
        error: z
          .object({
            message: z.string(),
            code: z.union([z.string(), z.number()]).optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        items: z.array(z.object({type: z.string()}).passthrough()),
      })
      .passthrough(),
  })
  .passthrough();

const tokenUsageNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    tokenUsage: z.object({
      last: z.object({
        inputTokens: z.number().int().nonnegative(),
        cachedInputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        reasoningOutputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
      }),
    }),
  })
  .passthrough();

const itemCompletedSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    item: z.object({type: z.string()}).passthrough(),
  })
  .passthrough();

const agentMessageSchema = z
  .object({
    type: z.literal('agentMessage'),
    text: z.string(),
    phase: z
      .enum(['commentary', 'final_answer', 'final'])
      .nullable()
      .optional(),
  })
  .passthrough();

export type CodexStructuredGenerationFailureReason =
  | 'turn_start_rejected'
  | 'app_server_disconnect'
  | 'transport_error'
  | 'model_capacity'
  | 'rate_limit'
  | 'timeout'
  | 'transport_timeout'
  | 'turn_failed'
  | 'tool_used'
  | 'empty_response';

export class CodexStructuredGenerationError extends Error {
  readonly reason: CodexStructuredGenerationFailureReason;
  readonly code: string;
  readonly operation: string | null;
  readonly providerMessage: string | null;
  readonly providerCode: string | null;
  readonly model: string | null;
  readonly appServerDiagnostics: CodexAppServerProcessDiagnostics | null;

  constructor(
    reason: CodexStructuredGenerationFailureReason,
    message: string,
    options: ErrorOptions & {
      code?: string;
      operation?: string;
      providerMessage?: string | null;
      providerCode?: string | number | null;
      model?: string | null;
      appServerDiagnostics?: CodexAppServerProcessDiagnostics | null;
    } = {},
  ) {
    super(sanitizeStructuredFailureText(message), options);
    this.reason = reason;
    this.code = options.code ?? `CODEX_STRUCTURED_${reason.toUpperCase()}`;
    this.operation = options.operation ?? null;
    this.providerMessage = options.providerMessage
      ? sanitizeStructuredFailureText(options.providerMessage).slice(0, 2_000)
      : null;
    this.providerCode = options.providerCode === null || options.providerCode === undefined
      ? null
      : String(options.providerCode).slice(0, 120);
    this.model = options.model ?? null;
    this.appServerDiagnostics = options.appServerDiagnostics ?? null;
  }
}

function sanitizeStructuredFailureText(value: string) {
  return redactCodexDiagnosticText(value)
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
    );
}

function errorText(error: unknown) {
  return sanitizeStructuredFailureText(
    error instanceof Error ? error.message : String(error),
  ).slice(0, 2_000);
}

function providerFailureReason(message: string, remoteCode?: string | null) {
  const text = `${remoteCode ?? ''} ${message}`;
  if (/(?:model|selected model).*(?:capacity|overloaded|busy)|(?:capacity|overloaded|busy).*(?:model|selected model)|at capacity/iu.test(text)) {
    return 'model_capacity' as const;
  }
  if (/(?:rate[ _-]?limit|too many requests|quota|credits|\b429\b)/iu.test(text)) {
    return 'rate_limit' as const;
  }
  return null;
}

function wrapTransportError(
  error: unknown,
  operation: string,
  model?: string,
) {
  if (error instanceof CodexStructuredGenerationError) return error;
  const message = errorText(error) || 'Codex app-server request failed.';
  const appServerError = error instanceof CodexAppServerError ? error : null;
  const providerReason = providerFailureReason(
    message,
    appServerError?.remoteCode,
  );
  const explicitTurnStartRejection =
    appServerError?.code === 'CODEX_APP_SERVER_REQUEST_REJECTED' ||
    (operation === 'turn/start' &&
      /(?:turn\/start.*(?:reject|refus|den(?:y|ied)|not allowed)|(?:reject|refus|den(?:y|ied)).*turn\/start)/iu.test(message));
  const reason = (
    appServerError?.code === 'CODEX_APP_SERVER_DISCONNECTED' ||
    appServerError?.code === 'CODEX_APP_SERVER_CLOSED'
  )
    ? 'app_server_disconnect'
    : appServerError?.code === 'CODEX_APP_SERVER_REQUEST_TIMEOUT'
      ? 'transport_timeout'
      : providerReason
        ? providerReason
        : explicitTurnStartRejection
          ? 'turn_start_rejected'
          : 'transport_error';
  const code = reason === 'app_server_disconnect'
    ? 'CODEX_APP_SERVER_DISCONNECTED'
    : reason === 'transport_timeout'
      ? 'CODEX_APP_SERVER_REQUEST_TIMEOUT'
      : reason === 'model_capacity'
        ? 'CODEX_MODEL_CAPACITY'
        : reason === 'rate_limit'
          ? 'CODEX_RATE_LIMIT'
          : reason === 'turn_start_rejected'
            ? 'CODEX_TURN_START_REJECTED'
            : appServerError?.code ?? 'CODEX_TRANSPORT_ERROR';
  return new CodexStructuredGenerationError(
    reason,
    message,
    {
      code,
      operation,
      providerMessage: message,
      providerCode: appServerError?.remoteCode,
      model,
      appServerDiagnostics: appServerError?.processDiagnostics,
      cause: error,
    },
  );
}

function wrapProtocolResponseError(
  error: unknown,
  operation: string,
  model?: string,
) {
  return new CodexStructuredGenerationError(
    'transport_error',
    'Codex app-server trả về response không hợp lệ.',
    {
      code: 'CODEX_APP_SERVER_INVALID_RESPONSE',
      operation,
      providerMessage: errorText(error) || null,
      model,
      appServerDiagnostics:
        error instanceof CodexAppServerError
          ? error.processDiagnostics
          : null,
      cause: error,
    },
  );
}

/**
 * Codex structured outputs use the strict JSON Schema subset: every property
 * declared on an object must also be listed in `required`. Zod intentionally
 * omits optional properties from that list, which makes otherwise useful
 * nullable patch schemas fail before the model can run. Normalize the schema
 * at the shared transport boundary so nested objects and future generators
 * cannot accidentally send an invalid response format.
 */
export function strictCodexOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => strictCodexOutputSchema(item));
  }
  if (!schema || typeof schema !== 'object') return schema;

  const source = schema as Record<string, unknown>;
  const normalized = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      strictCodexOutputSchema(value),
    ]),
  ) as Record<string, unknown>;
  const properties = source.properties;
  if (
    properties &&
    typeof properties === 'object' &&
    !Array.isArray(properties)
  ) {
    normalized.required = Object.keys(properties);
    normalized.additionalProperties = false;
  }

  return normalized;
}

function finalAgentMessage(items: Array<Record<string, unknown>>) {
  let fallback = '';

  for (const item of items) {
    const parsedMessage = agentMessageSchema.safeParse(item);
    if (!parsedMessage.success) continue;
    if (parsedMessage.data.phase !== 'commentary') {
      fallback = parsedMessage.data.text;
    }
    if (
      parsedMessage.data.phase === 'final_answer' ||
      parsedMessage.data.phase === 'final'
    ) {
      return parsedMessage.data.text;
    }
  }

  return fallback;
}

function mergeItems(
  streamedItems: Array<Record<string, unknown>>,
  completedItems: Array<Record<string, unknown>>,
) {
  const mergedItems: Array<Record<string, unknown>> = [];
  const seenIds = new Set<string>();

  for (const item of [...streamedItems, ...completedItems]) {
    const id = typeof item.id === 'string' ? item.id : '';
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    mergedItems.push(item);
  }

  return mergedItems;
}

function assertNoTools(items: Array<Record<string, unknown>>) {
  const allowedItemTypes = new Set([
    'userMessage',
    'agentMessage',
    'reasoning',
  ]);
  const unexpectedItem = items.find(
    (item) =>
      typeof item.type === 'string' && !allowedItemTypes.has(item.type),
  );

  if (unexpectedItem) {
    throw new CodexStructuredGenerationError(
      'tool_used',
      'Codex đã cố dùng công cụ trong một lượt chỉ được phép tạo dữ liệu.',
    );
  }
}

export async function runCodexStructuredGeneration({
  client,
  runtimeDirectory,
  timeoutMs = DEFAULT_CODEX_GENERATION_TIMEOUT_MS,
  outputSchema,
  prompt,
  baseInstructions,
  developerInstructions,
  model,
  reasoningEffort,
  input,
}: {
  client: CodexAppServerClient;
  runtimeDirectory: string;
  timeoutMs?: number;
  outputSchema: unknown;
  prompt: string;
  baseInstructions: string;
  developerInstructions: string;
  model?: string;
  reasoningEffort?: string;
  /** Exact `turn/start.params.input` items. Defaults to one text item. */
  input?: CodexUserInput[];
}): Promise<{
  responseText: string;
  model: string;
  usage: CodexTokenUsage | null;
}> {
  await mkdir(runtimeDirectory, {recursive: true});
  const strictOutputSchema = strictCodexOutputSchema(outputSchema);

  let threadId = '';
  let turnId = '';
  let usage: CodexTokenUsage | null = null;
  const turnInput: CodexUserInput[] = input?.slice() ?? [
    {type: 'text', text: prompt},
  ];
  const textOnlyInput: CodexUserInput[] = turnInput.filter(
    item => item.type === 'text',
  );
  const hasImageInput = turnInput.some(isCodexImageInput);
  let resolveCompletion!: (
    completion: z.infer<typeof turnCompletedSchema>,
  ) => void;
  let rejectCompletion!: (error: CodexStructuredGenerationError) => void;
  const earlyCompletions = new Map<
    string,
    z.infer<typeof turnCompletedSchema>
  >();
  const completedItems = new Map<
    string,
    Array<Record<string, unknown>>
  >();
  const completionPromise = new Promise<
    z.infer<typeof turnCompletedSchema>
  >((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  const handleNotification = (
    notification: CodexAppServerNotification,
  ) => {
    if (notification.method === 'item/completed') {
      const parsedItem = itemCompletedSchema.safeParse(notification.params);
      if (parsedItem.success && parsedItem.data.threadId === threadId) {
        const turnItems = completedItems.get(parsedItem.data.turnId) ?? [];
        turnItems.push(parsedItem.data.item);
        completedItems.set(parsedItem.data.turnId, turnItems);
      }
      return;
    }

    if (notification.method === 'thread/tokenUsage/updated') {
      const parsedUsage = tokenUsageNotificationSchema.safeParse(
        notification.params,
      );
      if (
        parsedUsage.success &&
        parsedUsage.data.threadId === threadId &&
        (!turnId || parsedUsage.data.turnId === turnId)
      ) {
        usage = parsedUsage.data.tokenUsage.last;
      }
      return;
    }

    if (notification.method !== 'turn/completed') return;
    const parsedCompletion = turnCompletedSchema.safeParse(
      notification.params,
    );
    if (!parsedCompletion.success) {
      const params = notification.params;
      if (
        params &&
        typeof params === 'object' &&
        'threadId' in params &&
        params.threadId === threadId
      ) {
        rejectCompletion(
          wrapProtocolResponseError(
            parsedCompletion.error,
            'turn/completed',
            model,
          ),
        );
      }
      return;
    }
    if (parsedCompletion.data.threadId !== threadId) {
      return;
    }

    if (parsedCompletion.data.turn.id === turnId) {
      resolveCompletion(parsedCompletion.data);
    } else {
      earlyCompletions.set(
        parsedCompletion.data.turn.id,
        parsedCompletion.data,
      );
    }
  };

  try {
    let threadResponse: z.infer<typeof threadStartResponseSchema>;
    try {
      threadResponse = threadStartResponseSchema.parse(
        await client.request('thread/start', {
          ephemeral: true,
          cwd: runtimeDirectory,
          approvalPolicy: 'never',
          sandbox: 'read-only',
          personality: 'none',
          baseInstructions,
          developerInstructions,
          ...(model ? {model} : {}),
        }),
      );
    } catch (error) {
      if (error instanceof CodexStructuredGenerationError) throw error;
      if (error instanceof z.ZodError || (error instanceof CodexAppServerError && error.code === 'CODEX_APP_SERVER_INVALID_RESPONSE')) {
        throw wrapProtocolResponseError(error, 'thread/start', model);
      }
      throw wrapTransportError(error, 'thread/start', model);
    }
    threadId = threadResponse.thread.id;

      const unsubscribe = client.subscribe(handleNotification);
    let unsubscribeError: (() => void) | undefined;
    try {
      const turnParams = (turnInputForRequest: CodexUserInput[]): CodexTurnStartParams => ({
        threadId,
        input: turnInputForRequest,
        approvalPolicy: 'never',
        sandboxPolicy: {type: 'readOnly'},
        personality: 'none',
        summary: 'none',
        outputSchema: strictOutputSchema,
        ...(reasoningEffort ? {effort: reasoningEffort} : {}),
      });
      let turnResponse: z.infer<typeof turnStartResponseSchema>;
      try {
        turnResponse = turnStartResponseSchema.parse(
          await client.request('turn/start', turnParams(turnInput)),
        );
      } catch (error) {
        if (
          !hasImageInput ||
          !isCodexImageInputUnsupported(error) ||
          textOnlyInput.length === 0
        ) {
          if (error instanceof CodexStructuredGenerationError) throw error;
          if (error instanceof z.ZodError || (error instanceof CodexAppServerError && error.code === 'CODEX_APP_SERVER_INVALID_RESPONSE')) {
            throw wrapProtocolResponseError(error, 'turn/start', model);
          }
          throw wrapTransportError(error, 'turn/start', model);
        }
        // The current protocol accepts `type: "image"`; this branch is only
        // for an older/alternate app-server that rejects that input variant.
        try {
          turnResponse = turnStartResponseSchema.parse(
            await client.request('turn/start', turnParams(textOnlyInput)),
          );
        } catch (fallbackError) {
          if (fallbackError instanceof z.ZodError || (fallbackError instanceof CodexAppServerError && fallbackError.code === 'CODEX_APP_SERVER_INVALID_RESPONSE')) {
            throw wrapProtocolResponseError(fallbackError, 'turn/start', model);
          }
          throw wrapTransportError(fallbackError, 'turn/start', model);
        }
      }
      if (!turnResponse) {
        throw wrapTransportError(new Error('Codex turn/start did not return a response.'), 'turn/start', model);
      }
      turnId = turnResponse.turn.id;
      unsubscribeError = client.subscribeErrors?.(error => {
        rejectCompletion(
          wrapTransportError(error, 'turn/completed', threadResponse.model),
        );
      });

      const earlyCompletion = earlyCompletions.get(turnId);
      if (earlyCompletion) resolveCompletion(earlyCompletion);

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const completion = await Promise.race([
        completionPromise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new CodexStructuredGenerationError(
                  'timeout',
                  'Codex mất quá nhiều thời gian để tạo nội dung.',
                  {
                    code: 'CODEX_TURN_TIMEOUT',
                    operation: 'turn/completed',
                    model: threadResponse.model,
                  },
                ),
              ),
            timeoutMs,
          );
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      });

      if (completion.turn.status !== 'completed') {
        const providerMessage = completion.turn.error?.message ?? null;
        const providerCode = completion.turn.error?.code === undefined
          ? null
          : String(completion.turn.error.code);
        const classifiedReason = providerFailureReason(
          providerMessage ?? '',
          providerCode,
        );
        const reason = classifiedReason ?? 'turn_failed';
        throw new CodexStructuredGenerationError(
          reason,
          providerMessage || 'Codex không hoàn tất được lượt tạo nội dung.',
          {
            code: reason === 'model_capacity'
              ? 'CODEX_MODEL_CAPACITY'
              : reason === 'rate_limit'
                ? 'CODEX_RATE_LIMIT'
                : 'CODEX_TURN_FAILED',
            operation: 'turn/completed',
            providerMessage,
            providerCode,
            model: threadResponse.model,
          },
        );
      }

      const items = mergeItems(
        completedItems.get(turnId) ?? [],
        completion.turn.items,
      );
      assertNoTools(items);
      const responseText = finalAgentMessage(items);
      if (!responseText) {
        throw new CodexStructuredGenerationError(
          'empty_response',
          'Codex không trả về nội dung.',
          {
            code: 'CODEX_EMPTY_RESPONSE',
            operation: 'turn/completed',
            model: threadResponse.model,
          },
        );
      }

      return {
        responseText,
        model: threadResponse.model,
        usage,
      };
    } finally {
      unsubscribeError?.();
      unsubscribe();
    }
  } catch (error) {
    if (
      error instanceof CodexStructuredGenerationError &&
      error.reason === 'timeout' &&
      threadId &&
      turnId
    ) {
      await client
        .request('turn/interrupt', {threadId, turnId})
        .catch(() => undefined);
    }
    throw error;
  }
}
