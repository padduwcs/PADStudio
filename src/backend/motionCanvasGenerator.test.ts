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
import {
  createCodexMotionCanvasGenerator,
  MotionCanvasGenerationError,
  type MotionCanvasGenerationRequest,
  validateMotionCanvasSceneSource,
  validateMotionCanvasTimingContract,
} from './motionCanvasGenerator.ts';

const sceneSource = `import {makeScene2D, Rect} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(<Rect key="main-visual-card" width={640} height={120} radius={24} fill={'#dbe9e2'} />);
  yield* waitFor(12);
});
`;

function timedSceneSource(beatIds: string[]) {
  return `import {makeScene2D, Rect} from '@motion-canvas/2d';
import {useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(<Rect key="main-visual-card" width={640} height={120} radius={24} fill={'#dbe9e2'} />);
${beatIds
  .map(
    (beatId, index) => `  yield* waitUntil('beat:${beatId}:start');
  const beatDuration${index} = useDuration('beat:${beatId}:end');
  const beatEndTime${index} = useThread().time() + beatDuration${index};
  yield* waitFor(beatDuration${index});
  yield* waitFor(Math.max(0, beatEndTime${index} - useThread().time()));`,
  )
  .join('\n')}
});
`;
}

class FakeCodexClient implements CodexAppServerClient {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  private listeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();
  private threadCount = 0;
  private turnCount = 0;
  private readonly failFirstTurn: boolean;
  private readonly invalidFirstTurn: boolean;
  private readonly models: Array<Record<string, unknown>>;

  constructor(
    failFirstTurn = false,
    models: Array<Record<string, unknown>> = [
      {
        id: 'fast-model',
        model: 'fast-model',
        isDefault: false,
        supportedReasoningEfforts: [
          {reasoningEffort: 'low'},
          {reasoningEffort: 'medium'},
        ],
        defaultReasoningEffort: 'medium',
      },
      {
        id: 'scene-model',
        model: 'scene-model',
        isDefault: true,
        supportedReasoningEfforts: [
          {reasoningEffort: 'low'},
          {reasoningEffort: 'medium'},
          {reasoningEffort: 'high'},
        ],
        defaultReasoningEffort: 'medium',
      },
    ],
    invalidFirstTurn = false,
  ) {
    this.failFirstTurn = failFirstTurn;
    this.models = models;
    this.invalidFirstTurn = invalidFirstTurn;
  }

