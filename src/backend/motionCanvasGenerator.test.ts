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
  assessMotionCanvasSceneQuality,
  applyMotionCanvasDefaultFont,
  createCodexMotionCanvasGenerator,
  MOTION_CANVAS_DEFAULT_FONT_FAMILY,
  MotionCanvasGenerationError,
  type MotionCanvasGenerationRequest,
  validateMotionCanvasBackground,
  validateMotionCanvasContainerContract,
  validateMotionCanvasSceneSource,
  validateMotionCanvasTimingContract,
} from './motionCanvasGenerator.ts';
import {
  findUnsupportedMotionCanvasColorLiterals,
  normalizeMotionCanvasColorFormats,
} from './motionCanvasSourceCompatibility.ts';

const sceneSource = `import {makeScene2D, Rect} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(
    <Rect key="scene-background" width={1080} height={1920} fill={'#10231D'}>
      <Rect key="main-visual-card" width={640} height={120} radius={24} fill={'#dbe9e2'} />
    </Rect>,
  );
  yield* waitFor(12);
});
`;

test('Motion Canvas chuẩn hóa transparent theo ngữ cảnh màu mà không đổi text', () => {
  const sourceWithTransparentColors = `const clear = 'transparent';
const clearSignal = createSignal('transparent');
const textLabel = 'transparent';
const demo = (
  <>
    <Rect fill={'transparent'} stroke="TRANSPARENT" shadowColor={\`transparent\`} />
    <Rect fill={clearSignal} />
    <Txt text={'transparent'} />
    <Txt text={textLabel} />
  </>
);
card().fill('transparent', 0.2);
line().stroke(clear, 0.2);
const gradientStop = {color: 'transparent'};
const color = new Color('transparent');
`;

  assert.equal(
    findUnsupportedMotionCanvasColorLiterals(
      sourceWithTransparentColors,
    ).length,
    8,
  );
  const normalized = normalizeMotionCanvasColorFormats(
    sourceWithTransparentColors,
  );
  assert.equal(
    findUnsupportedMotionCanvasColorLiterals(normalized).length,
    0,
  );
  assert.match(normalized, /<Txt text=\{'transparent'\}/);
  assert.match(normalized, /const textLabel = 'transparent'/);
  assert.equal(
    normalizeMotionCanvasColorFormats(normalized),
    normalized,
  );
  assert.equal(
    normalized.match(/#00000000/g)?.length,
    8,
  );
});

test('Motion Canvas source policy từ chối transparent chưa được chuẩn hóa', () => {
  const invalidSource = sceneSource.replace(
    "'#dbe9e2'",
    "'transparent'",
  );

  assert.throws(
    () => validateMotionCanvasSceneSource(invalidSource),
    (error) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
  assert.doesNotThrow(() =>
    validateMotionCanvasSceneSource(
      normalizeMotionCanvasColorFormats(invalidSource),
    ),
  );
});

test('Motion Canvas color compatibility tôn trọng lexical scope của alias', () => {
  const source = `const label = 'transparent';
function createCard() {
  const label = '#ffffff';
  return <Rect fill={label} />;
}
const caption = <Txt text={label} />;
`;

  assert.equal(
    findUnsupportedMotionCanvasColorLiterals(source).length,
    0,
  );
  assert.equal(normalizeMotionCanvasColorFormats(source), source);
});

function timedSceneSource(beatIds: string[]) {
  return `import {Layout, makeScene2D, Rect} from '@motion-canvas/2d';
import {useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(
    <Rect key="scene-background" width={1080} height={1920} fill={'#10231D'}>
      <Layout key="scene-content-root">
        <Layout key="block-main-visual">
          <Rect key="main-visual-card" width={640} height={120} radius={24} fill={'#dbe9e2'} />
        </Layout>
      </Layout>
    </Rect>,
  );
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

function richTimedSceneSource(beatIds: string[]) {
  return `import {Circle, Layout, Line, makeScene2D, Rect} from '@motion-canvas/2d';
import {all, createRef, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const card = createRef<Rect>();
  const marker = createRef<Circle>();
  const range = createRef<Line>();
  view.add(
    <Rect key="scene-background" width={1080} height={1920} fill={'#10231D'}>
      <Layout key="scene-content-root">
        <Layout key="block-search-visual">
          <Rect key="main-visual-card" ref={card} width={640} height={420} radius={32} fill={'#dbe9e2'} />
          <Circle key="pivot-marker" ref={marker} size={80} fill={'#51B68E'} />
          <Line key="search-range" ref={range} points={[[-240, 0], [240, 0]]} lineWidth={12} stroke={'#FFFFFF'} />
        </Layout>
      </Layout>
    </Rect>,
  );
${beatIds
  .map(
    (beatId, index) => `  yield* waitUntil('beat:${beatId}:start');
  const beatDuration${index} = useDuration('beat:${beatId}:end');
  const beatEndTime${index} = useThread().time() + beatDuration${index};
  yield* all(
    card().scale(1.05, beatDuration${index} * 0.15),
    marker().opacity(0.7, beatDuration${index} * 0.15),
    range().end(0.8, beatDuration${index} * 0.15),
  );
  yield* waitFor(Math.max(0, beatEndTime${index} - useThread().time()));`,
  )
  .join('\n')}
});
`;
}

test('Motion Canvas bắt buộc scene dùng đúng background người dùng chọn', () => {
  assert.doesNotThrow(() =>
    validateMotionCanvasBackground(sceneSource, '#10231D'),
  );
  assert.throws(
    () => validateMotionCanvasBackground(sceneSource, '#F5F7F4'),
    (error: unknown) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
});

test('Motion Canvas generation contract bắt buộc content root và block container', () => {
  const beatId = randomUUID();
  assert.doesNotThrow(() =>
    validateMotionCanvasContainerContract(timedSceneSource([beatId])),
  );
  assert.throws(
    () => validateMotionCanvasContainerContract(sceneSource),
    (error: unknown) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
  const rogueNodeSource = timedSceneSource([beatId]).replace(
    '      </Layout>\n    </Rect>',
    '      </Layout>\n      <Rect key="rogue-decoration" width={20} height={20} />\n    </Rect>',
  );
  assert.throws(
    () => validateMotionCanvasContainerContract(rogueNodeSource),
    (error: unknown) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
});

test('Motion Canvas thêm Times New Roman cho Txt chưa có font và giữ font chủ động', () => {
  const source = `import {makeScene2D, Rect, Txt} from '@motion-canvas/2d';

export default makeScene2D(function* (view) {
  view.add(
    <Rect key="scene-background" width={1080} height={1920} fill={'#10231D'}>
      <Txt key="default-label" text={'Mặc định'} />
      <Txt key="custom-label" text={'Chủ động'} fontFamily={'Georgia, serif'} />
    </Rect>,
  );
});
`;

  const normalized = applyMotionCanvasDefaultFont(source);

  assert.match(
    normalized,
    new RegExp(
      `key="default-label"[^>]*fontFamily=\\{"${MOTION_CANVAS_DEFAULT_FONT_FAMILY}"\\}`,
    ),
  );
  assert.match(
    normalized,
    /key="custom-label"[^>]*fontFamily=\{'Georgia, serif'\}/u,
  );
  assert.equal(applyMotionCanvasDefaultFont(normalized), normalized);
  assert.doesNotThrow(() => validateMotionCanvasSceneSource(normalized));
});

test('Motion Canvas rejects Line.points tweens with a different point count because they can lock the renderer', () => {
  const source = `import {Line, makeScene2D, Rect} from '@motion-canvas/2d';
import {createRef, waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const chart = createRef<Line>();
  view.add(
    <Rect key="scene-background" width={1080} height={1920} fill={'#10231D'}>
      <Line
        ref={chart}
        key="complexity-growth-line"
        points={[[-330, 110], [-190, 65], [-40, 20], [120, -25], [300, -80]]}
        stroke={'#4FD1A5'}
        lineWidth={10}
      />
    </Rect>,
  );
  yield* chart().points(
    [[-330, 112], [-205, 102], [-80, 72], [45, 18], [165, -58], [300, -128]],
    0.8,
  );
  yield* waitFor(1);
});
`;

  assert.throws(
    () => validateMotionCanvasSceneSource(source),
    (error: unknown) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE' &&
      /Line\.points/u.test(error.message),
  );
  assert.doesNotThrow(() =>
    validateMotionCanvasSceneSource(
      source.replace(
        '[[-330, 112], [-205, 102], [-80, 72], [45, 18], [165, -58], [300, -128]]',
        '[[-330, 112], [-180, 72], [-20, 20], [130, -40], [300, -128]]',
      ),
    ),
  );
});

test('Motion Canvas quality gate đo richness theo beat thay vì độ dài thuần', () => {
  const beatId = randomUUID();
  const simple = timedSceneSource([beatId]);
  const richer = simple
    .replace(
      "import {makeScene2D, Rect} from '@motion-canvas/2d';",
      "import {makeScene2D, Circle, Line, Rect} from '@motion-canvas/2d';",
    )
    .replace(
      '<Rect key="main-visual-card" width={640} height={120} radius={24} fill={\'#dbe9e2\'} />',
      `<Rect key="main-visual-card" width={640} height={120} radius={24} fill={'#dbe9e2'} />
      <Circle key="pivot-marker" size={80} fill={'#51B68E'} />
      <Line key="search-range" points={[[-240, 0], [240, 0]]} lineWidth={12} stroke={'#FFFFFF'} />`,
    )
    .replace(
      '  yield* waitFor(beatDuration0);',
      `  yield* view.opacity(0.9, beatDuration0 * 0.2);
  yield* view.rotation(2, beatDuration0 * 0.2);
  yield* waitFor(beatDuration0);`,
    );

  const simpleQuality = assessMotionCanvasSceneQuality(simple, 1);
  const richQuality = assessMotionCanvasSceneQuality(richer, 1);
  assert.ok(richQuality.score > simpleQuality.score);
  assert.ok(
    richQuality.richnessPerBeat > simpleQuality.richnessPerBeat,
  );
  assert.equal(richQuality.visualTypeCount >= 3, true);
});

test('Motion Canvas tự sinh lại scene tụt richness và chỉ nhận bản thực sự tốt hơn', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-quality-gate-'),
  );
  context.after(() =>
    rm(runtimeDirectory, {recursive: true, force: true}),
  );
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    (turnNumber, beatIds) =>
      turnNumber === 2
        ? timedSceneSource(beatIds)
        : richTimedSceneSource(beatIds),
  );
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    concurrency: 1,
  });
  const request = createGenerationRequest();
  const generated = await generator.generate(request);

  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    3,
  );
  assert.ok(
    assessMotionCanvasSceneQuality(generated.scenes[1]!.source, 1)
      .richnessPerBeat >
      assessMotionCanvasSceneQuality(timedSceneSource([
        request.voiceVisualPlan.sections[1]!.beats[0]!.id,
      ]), 1).richnessPerBeat,
  );
});

class FakeCodexClient implements CodexAppServerClient {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  private listeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();
  private threadCount = 0;
  private turnCount = 0;
  private readonly failFirstTurn: boolean;
  private readonly invalidTurnCount: number;
  private readonly models: Array<Record<string, unknown>>;
  private readonly sourceFactory?: (
    turnNumber: number,
    beatIds: string[],
  ) => string;

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
    invalidFirstTurn: boolean | number = false,
    sourceFactory?: (turnNumber: number, beatIds: string[]) => string,
  ) {
    this.failFirstTurn = failFirstTurn;
    this.models = models;
    this.invalidTurnCount =
      typeof invalidFirstTurn === 'number'
        ? invalidFirstTurn
        : invalidFirstTurn
          ? 1
          : 0;
    this.sourceFactory = sourceFactory;
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
                    turnNumber <= this.invalidTurnCount
                      ? timedSceneSource(beatIds).replace(
                          'width={1080}',
                          'width={',
                        )
                      : this.sourceFactory?.(turnNumber, beatIds) ??
                        timedSceneSource(beatIds),
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
    background: {mode: 'dark' as const, color: '#10231D'},
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

function createSingleSceneGenerationRequest() {
  const request = createGenerationRequest();
  return {
    ...request,
    outline: {
      ...request.outline,
      sections: request.outline.sections.slice(0, 1),
    },
    voiceVisualPlan: {
      ...request.voiceVisualPlan,
      sections: request.voiceVisualPlan.sections.slice(0, 1),
    },
  } satisfies MotionCanvasGenerationRequest;
}

test('Motion Canvas generator chỉ sinh section được chọn và giữ scene identity', async context => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-scoped-generator-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const request = createGenerationRequest();
  const currentScenes = request.outline.sections.map((section, index) => {
    const beat = request.voiceVisualPlan.sections[index]!.beats[0]!;
    return {
      id: randomUUID(),
      outlineSectionId: section.id,
      name: `Scene cũ ${index + 1}`,
      filePath: `src/scenes/0${index + 1}-scene-cu-${index + 1}.tsx`,
      durationSeconds: beat.durationSeconds,
      timingEvents: [
        {
          beatId: beat.id,
          startEvent: `beat:${beat.id}:start`,
          endEvent: `beat:${beat.id}:end`,
          plannedDurationSeconds: beat.durationSeconds,
        },
      ],
      source: timedSceneSource([beat.id]),
    };
  });
  const client = new FakeCodexClient();
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
  });
  const result = await generator.generate({
    ...request,
    guidance: 'Chỉ làm scene thứ hai trực quan hơn.',
    sectionIndexes: [1],
    currentScenes,
  });
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0]?.outlineSectionId, request.outline.sections[1]?.id);
  assert.equal(result.scenes[0]?.id, currentScenes[1]?.id);
  assert.equal(result.scenes[0]?.filePath, currentScenes[1]?.filePath);
  assert.equal(
    client.calls.filter(call => call.method === 'turn/start').length,
    1,
  );
});

test('Motion Canvas generator ánh xạ scene theo đúng voice–visual', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-generator-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const firstSectionId = randomUUID();
  const secondSectionId = randomUUID();
  const sourceInput = {
    topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
    background: {mode: 'dark' as const, color: '#10231D'},
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

test('Motion Canvas generator sinh mới từ đầu khi lượt sửa TSX vẫn lỗi', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-clean-regeneration-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient(false, undefined, 2);
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });

  const result = await generator.generate(
    createSingleSceneGenerationRequest(),
  );

  assert.equal(result.scenes.length, 1);
  validateMotionCanvasSceneSource(result.scenes[0]!.source);
  assert.doesNotMatch(result.model, /local-safe-fallback/);
  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    3,
  );
});

test('Motion Canvas generator hoàn tất bằng fallback an toàn khi cả lượt sinh mới vẫn sai TSX', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-invalid-output-fallback-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient(false, undefined, 3);
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });
  const request = createSingleSceneGenerationRequest();

  const result = await generator.generate(request);

  assert.match(result.model, /local-safe-fallback/);
  assert.match(
    result.scenes[0]!.source,
    /fontFamily=\{"Times New Roman, Times, serif"\}/u,
  );
  validateMotionCanvasSceneSource(result.scenes[0]!.source);
  validateMotionCanvasTimingContract(
    result.scenes[0]!.source,
    request.voiceVisualPlan.sections[0]!.beats,
  );
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
  const timingLine = '  yield* waitFor(12);';
  const invalidSources = [
    sceneSource.replace(
      timingLine,
      `  [1, 2].map(() => <Rect key="mapped-visual-card" width={640} height={120} />);
${timingLine}`,
    ),
    sceneSource.replace(
      timingLine,
      `  for (let index = 0; index < 2; index += 1) {
    view.add(<Rect key="looped-visual-card" width={640} height={120} />);
  }
${timingLine}`,
    ),
    sceneSource.replace(
      timingLine,
      `  view.add(new Rect({width: 640, height: 120}));
${timingLine}`,
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
