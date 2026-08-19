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
  assertPlannerOutputHasNoCodeArtifacts,
  createCodexNarrationVisualPlanner,
  NarrationVisualPlannerError,
  validatePlannerCoversUnitsInOrder,
  type NarrationPlannerUnit,
  type NarrationVisualPlannerOutput,
  type NarrationVisualPlannerRequest,
} from './narrationVisualPlanner.ts';

const topicInput = {
  topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
  background: {mode: 'dark' as const, color: '#10231D'},
  videoFrame: {aspectRatio: 'portrait' as const, width: 1080, height: 1920, fps: 30 as const},
  audience: 'beginner' as const,
  duration: 'concise' as const,
};

function unit(id: string, text: string): NarrationPlannerUnit {
  return {id, text};
}

function validVisualBible() {
  return {
    palette: {surface: '#173B31', primary: '#51B68E', accent: '#F5C451', text: '#F7FBF8'},
    typographyScale: {title: 88, label: 42, body: 34},
    shapeLanguage: 'Thẻ bo góc nhất quán, tránh trang trí không mang nghĩa.',
    diagramLanguage: 'Sơ đồ trung tâm với nhãn ngắn và quan hệ rõ ràng.',
    motionTempo: 'Nhịp vừa, mỗi beat một chuyển động có chủ đích.',
    transitionConvention: 'Giữ anchor giữa các scene bằng fade ngắn.',
    visualAnchor: 'Khối trung tâm đại diện chủ đề video.',
  };
}

function validUnitBlueprint(unitId: string) {
  return {
    unitId,
    visualPurpose: 'Biến ý chính của câu thành một quan hệ nhìn thấy được.',
    visualDescription: 'Một sơ đồ trung tâm minh họa quan hệ được nhắc tới.',
    animationDescription: 'Phần tử chính di chuyển vào vị trí rồi giữ hình.',
  };
}

test('validatePlannerCoversUnitsInOrder chấp nhận đúng thứ tự và bao phủ toàn bộ unit', () => {
  const units = [unit('unit-1', 'Câu một.'), unit('unit-2', 'Câu hai.')];
  const scenes: NarrationVisualPlannerOutput['scenes'] = [
    {
      title: 'Scene 1',
      goal: 'Giải thích ý chính.',
      stateHandoffIncoming: null,
      stateHandoffOutgoing: null,
      units: [validUnitBlueprint('unit-1'), validUnitBlueprint('unit-2')],
    },
  ];

  assert.doesNotThrow(() => validatePlannerCoversUnitsInOrder(units, scenes));
});

test('validatePlannerCoversUnitsInOrder từ chối unit bị bỏ sót', () => {
  const units = [unit('unit-1', 'Câu một.'), unit('unit-2', 'Câu hai.')];
  const scenes: NarrationVisualPlannerOutput['scenes'] = [
    {
      title: 'Scene 1',
      goal: 'Giải thích ý chính.',
      stateHandoffIncoming: null,
      stateHandoffOutgoing: null,
      units: [validUnitBlueprint('unit-1')],
    },
  ];

  assert.throws(
    () => validatePlannerCoversUnitsInOrder(units, scenes),
    (error: unknown) =>
      error instanceof NarrationVisualPlannerError &&
      error.code === 'CODEX_NARRATION_PLANNER_INVARIANT_VIOLATION',
  );
});

test('validatePlannerCoversUnitsInOrder từ chối unit bị lặp lại', () => {
  const units = [unit('unit-1', 'Câu một.'), unit('unit-2', 'Câu hai.')];
  const scenes: NarrationVisualPlannerOutput['scenes'] = [
    {
      title: 'Scene 1',
      goal: 'Giải thích ý chính.',
      stateHandoffIncoming: null,
      stateHandoffOutgoing: null,
      units: [
        validUnitBlueprint('unit-1'),
        validUnitBlueprint('unit-1'),
        validUnitBlueprint('unit-2'),
      ],
    },
  ];

  assert.throws(
    () => validatePlannerCoversUnitsInOrder(units, scenes),
    (error: unknown) =>
      error instanceof NarrationVisualPlannerError &&
      error.code === 'CODEX_NARRATION_PLANNER_INVARIANT_VIOLATION',
  );
});

test('validatePlannerCoversUnitsInOrder từ chối unit bị đảo thứ tự', () => {
  const units = [unit('unit-1', 'Câu một.'), unit('unit-2', 'Câu hai.')];
  const scenes: NarrationVisualPlannerOutput['scenes'] = [
    {
      title: 'Scene 1',
      goal: 'Giải thích ý chính.',
      stateHandoffIncoming: null,
      stateHandoffOutgoing: null,
      units: [validUnitBlueprint('unit-2'), validUnitBlueprint('unit-1')],
    },
  ];

  assert.throws(
    () => validatePlannerCoversUnitsInOrder(units, scenes),
    (error: unknown) =>
      error instanceof NarrationVisualPlannerError &&
      error.code === 'CODEX_NARRATION_PLANNER_INVARIANT_VIOLATION',
  );
});