  async request(method: string, params?: unknown) {
    this.calls.push({method, params});
    if (method === 'model/list') {
      return {data: this.models};
    }
    if (method === 'thread/start') {
      this.threadCount += 1;
      const requestedModel = (params as {model?: string})?.model;
      const defaultModel = this.models.find(
        (model) => model.isDefault === true,
      );
      return {
        thread: {id: `thread-motion-${this.threadCount}`},
        model:
          requestedModel ??
          String(defaultModel?.model ?? defaultModel?.id ?? 'server-default'),
      };
    }
    if (method === 'turn/start') {
      this.turnCount += 1;
      const turnNumber = this.turnCount;
      const turnId = `turn-motion-${turnNumber}`;
      const threadId = (params as {threadId: string}).threadId;
      const beatIds = [
        ...new Set(
          [
            ...JSON.stringify(params).matchAll(
              /beat:([0-9a-f-]{36}):start/g,
            ),
          ].map((match) => match[1]!),
        ),
      ];
      if (!(this.failFirstTurn && turnNumber === 1)) {
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
                text: JSON.stringify({
                  name: `Scene ${turnNumber}`,
                  source:
                    this.invalidFirstTurn && turnNumber === 1
                      ? timedSceneSource(beatIds).replace(
                          'view.add(<Rect',
                          'view.add(<Rect broken={',
                        )
                      : timedSceneSource(beatIds),
                }),
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
      }
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

function createGenerationRequest(): MotionCanvasGenerationRequest {
  const sectionIds = [randomUUID(), randomUUID()];
  const topicInput = {
    topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
    audience: 'beginner' as const,
    duration: 'concise' as const,
  };
  const outline = {
    brief: {
      summary: 'Video giúp người mới hiểu trực giác chia đôi dữ liệu.',
      assumptions: ['Dữ liệu đã được sắp xếp.'],
    },
    centralMessage: 'Mỗi bước loại bỏ một nửa vùng tìm kiếm.',
    sections: sectionIds.map((id, index) => ({
      id,
      title: `Ý chính ${index + 1}`,
      goal: 'Nhìn thấy vùng tìm kiếm được thu hẹp.',
      content: 'Dùng mốc giữa để loại bỏ một nửa vùng còn lại.',
      estimatedSeconds: 20,
    })),
    status: 'approved' as const,
    contentRevision: 1,
    sourceInput: topicInput,
    generation: {
      generationId: randomUUID(),
      provider: 'codex' as const,
      model: 'outline-model',
      promptVersion: 'outline-v1',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  };
  const voiceVisualPlan = {
    voiceDirection: 'Giọng kể rõ ràng, gần gũi với người mới.',
    visualDirection: 'Hình khối tối giản thể hiện vùng tìm kiếm.',
    timingCalibration: {
      source: 'default' as const,
      whitespaceTokensPerMinute: 195,
      charactersPerSecond: 14.5,
      voiceId: null,
      modelId: null,
      voiceName: null,
      sampleCount: 0,
    },
    sections: outline.sections.map((section) => ({
      outlineSectionId: section.id,
      beats: [
        {
          id: randomUUID(),
          voiceover: 'Ta quan sát vùng có thể chứa đáp án.',
          visualDescription: 'Một thanh dài đại diện cho vùng tìm kiếm.',
          animationDescription: 'Thanh xuất hiện rồi thu hẹp một nửa.',
          visualHoldSeconds: 0,
          durationSeconds: 12,
        },
      ],
    })),
    status: 'approved' as const,
    contentRevision: 1,
    narrationRevision: 1,
    sourceOutlineContentRevision: 1,
    generation: {
      generationId: randomUUID(),
      provider: 'codex' as const,
      model: 'plan-model',
      promptVersion: 'voice-visual-v1',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  };

  return {
    generationId: randomUUID(),
    topicInput,
    outline,
    voiceVisualPlan,
  };
}

test('Motion Canvas generator ánh xạ scene theo đúng voice–visual', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-generator-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const firstSectionId = randomUUID();
  const secondSectionId = randomUUID();
  const sourceInput = {
    topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
    audience: 'beginner' as const,
    duration: 'concise' as const,
  };
  const outline = {
    brief: {
      summary: 'Video giúp người mới hiểu trực giác chia đôi dữ liệu.',
      assumptions: ['Dữ liệu đã được sắp xếp.'],
    },
    centralMessage: 'Mỗi bước loại bỏ một nửa vùng tìm kiếm.',
    sections: [
      {
        id: firstSectionId,
        title: 'Đặt vấn đề',
        goal: 'Nhìn thấy vùng ban đầu.',
        content: 'Hiển thị toàn bộ vùng có thể chứa đáp án.',
        estimatedSeconds: 20,
      },
      {
        id: secondSectionId,
        title: 'Chia đôi',
        goal: 'Hiểu cách loại một nửa.',
        content: 'Dùng mốc giữa để thu hẹp vùng tìm kiếm.',
        estimatedSeconds: 24,
      },
    ],
    status: 'approved' as const,
    contentRevision: 1,
    sourceInput,
    generation: {
      generationId: randomUUID(),
      provider: 'codex' as const,
      model: 'outline-model',
      promptVersion: 'outline-v1',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  };
  const voiceVisualPlan = {
    voiceDirection: 'Giọng kể rõ ràng, gần gũi với người mới.',
    visualDirection: 'Hình khối tối giản thể hiện vùng tìm kiếm.',
    timingCalibration: {
      source: 'default' as const,
      whitespaceTokensPerMinute: 195,
      charactersPerSecond: 14.5,
      voiceId: null,
      modelId: null,
      voiceName: null,
      sampleCount: 0,
    },
    sections: outline.sections.map((section) => ({
      outlineSectionId: section.id,
      beats: [
        {
          id: randomUUID(),
          voiceover: 'Ta quan sát toàn bộ vùng có thể chứa đáp án.',
          visualDescription: 'Một thanh dài đại diện cho vùng tìm kiếm.',
          animationDescription: 'Thanh xuất hiện rồi sáng dần từ trái sang phải.',
          visualHoldSeconds: 0,
          durationSeconds: 12,
        },
      ],
    })),
    status: 'approved' as const,
    contentRevision: 1,
    narrationRevision: 1,
    sourceOutlineContentRevision: 1,
    generation: {
      generationId: randomUUID(),
      provider: 'codex' as const,
      model: 'plan-model',
      promptVersion: 'voice-visual-v1',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  };
  const client = new FakeCodexClient();
  const generator = createCodexMotionCanvasGenerator(
    client,
    {runtimeDirectory, timeoutMs: 1_000},
  );

  const result = await generator.generate({
    generationId: randomUUID(),
    topicInput: sourceInput,
    outline,
    voiceVisualPlan,
  });

  assert.equal(result.model, 'scene-model');
  assert.deepEqual(
    result.scenes.map((scene) => scene.outlineSectionId),
    [firstSectionId, secondSectionId],
  );
  assert.deepEqual(
    result.scenes.map((scene) => scene.durationSeconds),
    [12, 12],
  );
  assert.match(result.scenes[0]?.filePath ?? '', /^src\/scenes\/01-/);
  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    2,
  );
  assert.ok(
    client.calls
      .filter((call) => call.method === 'turn/start')
      .every(
        (call) =>
          (call.params as {effort?: string}).effort === 'medium',
      ),
  );
  assert.ok(
    client.calls
      .filter((call) => call.method === 'thread/start')
      .every(
        (call) =>
          (call.params as {model?: string}).model ===
          'scene-model',
      ),
  );
});

test('Motion Canvas generator tự sửa source TSX lỗi trước khi trả generation', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-source-repair-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient(false, undefined, true);
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });

  const result = await generator.generate(createGenerationRequest());

  assert.equal(result.scenes.length, 2);
  assert.ok(result.scenes.every((scene) => scene.source.includes('makeScene2D')));
  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    3,
  );
});

test('Motion Canvas generator có fallback cục bộ sau khi compiler repair vẫn thất bại', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-motion-fallback-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const generator = createCodexMotionCanvasGenerator(
    new FakeCodexClient(),
    {runtimeDirectory},
  );
  const request = createGenerationRequest();
  const generated = await generator.generate(request);
  assert.ok(generator.recover);

  const recovered = generator.recover(
    request,
    generated,
    `${generated.scenes[0]!.filePath}(12,3): error TS9999`,
  );
  assert.match(recovered.model, /local-safe-fallback/);
  assert.match(recovered.scenes[0]!.source, /safe fallback|concept-card/i);
  validateMotionCanvasSceneSource(recovered.scenes[0]!.source);
  validateMotionCanvasTimingContract(
    recovered.scenes[0]!.source,
    request.voiceVisualPlan.sections[0]!.beats,
  );
  assert.equal(recovered.scenes[1]!.source, generated.scenes[1]!.source);
});

