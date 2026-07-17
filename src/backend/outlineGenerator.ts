import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import type {
  CodexTokenUsage,
  TeachingOutline,
  TeachingOutlineContent,
  TopicInput,
} from '../shared/topic.ts';
import type {
  CodexAppServerClient,
  CodexAppServerNotification,
} from './codexConnection.ts';

const DEFAULT_GENERATION_TIMEOUT_MS = 3 * 60 * 1000;
export const OUTLINE_PROMPT_VERSION = 'outline-v1';

const generatedOutlineSchema = z
  .object({
    brief: z
      .object({
        summary: z.string().trim().min(12).max(700),
        assumptions: z.array(z.string().trim().min(3).max(220)).max(6),
      })
      .strict(),
    centralMessage: z.string().trim().min(10).max(400),
    sections: z
      .array(
        z
          .object({
            title: z.string().trim().min(3).max(120),
            goal: z.string().trim().min(6).max(280),
            content: z.string().trim().min(12).max(900),
            estimatedSeconds: z.number().int().min(10).max(240),
          })
          .strict(),
      )
      .min(2)
      .max(10),
  })
  .strict();

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

const outputJsonSchema = z.toJSONSchema(generatedOutlineSchema, {
  target: 'draft-7',
});

const durationInstructions: Record<TopicInput['duration'], string> = {
  concise: '60–120 giây, thường 2–4 ý',
  standard: '180–300 giây, thường 4–6 ý',
  deep: '360–480 giây, thường 5–8 ý',
};

export interface OutlineGenerationRequest {
  topicInput: TopicInput;
  guidance?: string;
  currentOutline?: TeachingOutline;
}

export interface OutlineGenerationResult {
  content: TeachingOutlineContent;
  model: string;
  usage: CodexTokenUsage | null;
}

export interface OutlineGenerator {
  generate(request: OutlineGenerationRequest): Promise<OutlineGenerationResult>;
}

export class OutlineGenerationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function currentOutlineForPrompt(outline: TeachingOutline) {
  return {
    brief: outline.brief,
    centralMessage: outline.centralMessage,
    sections: outline.sections.map(({id: _id, ...section}) => section),
  };
}

function buildPrompt(request: OutlineGenerationRequest) {
  const payload: Record<string, unknown> = {
    topicInput: request.topicInput,
    targetDuration: durationInstructions[request.topicInput.duration],
  };

  if (request.guidance) {
    payload.guidance = request.guidance;
    if (request.currentOutline) {
      payload.currentOutline = currentOutlineForPrompt(
        request.currentOutline,
      );
    }
  }

  return [
    'Tạo mạch giảng tiếng Việt từ JSON sau.',
    'Giữ đúng ý người dùng; nêu giả định khi đầu vào chưa rõ.',
    'Mỗi ý phải có vai trò riêng và tổng thời lượng phải phù hợp.',
    'Không viết lời thoại, code, cảnh quay, caption hay hướng dẫn animation.',
    JSON.stringify(payload),
  ].join('\n');
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
    throw new OutlineGenerationError(
      'CODEX_OUTLINE_TOOL_USED',
      'Codex đã cố dùng công cụ trong khi tạo mạch giảng.',
    );
  }
}

export function createCodexOutlineGenerator(
  client: CodexAppServerClient,
  options: {
    runtimeDirectory?: string;
    timeoutMs?: number;
  } = {},
): OutlineGenerator {
  const runtimeDirectory =
    options.runtimeDirectory ??
    path.join(os.tmpdir(), 'pad-studio-ai-runtime');
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;

  return {
    async generate(request) {
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
          const parsedItem = itemCompletedSchema.safeParse(
            notification.params,
          );
          if (
            parsedItem.success &&
            parsedItem.data.threadId === threadId
          ) {
            const turnItems =
              completedItems.get(parsedItem.data.turnId) ?? [];
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
            cwd: path.resolve(runtimeDirectory),
            approvalPolicy: 'never',
            sandbox: 'read-only',
            personality: 'none',
            baseInstructions:
              'Bạn lập mạch giảng cho PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
            developerInstructions:
              'Ưu tiên bản chất, trực giác và thứ tự dễ hiểu. AI chỉ đề xuất; người dùng sẽ review.',
          }),
        );
        threadId = threadResponse.thread.id;

        const unsubscribe = client.subscribe(handleNotification);
        try {
          const turnResponse = turnStartResponseSchema.parse(
            await client.request('turn/start', {
              threadId,
              input: [{type: 'text', text: buildPrompt(request)}],
              approvalPolicy: 'never',
              sandboxPolicy: {type: 'readOnly'},
              personality: 'none',
              summary: 'none',
              outputSchema: outputJsonSchema,
            }),
          );
          turnId = turnResponse.turn.id;

          const earlyCompletion = earlyCompletions.get(turnId);
          if (earlyCompletion) {
            resolveCompletion(earlyCompletion);
          }

          let timeout: ReturnType<typeof setTimeout> | undefined;
          const completion = await Promise.race([
            completionPromise,
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(
                () =>
                  reject(
                    new OutlineGenerationError(
                      'CODEX_OUTLINE_TIMEOUT',
                      'Codex mất quá nhiều thời gian để tạo mạch giảng.',
                    ),
                  ),
                timeoutMs,
              );
            }),
          ]).finally(() => {
            if (timeout) clearTimeout(timeout);
          });

          if (completion.turn.status !== 'completed') {
            throw new OutlineGenerationError(
              'CODEX_OUTLINE_GENERATION_FAILED',
              completion.turn.error?.message ||
                'Codex không hoàn tất được mạch giảng.',
            );
          }

          const items = mergeItems(
            completedItems.get(turnId) ?? [],
            completion.turn.items,
          );
          assertNoTools(items);
          const responseText = finalAgentMessage(items);
          if (!responseText) {
            throw new OutlineGenerationError(
              'CODEX_OUTLINE_INVALID_RESPONSE',
              'Codex không trả về nội dung mạch giảng.',
            );
          }

          let responseJson: unknown;
          try {
            responseJson = JSON.parse(responseText);
          } catch (error) {
            throw new OutlineGenerationError(
              'CODEX_OUTLINE_INVALID_RESPONSE',
              'Codex trả về mạch giảng không đúng định dạng.',
              {cause: error},
            );
          }

          const parsedOutline = generatedOutlineSchema.safeParse(responseJson);
          if (!parsedOutline.success) {
            throw new OutlineGenerationError(
              'CODEX_OUTLINE_INVALID_RESPONSE',
              'Codex trả về mạch giảng chưa đúng cấu trúc yêu cầu.',
              {cause: parsedOutline.error},
            );
          }
          const generatedOutline = parsedOutline.data;
          return {
            content: {
              ...generatedOutline,
              sections: generatedOutline.sections.map((section) => ({
                id: randomUUID(),
                ...section,
              })),
            },
            model: threadResponse.model,
            usage,
          };
        } finally {
          unsubscribe();
        }
      } catch (error) {
        if (error instanceof OutlineGenerationError) {
          if (error.code === 'CODEX_OUTLINE_TIMEOUT' && threadId && turnId) {
            await client
              .request('turn/interrupt', {threadId, turnId})
              .catch(() => undefined);
          }
          throw error;
        }

        throw new OutlineGenerationError(
          'CODEX_OUTLINE_GENERATION_FAILED',
          'Không thể tạo mạch giảng bằng Codex.',
          {cause: error},
        );
      }
    },
  };
}
