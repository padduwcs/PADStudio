import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  CodexAppServerClient,
  CodexAppServerNotification,
} from './codexConnection.ts';
import {createCodexOutlineRevisionService} from './outlineRevisionService.ts';
import type {TeachingOutlineContent} from '../shared/topic.ts';

const sectionId = '11111111-1111-4111-8111-111111111111';

class FakeCodexClient implements CodexAppServerClient {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  private readonly listeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();
  private threadIndex = 0;
  private readonly outputs: string[];

  constructor(outputs: unknown[]) {
    this.outputs = outputs.map(value =>
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  }

  async request(method: string, params?: unknown) {
    this.calls.push({method, params});
    if (method === 'thread/start') {
      this.threadIndex += 1;
      return {
        thread: {id: `thread-${this.threadIndex}`},
        model: 'test-model',
      };
    }
    if (method === 'turn/start') {
      const threadId = (params as {threadId: string}).threadId;
      const turnId = `turn-${this.threadIndex}`;
      const text = this.outputs.shift() ?? '';
      queueMicrotask(() => {
        this.emit({
          method: 'item/completed',
          params: {
            threadId,
            turnId,
            item: {
              id: `message-${this.threadIndex}`,
              type: 'agentMessage',
              phase: 'final_answer',
              text,
            },
          },
        });
        this.emit({
          method: 'turn/completed',
          params: {
            threadId,
            turn: {
              id: turnId,
              status: 'completed',
              items: [],
            },
          },
        });
      });
      return {turn: {id: turnId}};
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

function content(): TeachingOutlineContent {
  return {
    brief: {
      summary: 'Video giúp người mới hiểu trực giác tìm kiếm nhị phân.',
      assumptions: ['Mảng đầu vào đã được sắp xếp.'],
    },
    centralMessage: 'Mỗi lần so sánh sẽ loại bỏ một nửa vùng tìm kiếm.',
    sections: [{
      id: sectionId,
      title: 'Đặt vấn đề',
      goal: 'Nhận ra giới hạn của cách tìm tuần tự.',
      content: 'Bắt đầu từ nhu cầu tìm một số trong danh sách rất dài.',
      estimatedSeconds: 60,
    }],
  };
}

test('Outline tự sửa patch chỉ thay đổi ngoài scope rồi tiếp tục tạo candidate', async context => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-outline-revision-test-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const repairedContent =
    'Mở đầu bằng tình huống tìm một tên trong danh sách hàng nghìn mục.';
  const client = new FakeCodexClient([
    {
      editSummary: 'Điều chỉnh ví dụ mở đầu.',
      brief: {
        summary: null,
        assumptions: ['AI tự ý thay đổi giả định ngoài phạm vi.'],
      },
      centralMessage: null,
      sections: [],
    },
    {
      editSummary: 'Làm ví dụ mở đầu trực quan hơn.',
      brief: {summary: null, assumptions: null},
      centralMessage: null,
      sections: [{
        sectionId,
        title: null,
        goal: null,
        content: repairedContent,
        estimatedSeconds: null,
      }],
    },
    {
      verdict: 'coherent',
      summary: 'Bản sửa giữ đúng phạm vi và vẫn mạch lạc.',
      issues: [],
    },
  ]);
  const service = createCodexOutlineRevisionService(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });

  const result = await service.revise({
    topicInput: {
      topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
      background: {mode: 'dark', color: '#10231D'},
      audience: 'beginner',
      duration: 'standard',
    },
    baseContent: content(),
    scope: {
      globalFields: [],
      sections: [{sectionId, fields: ['content']}],
    },
    guidance: 'Làm ví dụ mở đầu trực quan hơn.',
    reasoningEffort: 'high',
  });

  assert.equal(result.patch.brief.assumptions, null);
  assert.equal(result.content.sections[0]?.content, repairedContent);
  assert.equal(result.coherence.verdict, 'coherent');
  assert.equal(
    client.calls.filter(call => call.method === 'turn/start').length,
    3,
  );
  const repairCall = client.calls.filter(
    call => call.method === 'turn/start',
  )[1];
  assert.match(
    (repairCall?.params as {input?: Array<{text?: string}>})
      .input?.[0]?.text ?? '',
    /Mọi trường ngoài editScope và mọi giá trị không đổi phải là null/u,
  );
});