test('assertPlannerOutputHasNoCodeArtifacts từ chối Markdown fence lẫn trong blueprint', () => {
  const output: NarrationVisualPlannerOutput = {
    scenes: [
      {
        title: 'Scene 1',
        goal: 'Giải thích ý chính.',
        stateHandoffIncoming: null,
        stateHandoffOutgoing: null,
        units: [{
          unitId: 'unit-1',
          visualPurpose: 'Biến ý chính của câu thành một quan hệ nhìn thấy được.',
          visualDescription: '```tsx\nconst x = 1;\n```',
          animationDescription: 'Phần tử chính di chuyển vào vị trí rồi giữ hình.',
        }],
      },
    ],
    visualBible: validVisualBible(),
  };

  assert.throws(
    () => assertPlannerOutputHasNoCodeArtifacts(output),
    (error: unknown) =>
      error instanceof NarrationVisualPlannerError &&
      error.code === 'CODEX_NARRATION_PLANNER_INVALID_RESPONSE',
  );
});

class FakeCodexClient implements CodexAppServerClient {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  private listeners = new Set<(notification: CodexAppServerNotification) => void>();
  private turnCount = 0;
  private readonly responseFor: (turnNumber: number) => unknown;

  constructor(responseFor: (turnNumber: number) => unknown) {
    this.responseFor = responseFor;
  }

  async request(method: string, params?: unknown) {
    this.calls.push({method, params});
    if (method === 'thread/start') {
      return {thread: {id: 'thread-1'}, model: 'fake-planner-model'};
    }
    if (method === 'turn/start') {
      this.turnCount += 1;
      const turnNumber = this.turnCount;
      const turnId = `turn-${turnNumber}`;
      const threadId = (params as {threadId: string}).threadId;
      queueMicrotask(() => {
        this.emit({
          method: 'item/completed',
          params: {
            threadId,
            turnId,
            item: {
              id: `message-${turnId}`,
              type: 'agentMessage',
              phase: 'final_answer',
              text: JSON.stringify(this.responseFor(turnNumber)),
            },
          },
        });
        this.emit({
          method: 'turn/completed',
          params: {threadId, turn: {id: turnId, status: 'completed', items: []}},
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

test('AI visual planner thật trả về title/goal/blueprint/bible/handoff hợp lệ', async context => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-narration-planner-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient(() => ({
    scenes: [
      {
        title: 'Ý tưởng cốt lõi',
        goal: 'Giúp người xem hình dung vùng tìm kiếm bị thu hẹp.',
        stateHandoffIncoming: null,
        stateHandoffOutgoing: null,
        units: [validUnitBlueprint('unit-1'), validUnitBlueprint('unit-2')],
      },
    ],
    visualBible: validVisualBible(),
  }));
  const planner = createCodexNarrationVisualPlanner(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });
  const request: NarrationVisualPlannerRequest = {
    topicInput,
    units: [unit('unit-1', 'Ta thu hẹp vùng tìm kiếm.'), unit('unit-2', 'Mốc giữa quyết định nửa nào bị loại.')],
  };

  const result = await planner.plan(request);

  assert.equal(result.model, 'fake-planner-model');
  assert.equal(result.output.scenes[0]?.title, 'Ý tưởng cốt lõi');
  assert.equal(result.output.scenes[0]?.goal, 'Giúp người xem hình dung vùng tìm kiếm bị thu hẹp.');
  assert.equal(result.output.scenes[0]?.units.length, 2);
  assert.ok(result.output.visualBible.visualAnchor.length > 0);
  assert.equal(result.output.scenes[0]?.stateHandoffIncoming, null);
});

test('AI visual planner ném lỗi invariant khi model bỏ sót một unit', async context => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-narration-planner-invariant-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient(() => ({
    scenes: [
      {
        title: 'Ý tưởng cốt lõi',
        goal: 'Giúp người xem hình dung vùng tìm kiếm bị thu hẹp.',
        stateHandoffIncoming: null,
        stateHandoffOutgoing: null,
        units: [validUnitBlueprint('unit-1')],
      },
    ],
    visualBible: validVisualBible(),
  }));
  const planner = createCodexNarrationVisualPlanner(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });

  await assert.rejects(
    planner.plan({
      topicInput,
      units: [unit('unit-1', 'Ta thu hẹp vùng tìm kiếm.'), unit('unit-2', 'Mốc giữa quyết định nửa nào bị loại.')],
    }),
    (error: unknown) =>
      error instanceof NarrationVisualPlannerError &&
      error.code === 'CODEX_NARRATION_PLANNER_INVARIANT_VIOLATION',
  );
});
