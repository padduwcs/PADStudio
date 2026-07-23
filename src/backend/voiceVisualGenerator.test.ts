import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  CodexAppServerClient,
  CodexAppServerNotification,
} from './codexConnection.ts';
import {createCodexVoiceVisualGenerator} from './voiceVisualGenerator.ts';

function assertStrictObjectSchemas(schema: unknown, path = 'root') {
  if (!schema || typeof schema !== 'object') return;
  const node = schema as Record<string, unknown>;
  const properties =
    node.properties && typeof node.properties === 'object'
      ? (node.properties as Record<string, unknown>)
      : null;
  if (node.type === 'object' && properties) {
    assert.deepEqual(
      node.required,
      Object.keys(properties),
      `${path} phải đánh dấu mọi property là required.`,
    );
    assert.equal(
      node.additionalProperties,
      false,
      `${path} phải từ chối property ngoài schema.`,
    );
    for (const [key, value] of Object.entries(properties)) {
      assertStrictObjectSchemas(value, `${path}.${key}`);
    }
  }
  if ('items' in node) {
    assertStrictObjectSchemas(node.items, `${path}[]`);
  }
  for (const unionKey of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = node[unionKey];
    if (!Array.isArray(branches)) continue;
    branches.forEach((branch, index) =>
      assertStrictObjectSchemas(branch, `${path}.${unionKey}[${index}]`),
    );
  }
}

class FakeCodexClient implements CodexAppServerClient {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  private listeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();

  async request(method: string, params?: unknown) {
    this.calls.push({method, params});

    if (method === 'thread/start') {
      return {thread: {id: 'thread-1'}, model: 'test-model'};
    }

    if (method === 'turn/start') {
      queueMicrotask(() => {
        this.emit({
          method: 'item/completed',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            item: {
              id: 'message-1',
              type: 'agentMessage',
              phase: 'final_answer',
              text: JSON.stringify({
                voiceDirection:
                  'Giọng kể gần gũi, rõ ràng và có nhịp nghỉ tự nhiên.',
                visualDirection:
                  'Hình khối tối giản, màu sắc chỉ dùng để chỉ vùng đang xét.',
                sections: [
                  {
                    beats: [
                      {
                        voiceover:
                          'Hãy hình dung ta đang tìm một giá trị trong cả dãy.',
                        spokenVoiceover:
                          'Hãy hình dung ta đang tìm một giá trị trong cả dãy.',
                        visualDescription:
                          'Một dãy phần tử trải ngang và toàn bộ vùng được sáng.',
                        animationDescription:
                          'Dãy xuất hiện lần lượt rồi dừng ở trạng thái đầy đủ.',
                      },
                    ],
                  },
                  {
                    beats: [
                      {
                        voiceover:
                          'Ta nhìn vào phần tử giữa để loại một nửa không thể chứa đáp án.',
                        spokenVoiceover:
                          'Ta nhìn vào phần tử giữa để loại một nửa không thể chứa đáp án.',
                        visualDescription:
                          'Phần tử giữa nổi bật, một nửa dãy chuyển sang màu mờ.',
                        animationDescription:
                          'Con trỏ đi vào giữa rồi nửa bị loại thu nhỏ và biến mất.',
                      },
                    ],
                  },
                ],
              }),
            },
          },
        });
        this.emit({
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: {
              id: 'turn-1',
              status: 'completed',
              items: [],
            },
          },
        });
      });
      return {turn: {id: 'turn-1'}};
    }

    if (method === 'turn/interrupt') return {};
    throw new Error(`Unexpected method: ${method}`);
  }

  subscribe(listener: (notification: CodexAppServerNotification) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {}

  private emit(notification: CodexAppServerNotification) {
    for (const listener of this.listeners) listener(notification);
  }
}

test('Codex voice–visual generator ánh xạ kết quả vào đúng section outline', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-voice-visual-test-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient();
  const generator = createCodexVoiceVisualGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });
  const firstSectionId = randomUUID();
  const secondSectionId = randomUUID();
  const sourceInput = {
    topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
    learningGoal: 'Hiểu trực giác chia đôi.',
    background: {mode: 'dark' as const, color: '#10231D'},
    audience: 'beginner' as const,
    duration: 'concise' as const,
  };

  const result = await generator.generate({
    reasoningEffort: 'xhigh',
    topicInput: sourceInput,
    outline: {
      brief: {
        summary: 'Video giúp người mới hiểu trực giác chia đôi dữ liệu.',
        assumptions: ['Dữ liệu đã được sắp xếp.'],
      },
      centralMessage:
        'Mỗi quyết định đúng giúp loại bỏ một nửa vùng tìm kiếm.',
      sections: [
        {
          id: firstSectionId,
          title: 'Đặt vấn đề',
          goal: 'Nhìn thấy vùng tìm kiếm ban đầu.',
          content: 'Giới thiệu một dãy dài có chứa giá trị cần tìm.',
          estimatedSeconds: 20,
        },
        {
          id: secondSectionId,
          title: 'Chia đôi',
          goal: 'Hiểu cách loại một nửa.',
          content: 'Dùng phần tử giữa để chọn nửa còn khả năng.',
          estimatedSeconds: 30,
        },
      ],
      status: 'approved',
      contentRevision: 1,
      sourceInput,
      generation: {
        generationId: randomUUID(),
        provider: 'codex',
        model: 'outline-model',
        promptVersion: 'outline-v1',
        generatedAt: new Date().toISOString(),
        usage: null,
      },
    },
  });

  assert.equal(result.model, 'test-model');
  assert.deepEqual(
    result.content.sections.map((section) => section.outlineSectionId),
    [firstSectionId, secondSectionId],
  );
  assert.match(
    result.content.sections[0]?.beats[0]?.id ?? '',
    /^[0-9a-f-]{36}$/,
  );
  assert.equal(result.content.sections[0]?.beats[0]?.visualHoldSeconds, 0);
  assert.ok(
    (result.content.sections[0]?.beats[0]?.durationSeconds ?? 0) >= 4,
  );

  const turnCall = client.calls.find((call) => call.method === 'turn/start');
  const turnParams = turnCall?.params as {
    input?: Array<{text?: string}>;
    outputSchema?: {
      properties?: {
        sections?: {
          items?: {
            properties?: {
              beats?: {
                items?: {
                  properties?: Record<string, unknown>;
                  required?: string[];
                };
              };
            };
          };
        };
      };
    };
    effort?: unknown;
  };
  assert.ok(turnParams.outputSchema);
  assertStrictObjectSchemas(turnParams.outputSchema);
  const generatedBeatSchema =
    turnParams.outputSchema.properties?.sections?.items?.properties?.beats
      ?.items;
  assert.ok(generatedBeatSchema?.required?.includes('spokenVoiceover'));
  assert.equal(turnParams.effort, 'xhigh');
  assert.equal(
    turnParams.input?.[0]?.text?.includes('currentPlan'),
    false,
  );
  assert.equal(
    turnParams.input?.[0]?.text?.includes('targetNarrationTokenCount'),
    true,
  );
});
