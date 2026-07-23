import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  CodexAppServerClient,
  CodexAppServerNotification,
} from './codexConnection.ts';
import {createCodexOutlineGenerator} from './outlineGenerator.ts';

class FakeCodexClient implements CodexAppServerClient {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  private listeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();

  async request(method: string, params?: unknown) {
    this.calls.push({method, params});

    if (method === 'thread/start') {
      return {
        thread: {id: 'thread-1'},
        model: 'test-model',
      };
    }

    if (method === 'turn/start') {
      queueMicrotask(() => {
        this.emit({
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            tokenUsage: {
              last: {
                inputTokens: 100,
                cachedInputTokens: 10,
                outputTokens: 60,
                reasoningOutputTokens: 20,
                totalTokens: 180,
              },
              total: {
                inputTokens: 100,
                cachedInputTokens: 10,
                outputTokens: 60,
                reasoningOutputTokens: 20,
                totalTokens: 180,
              },
            },
          },
        });
        this.emit({
          method: 'item/completed',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            completedAtMs: Date.now(),
            item: {
              id: 'message-1',
              type: 'agentMessage',
              phase: 'final_answer',
              text: JSON.stringify({
                brief: {
                  summary:
                    'Video ngắn giúp người mới hiểu trực giác chia đôi.',
                  assumptions: ['Dữ liệu đã được sắp xếp.'],
                },
                centralMessage:
                  'Mỗi bước loại bỏ một nửa vùng tìm kiếm.',
                sections: [
                  {
                    title: 'Đặt vấn đề',
                    goal: 'Thấy giới hạn của tìm kiếm tuần tự.',
                    content:
                      'Mở đầu bằng nhu cầu tìm một giá trị trong dãy dài.',
                    estimatedSeconds: 30,
                  },
                  {
                    title: 'Chia đôi',
                    goal: 'Hiểu vì sao có thể bỏ một nửa dữ liệu.',
                    content:
                      'So sánh phần tử giữa và giữ lại nửa phù hợp.',
                    estimatedSeconds: 60,
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
              itemsView: 'notLoaded',
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

test('Codex outline generator nhận kết quả từ item stream khi turn không chứa items', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-outline-test-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient();
  const generator = createCodexOutlineGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });

  const result = await generator.generate({
    reasoningEffort: 'high',
    topicInput: {
      topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
      learningGoal: 'Hiểu trực giác chia đôi.',
      videoDirection: 'Video dọc 90 giây, ngắn gọn, không dùng code.',
      background: {mode: 'light', color: '#F5F7F4'},
      audience: 'beginner',
      duration: 'concise',
    },
  });

  assert.equal(result.model, 'test-model');
  assert.equal(result.content.sections.length, 2);
  assert.match(result.content.sections[0]?.id ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(result.usage?.totalTokens, 180);

  const threadCall = client.calls.find(
    (call) => call.method === 'thread/start',
  );
  assert.deepEqual(
    {
      ephemeral: (threadCall?.params as {ephemeral?: unknown}).ephemeral,
      sandbox: (threadCall?.params as {sandbox?: unknown}).sandbox,
      approvalPolicy: (
        threadCall?.params as {approvalPolicy?: unknown}
      ).approvalPolicy,
    },
    {
      ephemeral: true,
      sandbox: 'read-only',
      approvalPolicy: 'never',
    },
  );

  const turnCall = client.calls.find((call) => call.method === 'turn/start');
  const turnParams = turnCall?.params as {
    input?: Array<{text?: string}>;
    outputSchema?: unknown;
    summary?: unknown;
    effort?: unknown;
  };
  assert.ok(turnParams.outputSchema);
  assert.equal(turnParams.summary, 'none');
  assert.equal(turnParams.effort, 'high');
  assert.equal(turnParams.input?.[0]?.text?.includes('currentOutline'), false);
});
