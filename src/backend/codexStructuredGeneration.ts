import {mkdir} from 'node:fs/promises';
import {z} from 'zod';
import type {CodexTokenUsage} from '../shared/topic.ts';
import type {
  CodexAppServerClient,
  CodexAppServerNotification,
} from './codexConnection.ts';

function configuredGenerationTimeoutMs() {
  const raw = process.env.PAD_CODEX_GENERATION_TIMEOUT_MS?.trim();
  if (!raw) return null;
  const configured = Number(raw);
  if (!Number.isFinite(configured)) return null;
  return Math.max(60_000, Math.min(60 * 60 * 1000, Math.floor(configured)));
}

const configuredTimeoutMs = configuredGenerationTimeoutMs();

// Larger reasoning models can legitimately need several minutes, especially
// for structured TSX. Keep a finite guard, but do not interrupt a healthy turn
// after the old three-minute window.
export const DEFAULT_CODEX_GENERATION_TIMEOUT_MS =
  configuredTimeoutMs ?? 10 * 60 * 1000;

const reasoningTimeoutsMs: Record<string, number> = {
  none: 10 * 60 * 1000,
  minimal: 10 * 60 * 1000,
  low: 10 * 60 * 1000,
  medium: 15 * 60 * 1000,
  high: 25 * 60 * 1000,
  xhigh: 35 * 60 * 1000,
  max: 45 * 60 * 1000,
  ultra: 60 * 60 * 1000,
};

export function codexGenerationTimeoutMs(
  reasoningEffort?: string,
  minimumMs = DEFAULT_CODEX_GENERATION_TIMEOUT_MS,
) {
  if (configuredTimeoutMs !== null) return configuredTimeoutMs;
  return Math.max(
    minimumMs,
    reasoningTimeoutsMs[reasoningEffort ?? ''] ??
      35 * 60 * 1000,
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
          .object({message: z.string()})
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

type GenerationFailureReason =
  | 'timeout'
  | 'turn_failed'
  | 'tool_used'
  | 'empty_response';

export class CodexStructuredGenerationError extends Error {
  readonly reason: GenerationFailureReason;

  constructor(
    reason: GenerationFailureReason,
    message: string,
  ) {
    super(message);
    this.reason = reason;
  }
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
}) {
  await mkdir(runtimeDirectory, {recursive: true});

  let threadId = '';
  let turnId = '';
  let usage: CodexTokenUsage | null = null;
  let resolveCompletion!: (
    completion: z.infer<typeof turnCompletedSchema>,
  ) => void;
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
  >((resolve) => {
    resolveCompletion = resolve;
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
    if (
      !parsedCompletion.success ||
      parsedCompletion.data.threadId !== threadId
    ) {
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
    const threadResponse = threadStartResponseSchema.parse(
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
    threadId = threadResponse.thread.id;

    const unsubscribe = client.subscribe(handleNotification);
    try {
      const turnResponse = turnStartResponseSchema.parse(
        await client.request('turn/start', {
          threadId,
          input: [{type: 'text', text: prompt}],
          approvalPolicy: 'never',
          sandboxPolicy: {type: 'readOnly'},
          personality: 'none',
          summary: 'none',
          outputSchema,
          ...(reasoningEffort ? {effort: reasoningEffort} : {}),
        }),
      );
      turnId = turnResponse.turn.id;

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
                ),
              ),
            timeoutMs,
          );
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      });

      if (completion.turn.status !== 'completed') {
        throw new CodexStructuredGenerationError(
          'turn_failed',
          completion.turn.error?.message ||
            'Codex không hoàn tất được lượt tạo nội dung.',
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
        );
      }

      return {
        responseText,
        model: threadResponse.model,
        usage,
      };
    } finally {
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