test('Motion Canvas generator theo capability của model thay vì tên model', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-model-policy-'),
  );
  context.after(() =>
    rm(runtimeDirectory, {recursive: true, force: true}),
  );
  const client = new FakeCodexClient(false, [
    {
      id: 'future-default-model',
      isDefault: true,
      supportedReasoningEfforts: [
        {reasoningEffort: 'low'},
        {reasoningEffort: 'medium'},
      ],
      defaultReasoningEffort: 'medium',
    },
  ]);
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });

  const result = await generator.generate(createGenerationRequest());

  assert.equal(result.model, 'future-default-model');
  assert.ok(
    client.calls
      .filter((call) => call.method === 'thread/start')
      .every(
        (call) =>
          (call.params as {model?: string}).model ===
          'future-default-model',
      ),
  );
  assert.ok(
    client.calls
      .filter((call) => call.method === 'turn/start')
      .every(
        (call) =>
          (call.params as {effort?: string}).effort === 'medium',
      ),
  );
});

test('Motion Canvas generator từ chối effort ngoài capability model', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-effort-policy-'),
  );
  context.after(() =>
    rm(runtimeDirectory, {recursive: true, force: true}),
  );
  const client = new FakeCodexClient(false, [
    {
      id: 'constrained-model',
      model: 'constrained-model',
      isDefault: true,
      supportedReasoningEfforts: [{reasoningEffort: 'low'}],
      defaultReasoningEffort: 'low',
    },
  ]);
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    reasoningEffort: 'high',
  });

  await assert.rejects(
    generator.generate(createGenerationRequest()),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_REASONING_UNSUPPORTED',
  );
  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    0,
  );
});

