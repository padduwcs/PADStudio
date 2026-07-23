import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  CodexAppServerClient,
  CodexAppServerNotification,
} from './codexConnection.ts';
import {createCodexTopicGuidanceGenerator} from './topicGuidanceGenerator.ts';

class FakeCodexClient implements CodexAppServerClient {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  private listeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();

  async request(method: string, params?: unknown) {
    this.calls.push({method, params});
    if (method === 'thread/start') {
      return {thread: {id: 'topic-thread'}, model: 'gpt-test'};
    }
    if (method === 'turn/start') {
      queueMicrotask(() => {
        this.emit({
          method: 'item/completed',
          params: {
            threadId: 'topic-thread',
            turnId: 'topic-turn',
            item: {
              id: 'topic-message',
              type: 'agentMessage',
              phase: 'final_answer',
              text: JSON.stringify({
                learningGoal:
                  'Hiểu trực giác vì sao mỗi bước loại được một nửa dữ liệu.',
                videoDirection:
                  'Mở bằng tình huống tìm kiếm, minh họa vùng tìm kiếm thu hẹp và kết bằng điều kiện áp dụng.',
                suggestedAngles: [
                  'Đối chiếu với tìm tuần tự',
                  'Vai trò của dữ liệu đã sắp xếp',
                ],
              }),
            },
          },
        });
        this.emit({
          method: 'turn/completed',
          params: {
            threadId: 'topic-thread',
            turn: {
              id: 'topic-turn',
              status: 'completed',
              items: [],
            },
          },
        });
      });
      return {turn: {id: 'topic-turn'}};
    }
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

test('Codex tạo bản nháp định hướng có cấu trúc từ topic', async context => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-topic-guidance-test-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient();
  const generator = createCodexTopicGuidanceGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });

  const result = await generator.generate({
    topicInput: {
      topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
      audience: 'beginner',
      duration: 'standard',
    },
    reasoningEffort: 'medium',
  });

  assert.equal(result.model, 'gpt-test');
  assert.equal(result.suggestion.suggestedAngles.length, 2);
  const turn = client.calls.find(call => call.method === 'turn/start');
  assert.equal(
    (turn?.params as {effort?: string}).effort,
    'medium',
  );
});
