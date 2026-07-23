import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  CodexAppServerClient,
  CodexAppServerNotification,
} from './codexConnection.ts';
import {
  createCodexVoiceVisualRevisionService,
} from './voiceVisualRevisionService.ts';
import type {
  TeachingOutline,
  VoiceVisualPlanContent,
} from '../shared/topic.ts';

const sectionId = '11111111-1111-4111-8111-111111111111';
const beatId = '22222222-2222-4222-8222-222222222222';

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

function outline(): TeachingOutline {
  const sourceInput = {
    topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
    background: {mode: 'dark' as const, color: '#10231D'},
    audience: 'beginner' as const,
    duration: 'concise' as const,
  };
  return {
    brief: {
      summary: 'Giải thích trực giác chia đôi vùng tìm kiếm.',
      assumptions: ['Dữ liệu đã được sắp xếp.'],
    },
    centralMessage: 'Mỗi bước đúng loại bỏ một nửa vùng tìm kiếm.',
    sections: [{
      id: sectionId,
      title: 'Thu hẹp vùng tìm kiếm',
      goal: 'Hiểu vai trò của phần tử giữa.',
      content: 'So sánh với phần tử giữa rồi giữ nửa phù hợp.',
      estimatedSeconds: 45,
    }],
    status: 'approved',
    contentRevision: 1,
    sourceInput,
    generation: {
      generationId: '33333333-3333-4333-8333-333333333333',
      provider: 'codex',
      model: 'test-model',
      promptVersion: 'outline-v3',
      generatedAt: '2026-07-23T00:00:00.000Z',
      usage: null,
    },
  };
}

function content(): VoiceVisualPlanContent {
  return {
    voiceDirection: 'Kể rõ ràng, gần gũi và liền mạch.',
    visualDirection: 'Dùng vùng sáng để biểu diễn phạm vi còn lại.',
    timingCalibration: {
      source: 'default',
      whitespaceTokensPerMinute: 195,
      charactersPerSecond: 14.5,
      voiceId: null,
      modelId: null,
      voiceName: null,
      sampleCount: 0,
    },
    sections: [{
      outlineSectionId: sectionId,
      beats: [{
        id: beatId,
        voiceover: 'Ta bắt đầu với toàn bộ vùng có thể chứa đáp án.',
        spokenVoiceover:
          'Ta bắt đầu với toàn bộ vùng có thể chứa đáp án.',
        visualDescription: 'Một dải số sáng toàn bộ trên nền tối.',
        animationDescription: 'Dải số hiện dần từ trái sang phải.',
        visualHoldSeconds: 0,
        durationSeconds: 8,
      }],
    }],
  };
}

test('Voice–visual tự sửa phản hồi sai schema rồi giữ patch đúng scope', async context => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-voice-revision-test-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient([
    {editSummary: 'x', beats: []},
    {
      patch: {
        summary: 'Làm vùng tìm kiếm trực quan hơn.',
        beats: {
          [beatId]: {
            visualDescription:
              'Một dải số với khung sáng bao trọn vùng đang xét.',
          },
        },
      },
    },
    {
      verdict: 'coherent',
      summary: 'Visual mới vẫn khớp lời kể và đúng phạm vi.',
      issues: [],
    },
  ]);
  const service = createCodexVoiceVisualRevisionService(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });
  const result = await service.revise({
    topicInput: outline().sourceInput,
    outline: outline(),
    baseContent: content(),
    scope: {
      globalFields: [],
      beats: [{beatId, fields: ['visualDescription']}],
    },
    guidance: 'Làm phạm vi tìm kiếm rõ hơn.',
    reasoningEffort: 'high',
  });

  assert.equal(
    result.content.sections[0]?.beats[0]?.visualDescription,
    'Một dải số với khung sáng bao trọn vùng đang xét.',
  );
  assert.equal(result.coherence.verdict, 'coherent');
  assert.equal(
    client.calls.filter(call => call.method === 'turn/start').length,
    3,
  );
  const reviewCall = client.calls.filter(
    call => call.method === 'turn/start',
  )[2];
  assert.equal(
    (reviewCall?.params as {effort?: string}).effort,
    'medium',
  );
});