test('Motion Canvas generator chặn source có quyền ngoài phạm vi', () => {
  assert.throws(
    () =>
      validateMotionCanvasSceneSource(`${sceneSource}\nfetch('/secret');`),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_UNSAFE_SOURCE',
  );
  assert.throws(
    () =>
      validateMotionCanvasSceneSource(
        sceneSource.replace(
          "import {waitFor} from '@motion-canvas/core';",
          "import {readFile} from 'node:fs';",
        ),
      ),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_UNSAFE_SOURCE',
  );
  assert.throws(
    () =>
      validateMotionCanvasSceneSource(
        `${sceneSource}\nconst loadLater = () => import('./other-scene');`,
      ),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_UNSAFE_SOURCE',
  );
});

test('Motion Canvas source policy phân tích code thay vì nội dung text', () => {
  assert.doesNotThrow(() =>
    validateMotionCanvasSceneSource(
      sceneSource.replace(
        'export default',
        "// Từ “fetch” trong chú thích không phải lời gọi mạng.\nexport default",
      ),
    ),
  );
  assert.doesNotThrow(() =>
    validateMotionCanvasSceneSource(
      sceneSource.replace(
        'export default',
        'const window = 16;\nvoid window;\nexport default',
      ),
    ),
  );
  assert.throws(
    () =>
      validateMotionCanvasSceneSource(
        `${sceneSource}\nvoid window.location;`,
      ),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_UNSAFE_SOURCE',
  );
});

test('Motion Canvas source policy yêu cầu semantic key tường minh cho mọi visual node', () => {
  assert.throws(
    () =>
      validateMotionCanvasSceneSource(
        sceneSource.replace(
          ' key="main-visual-card"',
          '',
        ),
      ),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
  assert.throws(
    () =>
      validateMotionCanvasSceneSource(
        sceneSource.replace(
          'key="main-visual-card"',
          "key={'visual-card-' + String(0)}",
        ),
      ),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
  assert.throws(
    () =>
      validateMotionCanvasSceneSource(
        sceneSource.replace(
          'key="main-visual-card"',
          'key="visual-card-1"',
        ),
      ),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
  assert.doesNotThrow(() => validateMotionCanvasSceneSource(sceneSource));
});

test('Motion Canvas source policy yêu cầu layout key duy nhất trong scene', () => {
  assert.throws(
    () =>
      validateMotionCanvasSceneSource(
        sceneSource.replace(
          '  yield* waitFor(12);',
          `  view.add(
    <Rect key="main-visual-card" width={320} height={80} />,
  );
  yield* waitFor(12);`,
        ),
      ),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
});

test('Motion Canvas source policy chặn node sinh qua callback, loop hoặc constructor', () => {
  const visualLine =
    '  view.add(<Rect key="main-visual-card" width={640} height={120} radius={24} fill={\'#dbe9e2\'} />);';
  const invalidSources = [
    sceneSource.replace(
      visualLine,
      '  [1, 2].map(() => <Rect key="mapped-visual-card" width={640} height={120} />);',
    ),
    sceneSource.replace(
      visualLine,
      `  for (let index = 0; index < 2; index += 1) {
    view.add(<Rect key="looped-visual-card" width={640} height={120} />);
  }`,
    ),
    sceneSource.replace(
      visualLine,
      '  view.add(new Rect({width: 640, height: 120}));',
    ),
  ];

  for (const source of invalidSources) {
    assert.throws(
      () => validateMotionCanvasSceneSource(source),
      (error) =>
        error instanceof MotionCanvasGenerationError &&
        error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
    );
  }
});

test('Motion Canvas source policy kiểm tra key của node lồng và node có ref', () => {
  const nestedSource = sceneSource
    .replace(
      "import {makeScene2D, Rect} from '@motion-canvas/2d';",
      "import {makeScene2D, Rect, Txt} from '@motion-canvas/2d';",
    )
    .replace(
      '<Rect key="main-visual-card" width={640} height={120} radius={24} fill={\'#dbe9e2\'} />',
      `<Rect key="main-visual-card" width={640} height={120}>
      <Txt text="Demo" />
    </Rect>`,
    );
  assert.throws(
    () => validateMotionCanvasSceneSource(nestedSource),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
  assert.doesNotThrow(() =>
    validateMotionCanvasSceneSource(
      nestedSource.replace(
        '<Txt text="Demo" />',
        '<Txt key="card-title-label" ref={() => undefined} text="Demo" />',
      ),
    ),
  );
});

test('Motion Canvas timing contract chỉ đăng ký start/end một lần', () => {
  const beatId = randomUUID();
  const validSource = timedSceneSource([beatId]);
  assert.doesNotThrow(() =>
    validateMotionCanvasTimingContract(validSource, [{id: beatId}]),
  );
  assert.throws(
    () =>
      validateMotionCanvasTimingContract(
        validSource.replace(`beat:${beatId}:end`, `beat:${beatId}:start`),
        [{id: beatId}],
      ),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_TIMING_CONTRACT',
  );
  assert.throws(
    () =>
      validateMotionCanvasTimingContract(
        validSource.replace(
          '});',
          `  yield* waitUntil('beat:${beatId}:end');\n});`,
        ),
        [{id: beatId}],
      ),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_TIMING_CONTRACT',
  );
});

test('Motion Canvas generator chỉ sinh lại scene đã timeout', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-retry-'),
  );
  context.after(() =>
    rm(runtimeDirectory, {recursive: true, force: true}),
  );
  const client = new FakeCodexClient(true);
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 20,
    concurrency: 2,
  });
  const request = createGenerationRequest();

  await assert.rejects(
    () => generator.generate(request),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_TIMEOUT',
  );
  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    2,
  );

  const result = await generator.generate(request);
  assert.equal(result.scenes.length, 2);
  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    3,
  );
});

test('Motion Canvas generator chỉ sửa scene có compiler diagnostics', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-repair-'),
  );
  context.after(() =>
    rm(runtimeDirectory, {recursive: true, force: true}),
  );
  const client = new FakeCodexClient();
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    concurrency: 2,
  });
  const request = createGenerationRequest();
  const generated = await generator.generate(request);
  const firstScene = generated.scenes[0]!;
  const repaired = await generator.repair!(
    request,
    {
      ...generated,
      scenes: [
        {...firstScene, source: `${firstScene.source}\nscaleX(0);`},
        generated.scenes[1]!,
      ],
    },
    `${firstScene.filePath}(10,2): error TS2551: Property 'scaleX' does not exist.`,
  );

  assert.equal(repaired.scenes.length, 2);
  assert.equal(repaired.scenes[0]?.source, firstScene.source);
  assert.equal(repaired.scenes[1]?.id, generated.scenes[1]?.id);
  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    3,
  );
});
