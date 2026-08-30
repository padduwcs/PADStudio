import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
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
  DEFAULT_MOTION_CANVAS_GENERATION_CONCURRENCY,
  MAXIMUM_MOTION_CANVAS_GENERATION_CONCURRENCY,
  MOTION_CANVAS_FAILURE_ATTEMPT_SOURCE_MAX_CHARS,
  MOTION_CANVAS_DEFAULT_FONT_FAMILY,
  MotionCanvasGenerationError,
  redactMotionCanvasFailureText,
  type MotionCanvasGenerationRequest,
  validateMotionCanvasBackground,
  validateMotionCanvasBeatLifecycle,
  validateMotionCanvasContainerContract,
  validateMotionCanvasIconReferences,
  validateMotionCanvasResponsiveLayout,
  validateMotionCanvasSceneSource,
  validateMotionCanvasTimingContract,
  validateMotionCanvasVisualIntentBindings,
} from './motionCanvasGenerator.ts';
import type {MotionCanvasVisualEvidence} from './motionCanvasVisualQuality.ts';
import {MOTION_CANVAS_ICON_ATLAS_IMPORT_SPECIFIER} from './motionCanvasIconLibrary.ts';
import {assertMotionCanvasScenesArePublishable} from './motionCanvasRoutes.ts';
import {
  findUnsupportedMotionCanvasColorLiterals,
  normalizeMotionCanvasColorFormats,
} from './motionCanvasSourceCompatibility.ts';
import {createMotionCanvasWorkspace} from './motionCanvasWorkspace.ts';

test('failure text redacts data URLs and long base64 payloads', () => {
  const dataUrl = `data:image/png;base64,${'A'.repeat(128)}`;
  const rawBase64 = 'B'.repeat(128);
  const redacted = redactMotionCanvasFailureText(
    `provider=${dataUrl} raw=${rawBase64}`,
  );

  assert.doesNotMatch(redacted, /data:image\/png;base64/i);
  assert.doesNotMatch(redacted, /A{128}/);
  assert.doesNotMatch(redacted, /B{128}/);
  assert.match(redacted, /REDACTED_DATA_URL/);
  assert.match(redacted, /REDACTED_BASE64/);
});

const sceneSource = `import {makeScene2D, Rect} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const canvasWidth = view.width();
  const canvasHeight = view.height();
  const safeMarginX = canvasWidth * 0.08;
  const safeMarginY = canvasHeight * 0.07;
  view.add(
    <Rect key="scene-background" width={canvasWidth} height={canvasHeight} fill={'#10231D'}>
      <Rect key="main-visual-card" width={640} height={120} radius={24} fill={'#dbe9e2'} />
    </Rect>,
  );
  yield* waitFor(12);
});
`;

const directTsxSafeMarginScaffold = [
  '  const canvasWidth = view.width();',
  '  const canvasHeight = view.height();',
  '  const safeMarginX = canvasWidth * 0.08;',
  '  const safeMarginY = canvasHeight * 0.07;',
  '  const safeWidth = canvasWidth - safeMarginX * 2;',
  '  const safeHeight = canvasHeight - safeMarginY * 2;',
].join('\n');

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
import {createRef, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const canvasWidth = view.width();
  const canvasHeight = view.height();
  const safeMarginX = canvasWidth * 0.08;
  const safeMarginY = canvasHeight * 0.07;
  const conceptBlock = createRef<Layout>();
  view.add(
    <Rect key="scene-background" width={canvasWidth} height={canvasHeight} fill={'#10231D'}>
      <Layout key="scene-content-root">
        <Layout key="block-concept-card" ref={conceptBlock}>
          <Rect key="main-visual-card" width={640} height={120} radius={24} fill={'#dbe9e2'} />
        </Layout>
      </Layout>
    </Rect>,
  );
${beatIds
  .map(
    (beatId, index) => `  // lifecycle:beat:${beatId}:enter=block-concept-card|stay=block-concept-card|exit=block-concept-card|primary=block-concept-card
  yield* waitUntil('beat:${beatId}:start');
  const beatDuration${index} = useDuration('beat:${beatId}:end');
  const beatEndTime${index} = useThread().time() + beatDuration${index};
  yield* conceptBlock().opacity(1, beatDuration${index} * 0.1);
  yield* conceptBlock().opacity(0, beatDuration${index} * 0.1);
  yield* waitFor(Math.max(0, beatEndTime${index} - useThread().time()));`,
  )
  .join('\n')}
});
`;
}

function coupledRangeSceneSource(
  initialWidth: string,
  targetWidth: string,
  targetX: string,
) {
  return `import {Rect, makeScene2D} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const canvasWidth = view.width();
  const canvasHeight = view.height();
  const safeMarginX = canvasWidth * 0.08;
  const safeMarginY = canvasHeight * 0.07;
  const safeWidth = canvasWidth - safeMarginX * 2;
  const safeHeight = canvasHeight - safeMarginY * 2;
  const reducedRange = createRef<Rect>();
  view.add(
    <Rect key="scene-background" width={canvasWidth} height={canvasHeight} fill={'#10231D'}>
      <Rect key="reduced-search-range" ref={reducedRange} x={0} y={-70} width={${initialWidth}} height={82} />
    </Rect>,
  );
  yield* all(
    reducedRange().width(${targetWidth}, 0.32, easeInOutCubic),
    reducedRange().x(${targetX}, 0.32, easeInOutCubic),
  );
});
`;
}

function artifactLayoutFailureSource(beatIds: string[], targetX: string) {
  return timedSceneSource(beatIds)
    .replace(
      'import {createRef, useDuration, useThread, waitFor, waitUntil} from \'@motion-canvas/core\';',
      'import {all, createRef, easeInOutCubic, useDuration, useThread, waitFor, waitUntil} from \'@motion-canvas/core\';',
    )
    .replace(
      '  const conceptBlock = createRef<Layout>();',
      '  const conceptBlock = createRef<Layout>();\n  const reducedRange = createRef<Rect>();',
    )
    .replace(
      '          <Rect key="main-visual-card" width={640} height={120} radius={24} fill={\'#dbe9e2\'} />',
      '          <Rect key="main-visual-card" width={240} height={120} radius={24} fill={\'#dbe9e2\'} />\n          <Rect key="reduced-search-range" ref={reducedRange} x={0} y={-70} width={406} height={82} />',
    )
    .replace(
      '  yield* conceptBlock().opacity(1, beatDuration0 * 0.1);',
      `  yield* all(
    reducedRange().width(174, beatDuration0 * 0.32, easeInOutCubic),
    reducedRange().x(${targetX}, beatDuration0 * 0.32, easeInOutCubic),
  );
  yield* conceptBlock().opacity(1, beatDuration0 * 0.1);`,
    );
}

function richTimedSceneSource(beatIds: string[]) {
  return `import {Circle, Layout, Line, makeScene2D, Rect} from '@motion-canvas/2d';
import {all, createRef, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const canvasWidth = view.width();
  const canvasHeight = view.height();
  const safeMarginX = canvasWidth * 0.08;
  const safeMarginY = canvasHeight * 0.07;
  const block = createRef<Layout>();
  const card = createRef<Rect>();
  const marker = createRef<Circle>();
  const range = createRef<Line>();
  view.add(
    <Rect key="scene-background" width={canvasWidth} height={canvasHeight} fill={'#10231D'}>
      <Layout key="scene-content-root">
        <Layout key="block-concept-card" ref={block}>
          <Rect key="main-visual-card" ref={card} width={640} height={420} radius={32} fill={'#dbe9e2'} />
          <Circle key="pivot-marker" ref={marker} size={80} fill={'#51B68E'} />
          <Line key="search-range" ref={range} points={[[-240, 0], [240, 0]]} lineWidth={12} stroke={'#FFFFFF'} />
        </Layout>
      </Layout>
    </Rect>,
  );
${beatIds
  .map(
    (beatId, index) => `  // lifecycle:beat:${beatId}:enter=block-concept-card|stay=block-concept-card|exit=block-concept-card|primary=block-concept-card
  yield* waitUntil('beat:${beatId}:start');
  const beatDuration${index} = useDuration('beat:${beatId}:end');
  const beatEndTime${index} = useThread().time() + beatDuration${index};
  yield* all(
    block().opacity(1, beatDuration${index} * 0.15),
    card().opacity(1, beatDuration${index} * 0.15),
    card().scale(1.05, beatDuration${index} * 0.15),
    marker().opacity(0.7, beatDuration${index} * 0.15),
    range().end(0.8, beatDuration${index} * 0.15),
  );
  yield* all(block().opacity(0, beatDuration${index} * 0.15), card().opacity(0, beatDuration${index} * 0.15));
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

test('Motion Canvas static lifecycle and responsive validators reject stale visuals, hard-coded canvas, and unsafe blocks', () => {
  const beatId = randomUUID();
  const source = timedSceneSource([beatId]);
  const beats = [{
    id: beatId,
    primaryBlock: 'block-concept-card',
    visualLifecycle: {enter: ['block-concept-card'], stay: ['block-concept-card'], exit: ['block-concept-card']},
  }];
  assert.doesNotThrow(() => validateMotionCanvasBeatLifecycle(source, beats));
  const scopedBeatSource = source
    .replace(
      `  // lifecycle:beat:${beatId}:enter=block-concept-card|stay=block-concept-card|exit=block-concept-card|primary=block-concept-card`,
      `  {\n  // lifecycle:beat:${beatId}:enter=block-concept-card|stay=block-concept-card|exit=block-concept-card|primary=block-concept-card`,
    )
    .replace(
      '  yield* waitFor(Math.max(0, beatEndTime0 - useThread().time()));\n});',
      '  yield* waitFor(Math.max(0, beatEndTime0 - useThread().time()));\n  }\n});',
    );
  assert.doesNotThrow(() => validateMotionCanvasBeatLifecycle(scopedBeatSource, beats));
  assert.throws(() => validateMotionCanvasBeatLifecycle(source.replace('lifecycle:beat:', 'removed:beat:'), beats), MotionCanvasGenerationError);
  const frame = {aspectRatio: 'portrait' as const, width: 1080, height: 1920, fps: 30 as const};
  assert.doesNotThrow(() => validateMotionCanvasResponsiveLayout(source, frame));
  assert.throws(() => validateMotionCanvasResponsiveLayout(source.replace('width={canvasWidth} height={canvasHeight}', 'width={1080} height={1920}'), frame), MotionCanvasGenerationError);
  assert.throws(() => validateMotionCanvasResponsiveLayout(source.replace("width={640} height={120}", "x={10000} width={640} height={120}"), frame), MotionCanvasGenerationError);
});

test('Motion Canvas lifecycle validator requires ref-bound animations and a full exit per visual', () => {
  const beatId = randomUUID();
  const source = timedSceneSource([beatId]);
  const beats = [{id: beatId, primaryBlock: 'block-concept-card', visualLifecycle: {enter: ['block-concept-card'], stay: ['block-concept-card'], exit: ['block-concept-card']}}];
  assert.throws(() => validateMotionCanvasBeatLifecycle(source.replace('ref={conceptBlock}', ''), beats), MotionCanvasGenerationError);
  assert.throws(() => validateMotionCanvasBeatLifecycle(source.replaceAll('conceptBlock()', 'view'), beats), MotionCanvasGenerationError);
  assert.throws(() => validateMotionCanvasBeatLifecycle(source.replace('conceptBlock().opacity(0, beatDuration0 * 0.1)', 'conceptBlock().opacity(0.16, beatDuration0 * 0.1)'), beats), MotionCanvasGenerationError);
});

test('Motion Canvas lifecycle parser accepts every static literal key form used by the source validator', () => {
  const beatId = randomUUID();
  const source = timedSceneSource([beatId])
    .replace('key="scene-background"', "key={'scene-background'}")
    .replace('key="scene-content-root"', "key={'scene-content-root'}")
    .replace('key="block-concept-card"', "key={'block-concept-card'}");
  const beats = [{
    id: beatId,
    primaryBlock: 'block-concept-card',
    visualLifecycle: {
      enter: ['block-concept-card'],
      stay: ['block-concept-card'],
      exit: ['block-concept-card'],
    },
  }];

  assert.doesNotThrow(() => validateMotionCanvasSceneSource(source));
  assert.doesNotThrow(() => validateMotionCanvasBackground(source, '#10231D'));
  assert.doesNotThrow(() => validateMotionCanvasContainerContract(source));
  assert.doesNotThrow(() => validateMotionCanvasBeatLifecycle(source, beats));
  assert.doesNotThrow(() => validateMotionCanvasResponsiveLayout(
    source,
    {aspectRatio: 'portrait', width: 1080, height: 1920, fps: 30},
    beats,
  ));
});

test('Motion Canvas responsive validator checks position bounding boxes and only permits verified exit targets outside', () => {
  const beatId = randomUUID();
  const source = timedSceneSource([beatId]);
  const frame = {aspectRatio: 'portrait' as const, width: 1080, height: 1920, fps: 30 as const};
  assert.throws(() => validateMotionCanvasResponsiveLayout(source.replace('ref={conceptBlock}>', 'ref={conceptBlock} position={[canvasWidth * 0.5, 0]} width={canvasWidth * 0.8}>'), frame), MotionCanvasGenerationError);
});

test('Motion Canvas responsive validator evaluates coupled position and size targets at the same animation endpoint', () => {
  const frame = {aspectRatio: 'portrait' as const, width: 540, height: 960, fps: 30 as const};
  const beatId = randomUUID();
  const beats = [{
    id: beatId,
    visualLifecycle: {
      enter: ['reduced-search-range'],
      stay: ['reduced-search-range'],
      exit: [],
    },
  }];

  for (const source of [
    coupledRangeSceneSource('406', '174', '-116'),
    coupledRangeSceneSource('safeWidth * 0.88', 'safeWidth * 0.38', '-safeWidth * 0.255'),
  ]) {
    assert.doesNotThrow(() => validateMotionCanvasResponsiveLayout(source, frame, beats));
  }

  assert.throws(
    () => validateMotionCanvasResponsiveLayout(
      coupledRangeSceneSource('406', '174', '-400'),
      frame,
      beats,
    ),
    (error: unknown) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_LAYOUT' &&
      /semanticKey=reduced-search-range/u.test(error.message) &&
      new RegExp(`beat=${beatId}`, 'u').test(error.message) &&
      /safeArea=\(x=-226\.80\.\.226\.80/u.test(error.message),
  );
});

test('Motion Canvas lifecycle permits four sequential primary blocks but rejects three active blocks in one beat', () => {
  const beatIds = Array.from({length: 4}, () => randomUUID());
  const keys = ['block-one', 'block-two', 'block-three', 'block-four'];
  const refs = ['one', 'two', 'three', 'four'];
  const source = `import {Layout, makeScene2D, Rect} from '@motion-canvas/2d';
import {createRef, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';
export default makeScene2D(function* (view) {
  const canvasWidth = view.width(); const canvasHeight = view.height();
  const safeMarginX = canvasWidth * 0.08; const safeMarginY = canvasHeight * 0.07;
  ${refs.map(ref => `const ${ref} = createRef<Layout>();`).join('\n  ')}
  view.add(<Rect key="scene-background" width={canvasWidth} height={canvasHeight} fill={'#10231D'}><Layout key="scene-content-root">
    ${keys.map((key, index) => `<Layout key="${key}" ref={${refs[index]}} />`).join('\n    ')}
  </Layout></Rect>);
  ${beatIds.map((id, index) => `// lifecycle:beat:${id}:enter=${keys[index]}|stay=${keys[index]}|exit=${keys[index]}|primary=${keys[index]}
  yield* waitUntil('beat:${id}:start'); const duration${index} = useDuration('beat:${id}:end'); const end${index} = useThread().time() + duration${index};
  yield* ${refs[index]}().opacity(1, 0.2); yield* ${refs[index]}().opacity(0, 0.2); yield* waitFor(Math.max(0, end${index} - useThread().time()));`).join('\n  ')}
});`;
  const beats = beatIds.map((id, index) => ({id, primaryBlock: keys[index]!, visualLifecycle: {enter: [keys[index]!], stay: [keys[index]!], exit: [keys[index]!]}}));
  assert.doesNotThrow(() => validateMotionCanvasBeatLifecycle(source, beats));
  const crowded = source.replace(`enter=${keys[0]}|stay=${keys[0]}|exit=${keys[0]}`, `enter=${keys[0]}|stay=${keys[0]},${keys[1]},${keys[2]}|exit=${keys[0]}`);
  const crowdedBeats = [{...beats[0]!, visualLifecycle: {enter: [keys[0]!], stay: [keys[0]!, keys[1]!, keys[2]!], exit: [keys[0]!]}}, ...beats.slice(1)];
  assert.throws(() => validateMotionCanvasBeatLifecycle(crowded, crowdedBeats), MotionCanvasGenerationError);
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
  request.voiceVisualPlan.visualBible = {
    palette: {background: '#10231D', surface: '#173B31', primary: '#51B68E', accent: '#F5C451', text: '#F7FBF8'},
    typographyScale: {title: 88, label: 42, body: 34},
    shapeLanguage: 'Rounded cards around a shared anchor.',
    diagramLanguage: 'A visible relationship diagram for each beat.',
    motionTempo: 'One purposeful change per beat.',
    transitionConvention: 'Keep the anchor at each boundary.',
    visualAnchor: 'The shared search-range anchor.',
  };
  request.voiceVisualPlan.sections.forEach(section => {
    section.stateHandoff = {incoming: 'Keep the anchor.', outgoing: 'Pass the anchor forward.'};
    section.beats.forEach(beat => { beat.visualPurpose = 'Show the currently relevant search range.'; });
  });
  const generated = await generator.generate(request);

  // Section 2 comes back structurally poor (turn 2); the default bounded
  // retry spends exactly one extra turn regenerating it, and since the
  // regeneration is genuinely richer, it replaces the original scene.
  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    2,
  );
  assert.equal(generated.scenes.length, 2);
  assert.doesNotMatch(generated.scenes[1]!.source, /pivot-marker/);
  assert.equal(generated.qualityRetryDiagnostics, undefined);
  const firstPrompt = JSON.stringify(client.calls.find(call => call.method === 'turn/start')?.params);
  assert.match(firstPrompt, /visualBible/);
  assert.match(firstPrompt, /visualPurpose/);
  assert.match(firstPrompt, /stateHandoff/);
});

test('Motion Canvas quality retry giữ scene gốc khi bản sinh lại không tốt hơn thực sự', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-quality-gate-no-improve-'),
  );
  context.after(() =>
    rm(runtimeDirectory, {recursive: true, force: true}),
  );
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    // Turn 1 (section 1) is rich, establishing a high baseline. Turn 2
    // (section 2) is poor and gets flagged for retry. Turn 3 (the retry
    // itself) is poor again, so the regeneration must not replace the
    // original scene.
    (turnNumber, beatIds) =>
      turnNumber === 1 ? richTimedSceneSource(beatIds) : timedSceneSource(beatIds),
  );
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    concurrency: 1,
  });
  const request = createGenerationRequest();
  request.voiceVisualPlan.visualBible = {
    palette: {background: '#10231D', surface: '#173B31', primary: '#51B68E', accent: '#F5C451', text: '#F7FBF8'},
    typographyScale: {title: 88, label: 42, body: 34},
    shapeLanguage: 'Rounded cards around a shared anchor.',
    diagramLanguage: 'A visible relationship diagram for each beat.',
    motionTempo: 'One purposeful change per beat.',
    transitionConvention: 'Keep the anchor at each boundary.',
    visualAnchor: 'The shared search-range anchor.',
  };
  request.voiceVisualPlan.sections.forEach(section => {
    section.stateHandoff = {incoming: 'Keep the anchor.', outgoing: 'Pass the anchor forward.'};
    section.beats.forEach(beat => { beat.visualPurpose = 'Show the currently relevant search range.'; });
  });
  const generated = await generator.generate(request);

  assert.equal(generated.qualityRetryDiagnostics, undefined);
  assert.doesNotMatch(generated.scenes[1]!.source, /pivot-marker/);
});

test('Motion Canvas quality retry tắt hoàn toàn khi qualityRetryLimit = 0', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-quality-gate-disabled-'),
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
    qualityRetryLimit: 0,
  });
  const request = createGenerationRequest();
  request.voiceVisualPlan.sections.forEach(section => {
    section.stateHandoff = {incoming: 'Keep the anchor.', outgoing: 'Pass the anchor forward.'};
    section.beats.forEach(beat => { beat.visualPurpose = 'Show the currently relevant search range.'; });
  });
  const generated = await generator.generate(request);

  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    2,
  );
  assert.equal(generated.qualityRetryDiagnostics, undefined);
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
  private readonly responseFactory?: (
    turnNumber: number,
    beatIds: string[],
  ) => unknown;
  private readonly turnStartError?: Error;

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
    sourceFactory?: (
      turnNumber: number,
      beatIds: string[],
    ) => string,
    responseFactory?: (
      turnNumber: number,
      beatIds: string[],
    ) => unknown,
    turnStartError?: Error,
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
    this.responseFactory = responseFactory;
    this.turnStartError = turnStartError;
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
      if (this.turnStartError) throw this.turnStartError;
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
          const response = this.responseFactory
            ? this.responseFactory(turnNumber, beatIds)
            : (() => {
                const generatedOutput = this.sourceFactory?.(turnNumber, beatIds);
                return {
                  name: `Scene ${turnNumber}`,
                  source:
                    turnNumber <= this.invalidTurnCount
                      ? timedSceneSource(beatIds).replace(
                          'width={canvasWidth}',
                          'width={',
                        )
                      : generatedOutput ?? timedSceneSource(beatIds),
                };
              })();
          this.emit({
            method: 'item/completed',
            params: {
              threadId,
              turnId,
              item: {
                id: `message-${turnId}`,
                type: 'agentMessage',
                phase: 'final_answer',
                text: JSON.stringify(response),
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
    videoFrame: {aspectRatio: 'portrait' as const, width: 1080, height: 1920, fps: 30 as const},
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

  voiceVisualPlan.sections.forEach(section => section.beats.forEach(beat => Object.assign(beat, {
    primaryBlock: 'block-concept-card',
    visualLifecycle: {enter: ['block-concept-card'], stay: ['block-concept-card'], exit: ['block-concept-card']},
  })));

  return {
    projectId: 'test-project-a',
    generationId: randomUUID(),
    topicInput,
    outline,
    voiceVisualPlan,
  };
}

test('Motion Canvas direct generation prompt yêu cầu full literal TSX source', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-direct-prompt-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    undefined,
    (_turnNumber, beatIds) => ({
      name: 'Direct prompt scene',
      source: timedSceneSource(beatIds),
    }),
  );
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    qualityRetryLimit: 0,
  });

  const request = createSingleSceneGenerationRequest();
  await generator.generate(request);

  const generationCalls = JSON.stringify(
    client.calls.filter(call =>
      call.method === 'thread/start' || call.method === 'turn/start',
    ),
  );
  const generationPromptText = client.calls
    .filter(call =>
      call.method === 'thread/start' || call.method === 'turn/start',
    )
    .map(call =>
      ((call.params as {input?: Array<{text?: string}>}).input ?? [])
        .map(item => item.text ?? '')
        .join('\n'),
    )
    .join('\n');
  const safeMarginScaffoldIndex = generationPromptText.indexOf(
    directTsxSafeMarginScaffold,
  );
  assert.ok(safeMarginScaffoldIndex >= 0);
  assert.ok(
    safeMarginScaffoldIndex < generationPromptText.indexOf(
      '// declare every lifecycle ref exactly once before the one inline view.add:',
      safeMarginScaffoldIndex,
    ),
  );
  assert.ok(
    safeMarginScaffoldIndex < generationPromptText.indexOf(
      '  view.add(',
      safeMarginScaffoldIndex,
    ),
  );
  const beat = request.voiceVisualPlan.sections[0]!.beats[0]!;
  const lifecycle = beat.visualLifecycle!;
  const expectedMarker = `// lifecycle:beat:${beat.id}:enter=${lifecycle.enter.join(',')}|stay=${lifecycle.stay.join(',')}|exit=${lifecycle.exit.join(',')}|primary=${beat.primaryBlock}`;
  const outputSchema = (
    client.calls.find(call => call.method === 'turn/start')?.params as {
      outputSchema?: {
        properties?: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
      };
    }
  ).outputSchema;
  assert.deepEqual(
    Object.keys(outputSchema?.properties ?? {}).sort(),
    ['name', 'source'],
  );
  assert.deepEqual(outputSchema?.required?.sort(), ['name', 'source']);
  assert.equal(outputSchema?.additionalProperties, false);
  assert.match(generationCalls, /full file/u);
  assert.match(generationCalls, /imports plus/u);
  assert.match(generationCalls, /export default makeScene2D\(function\* \(view\)/u);
  assert.match(generationCalls, /entire literal TSX file contents/u);
  assert.match(generationCalls, /Do not return a Scene Spec/u);
  assert.match(generationCalls, /source:null/u);
  assert.match(generationCalls, /JSON-in-JSON/u);
  assert.match(generationCalls, /partial source/u);
  assert.ok(generationCalls.includes(expectedMarker));
  assert.match(generationCalls, /Direct TSX source-policy contract/u);
  assert.match(generationCalls, /exactly one direct view\.add\(\.\.\.\)/u);
  assert.match(generationCalls, /complete JSX tree written inline/u);
  assert.match(generationCalls, /Only block-\* containers may be direct children of scene-content-root/u);
  assert.match(generationCalls, /title, ambient\/background decoration, icon, line, text, visual detail, and semantic node/u);
  assert.match(generationCalls, /block-title/u);
  assert.match(generationCalls, /block-atmosphere/u);
  assert.match(generationCalls, /local coordinates of that block/u);
  assert.match(generationCalls, /Lifecycle execution scope/u);
  assert.match(generationCalls, /directly at top level of the default makeScene2D generator body/u);
  assert.match(generationCalls, /Never wrap a beat in \{ \.\.\. \}/u);
  assert.match(generationCalls, /BEGIN LITERAL DIRECT-TSX LIFECYCLE SCAFFOLD/u);
  assert.match(generationCalls, /Required top-level beat order and timing authority/u);
  assert.doesNotMatch(generationCalls, /const beatDuration = useDuration/u);
  assert.doesNotMatch(generationCalls, /beatEndTime = useThread\(\)\.time\(\) \+ beatDuration/u);
  assert.match(generationCalls, /Required top-level beat order.*waitUntil\(startEvent\).*useDuration\(endEvent\).*beatEndTime.*enter animations.*visual animations.*exit animations.*waitFor/u);
  assert.match(generationCalls, /Lifecycle visibility.*final 10%.*beatEndTimeN.*beatDurationN \* 0\.1/u);
  assert.match(generationCalls, /Never let a decorative, selection, range, or highlight node cover information-bearing content/u);
  assert.match(generationCalls, /Numeric-only segments are invalid.*array-cell-3.*middle-support-cell-14/u);
  assert.match(generationCalls, /scene-content-root at x=\{0\} y=\{0\}/u);
  assert.match(generationCalls, /abs\(x\) \+ width\/2 <= safeWidth\/2/u);
  assert.match(generationCalls, /Exact mustShow key checklist for this scene/u);
  assert.match(generationCalls, /ref\(\)\.opacity\(1, duration, easing\)/u);
  assert.match(generationCalls, /ref\(\)\.opacity\(0, duration, easing\) before the final waitFor/u);
  assert.match(generationCalls, /scale, scale\.x, scale\.y/u);
  assert.match(generationCalls, /opacity signal from another node/u);
  assert.match(generationCalls, /hiding only a parent as an exit/u);
  assert.match(generationCalls, /named JSX component/u);
  assert.match(generationCalls, /helper result/u);
  assert.match(generationCalls, /callback result/u);
  assert.match(generationCalls, /\.map\(\)/u);
  assert.match(generationCalls, /for loop/u);
  assert.match(generationCalls, /while loop/u);
  assert.match(generationCalls, /copy every marker line verbatim/u);
  assert.match(generationCalls, /matching JSX key string literal and attach ref=\{bareIdentifier\}/u);
  assert.doesNotMatch(generationCalls, /SceneTree/u);
  assert.doesNotMatch(generationCalls, /view\.add\(<SceneTree/u);
  assert.doesNotMatch(generationCalls, /Scene Graph v[23]/u);
});

test('Motion Canvas direct repair và regeneration dùng cùng inline lifecycle contract', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-direct-repair-prompt-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const request = createTwoBeatPromptGenerationRequest();
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    undefined,
    (turnNumber, beatIds) => ({
      name: `Invalid direct source ${turnNumber}`,
      source: timedSceneSource(beatIds).replace('ref={conceptBlock}', ''),
    }),
  );
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    concurrency: 1,
    qualityRetryLimit: 0,
  });

  const result = await generator.generate(request);

  assert.match(result.model, /local-safe-fallback/u);
  const turnCalls = client.calls.filter(call => call.method === 'turn/start');
  assert.equal(turnCalls.length, 3);
  const beat = request.voiceVisualPlan.sections[0]!.beats[0]!;
  const lifecycle = beat.visualLifecycle!;
  const expectedMarker = `// lifecycle:beat:${beat.id}:enter=${lifecycle.enter.join(',')}|stay=${lifecycle.stay.join(',')}|exit=${lifecycle.exit.join(',')}|primary=${beat.primaryBlock}`;
  for (const [index, call] of turnCalls.entries()) {
    const prompt = JSON.stringify(call.params);
    const promptText = (
      ((call.params as {input?: Array<{text?: string}>}).input ?? [])
        .map(item => item.text ?? '')
        .join('\n')
    );
    const scaffoldStart = promptText.indexOf(
      'BEGIN LITERAL DIRECT-TSX LIFECYCLE SCAFFOLD',
    );
    const scaffoldEndMarker = 'END LITERAL DIRECT-TSX LIFECYCLE SCAFFOLD';
    const scaffoldEnd = promptText.indexOf(scaffoldEndMarker, scaffoldStart);
    assert.ok(scaffoldStart >= 0, `missing scaffold in turn ${index + 1}`);
    assert.ok(scaffoldEnd > scaffoldStart, `truncated scaffold in turn ${index + 1}`);
    const scaffold = promptText.slice(
      scaffoldStart,
      scaffoldEnd + scaffoldEndMarker.length,
    );
    const safeMarginScaffoldIndex = scaffold.indexOf(
      directTsxSafeMarginScaffold,
    );
    assert.ok(
      safeMarginScaffoldIndex >= 0,
      `missing safe-margin scaffold in turn ${index + 1}`,
    );
    assert.ok(
      safeMarginScaffoldIndex < scaffold.indexOf(
        '// declare every lifecycle ref exactly once before the one inline view.add:',
        safeMarginScaffoldIndex,
      ),
    );
    assert.ok(
      safeMarginScaffoldIndex < scaffold.indexOf(
        '  view.add(',
        safeMarginScaffoldIndex,
      ),
    );
    assert.ok(prompt.includes(expectedMarker), `missing marker in turn ${index + 1}`);
    for (const [beatIndex, scaffoldBeat] of request.voiceVisualPlan.sections[0]!.beats.entries()) {
      const number = beatIndex + 1;
      assert.match(
        scaffold,
        new RegExp(`yield\\* waitUntil\\('beat:${scaffoldBeat.id}:start'\\);`, 'u'),
      );
      assert.match(
        scaffold,
        new RegExp(`const beatDuration${number} = useDuration\\('beat:${scaffoldBeat.id}:end'\\);`, 'u'),
      );
      assert.match(
        scaffold,
        new RegExp(`const beatEndTime${number} = useThread\\(\\)\\.time\\(\\) \\+ beatDuration${number};`, 'u'),
      );
    }
    assert.equal((scaffold.match(/const beatDuration1 =/gu) ?? []).length, 1);
    assert.equal((scaffold.match(/const beatEndTime1 =/gu) ?? []).length, 1);
    assert.equal((scaffold.match(/const beatDuration2 =/gu) ?? []).length, 1);
    assert.equal((scaffold.match(/const beatEndTime2 =/gu) ?? []).length, 1);
    for (const [key, refName] of [
      ['block-autumn-leaf', 'blockAutumnLeaf'],
      ['visual-detail-autumn-leaf', 'visualDetailAutumnLeaf'],
      ['block-color-shift', 'blockColorShift'],
      ['visual-detail-color-shift', 'visualDetailColorShift'],
    ]) {
      assert.match(scaffold, new RegExp(`const ${refName} = createRef<Layout>\\(\\);`, 'u'));
      assert.match(scaffold, new RegExp(`key="${key}" ref=\\{${refName}\\}`, 'u'));
      assert.match(scaffold, new RegExp(`${refName}\\(\\)\\.opacity\\(1, beatDuration[12] \\* 0\\.1, easeInOutCubic\\);`, 'u'));
      assert.match(scaffold, new RegExp(`${refName}\\(\\)\\.opacity\\(0, beatDuration[12] \\* 0\\.1, easeInOutCubic\\);`, 'u'));
    }
    assert.doesNotMatch(scaffold, /\{\s*(?:\/\/[^\r\n]*\r?\n\s*)*yield\* waitUntil/u);
    assert.doesNotMatch(scaffold, /\{\s*(?:\/\/[^\r\n]*\r?\n\s*)*const beatDuration/u);
    assert.match(prompt, /Direct TSX source-policy contract/u);
    assert.match(prompt, /complete JSX tree written inline/u);
    assert.match(prompt, /exactly one direct view\.add\(\.\.\.\)/u);
    assert.match(prompt, /Only block-\* containers may be direct children of scene-content-root/u);
    assert.match(prompt, /title, ambient\/background decoration, icon, line, text, visual detail, and semantic node/u);
    assert.match(prompt, /block-title/u);
    assert.match(prompt, /block-atmosphere/u);
    assert.match(prompt, /local coordinates of that block/u);
    assert.match(prompt, /Lifecycle execution scope/u);
    assert.match(prompt, /directly at top level of the default makeScene2D generator body/u);
    assert.match(prompt, /Never wrap a beat in \{ \.\.\. \}/u);
    assert.match(prompt, /BEGIN LITERAL DIRECT-TSX LIFECYCLE SCAFFOLD/u);
    assert.match(prompt, /Required top-level beat order and timing authority/u);
    assert.doesNotMatch(prompt, /const beatDuration = useDuration/u);
    assert.doesNotMatch(prompt, /beatEndTime = useThread\(\)\.time\(\) \+ beatDuration/u);
    assert.match(prompt, /Required top-level beat order.*waitUntil\(startEvent\).*useDuration\(endEvent\).*beatEndTime.*enter animations.*visual animations.*exit animations.*waitFor/u);
    assert.match(prompt, /ref\(\)\.opacity\(1, duration, easing\)/u);
    assert.match(prompt, /ref\(\)\.opacity\(0, duration, easing\) before the final waitFor/u);
    assert.match(prompt, /scale, scale\.x, scale\.y/u);
    assert.match(prompt, /opacity signal from another node/u);
    assert.match(prompt, /hiding only a parent as an exit/u);
    assert.match(prompt, /named JSX component/u);
    assert.match(prompt, /helper result/u);
    assert.match(prompt, /callback result/u);
    assert.match(prompt, /\.map\(\)/u);
    assert.match(prompt, /for loop/u);
    assert.match(prompt, /while loop/u);
    assert.match(prompt, /copy every marker line verbatim/u);
    assert.match(prompt, /matching JSX key string literal and attach ref=\{bareIdentifier\}/u);
    assert.doesNotMatch(prompt, /SceneTree/u);
  }
  assert.match(JSON.stringify(turnCalls[1]?.params), /Repair every lifecycle/u);
  assert.match(JSON.stringify(turnCalls[2]?.params), /complete replacement Motion Canvas TSX scene/u);
});

test('Motion Canvas direct output được chấp nhận, normalize và giữ nguyên thay vì qua Scene Spec compiler', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-direct-output-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  let rawSource = '';
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    undefined,
    (_turnNumber, beatIds) => {
      rawSource = timedSceneSource(beatIds)
        .replace(
          "import {Layout, makeScene2D, Rect} from '@motion-canvas/2d';",
          "import {Layout, makeScene2D, Rect, Txt} from '@motion-canvas/2d';",
        )
        .replace(
          `<Rect key="main-visual-card" width={640} height={120} radius={24} fill={'#dbe9e2'} />`,
          `<Rect key="main-visual-card" width={640} height={120} radius={24} fill={'#dbe9e2'}>
      <Txt key="card-title-label" ref={() => undefined} text={'transparent'} fill={'transparent'} />
    </Rect>`,
        )
        .replace(
          'import {Layout',
          '// direct-tsx-sentinel\nimport {Layout',
        );
      return {name: 'Direct source scene', source: rawSource};
    },
  );
  const request = createSingleSceneGenerationRequest();
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    qualityRetryLimit: 0,
  });

  const result = await generator.generate(request);
  const scene = result.scenes[0]!;
  const expectedSource = applyMotionCanvasDefaultFont(
    normalizeMotionCanvasColorFormats(rawSource.trim()),
  );

  assert.equal(scene.name, 'Direct source scene');
  assert.equal(scene.outlineSectionId, request.outline.sections[0]!.id);
  assert.equal(scene.filePath, 'src/scenes/01-direct-source-scene.tsx');
  assert.deepEqual(scene.timingEvents, [{
    beatId: request.voiceVisualPlan.sections[0]!.beats[0]!.id,
    startEvent: `beat:${request.voiceVisualPlan.sections[0]!.beats[0]!.id}:start`,
    endEvent: `beat:${request.voiceVisualPlan.sections[0]!.beats[0]!.id}:end`,
    plannedDurationSeconds: 12,
  }]);
  assert.equal(scene.source, `${expectedSource.trim()}\n`);
  assert.match(scene.source, /direct-tsx-sentinel/u);
  assert.match(scene.source, /fill=\{"#00000000"\}/u);
  assert.match(scene.source, /text=\{'transparent'\}/u);
  assert.match(
    scene.source,
    /fontFamily=\{"Segoe UI, Helvetica Neue, Arial, sans-serif"\}/u,
  );
  assert.equal(result.model, 'scene-model');
  assert.doesNotMatch(scene.source, /pad-scene-spec-v2|scene-(?:graph|spec)-compiler/u);
});

test('Motion Canvas direct generation từ chối output chỉ có spec hoặc source:null', async (context) => {
  for (const [label, invalidOutput] of [
    ['spec', {name: 'Spec only scene', spec: {version: 3}}],
    ['null-source', {name: 'Null source scene', source: null}],
  ] as const) {
    const runtimeDirectory = await mkdtemp(
      path.join(os.tmpdir(), `pad-studio-motion-direct-reject-${label}-`),
    );
    context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
    const client = new FakeCodexClient(
      false,
      undefined,
      false,
      undefined,
      (turnNumber, beatIds) =>
        turnNumber === 1
          ? invalidOutput
          : {name: 'Recovered direct scene', source: timedSceneSource(beatIds)},
    );
    const generator = createCodexMotionCanvasGenerator(client, {
      runtimeDirectory,
      timeoutMs: 1_000,
      qualityRetryLimit: 0,
    });

    const result = await generator.generate(createSingleSceneGenerationRequest());

    assert.equal(result.scenes[0]!.name, 'Recovered direct scene');
    assert.equal(
      client.calls.filter(call => call.method === 'turn/start').length,
      2,
      `${label} response should be rejected before clean regeneration`,
    );
    assert.equal(result.model, 'scene-model');
  }
});

test('Motion Canvas cache cô lập scene cùng generation ID giữa các project', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-project-cache-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient();
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    concurrency: 1,
  });
  const first = createGenerationRequest();
  const second = {...first, projectId: 'test-project-b'};

  await generator.generate(first);
  await generator.generate(second);

  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    first.outline.sections.length * 2,
  );
});

test('Motion Canvas releases a completed scene fingerprint before an intentional guided retry', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-guided-retry-cache-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient();
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    qualityRetryLimit: 0,
  });
  const request = createSingleSceneGenerationRequest();
  const initial = await generator.generate(request);
  const guidedRequest = {
    ...request,
    guidance: 'Increase the occupied visual area based on rendered evidence.',
    currentScenes: initial.scenes,
  };

  await assert.rejects(
    generator.generate(guidedRequest),
    (error: unknown) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_GENERATION_ID_REUSED',
  );

  generator.discardGeneration?.(request.projectId, request.generationId);
  const retried = await generator.generate(guidedRequest);

  assert.equal(retried.scenes[0]!.id, initial.scenes[0]!.id);
  assert.equal(
    client.calls.filter(call => call.method === 'turn/start').length,
    2,
  );
});

test('Motion Canvas structural attachment contract rejects yielded or detached JSX trees', () => {
  const beatId = randomUUID();
  const yieldedTree = richTimedSceneSource([beatId])
    .replace('  view.add(\n', '  yield (\n')
    .replace(
      '    <Rect key="scene-background"',
      '    <Layout key="scene-background"',
    )
    .replace('    </Rect>,\n  );', '    </Layout>\n  );');
  const detachedTree = timedSceneSource([beatId])
    .replace('  view.add(\n', '  const sceneTree = (\n')
    .replace('    </Rect>,\n  );', '    </Rect>\n  );');

  for (const source of [yieldedTree, detachedTree]) {
    assert.doesNotThrow(() => validateMotionCanvasSceneSource(source));
    assert.throws(
      () => validateMotionCanvasContainerContract(source),
      (error: unknown) =>
        error instanceof MotionCanvasGenerationError &&
        error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE' &&
        /view\.add/u.test(error.message),
    );
  }
});

test('Motion Canvas structural attachment contract rejects content root sibling of background', () => {
  const beatId = randomUUID();
  const siblingTree = timedSceneSource([beatId])
    .replace(
      '    <Rect key="scene-background"',
      '    <Layout key="block-scene-shell">\n      <Rect key="scene-background"',
    )
    .replace(
      '      <Layout key="scene-content-root">',
      '      </Rect>\n      <Layout key="scene-content-root">',
    )
    .replace('    </Rect>,\n  );', '    </Layout>,\n  );');

  assert.doesNotThrow(() => validateMotionCanvasSceneSource(siblingTree));
  assert.throws(
    () => validateMotionCanvasContainerContract(siblingTree),
    (error: unknown) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
});

test('Motion Canvas public repair applies the container contract', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-repair-container-contract-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    (turnNumber, beatIds) =>
      turnNumber === 2
        ? timedSceneSource(beatIds).replace(
            'key="scene-content-root"',
            'key="detached-content-root"',
          )
        : timedSceneSource(beatIds),
  );
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
  });
  const request = createSingleSceneGenerationRequest();
  const generated = await generator.generate(request);
  if (!generator.repair) throw new Error('Expected public repair support.');

  await assert.rejects(
    generator.repair(
      request,
      generated,
      `${generated.scenes[0]!.filePath}(12,3): error TS9999`,
    ),
    (error: unknown) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
});

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

function createTwoBeatPromptGenerationRequest() {
  const request = createSingleSceneGenerationRequest();
  const section = request.voiceVisualPlan.sections[0]!;
  const firstBeat = {
    ...section.beats[0]!,
    id: randomUUID(),
    primaryBlock: 'block-autumn-leaf',
    visualLifecycle: {
      enter: ['block-autumn-leaf', 'visual-detail-autumn-leaf'],
      stay: ['block-autumn-leaf', 'visual-detail-autumn-leaf'],
      exit: ['block-autumn-leaf', 'visual-detail-autumn-leaf'],
    },
    durationSeconds: 10,
  };
  const secondBeat = {
    ...firstBeat,
    id: randomUUID(),
    voiceover: 'Sau đó ta quan sát màu sắc thay đổi theo mùa.',
    visualDescription: 'Chi tiết chiếc lá đổi màu và rời khỏi vùng minh họa.',
    animationDescription: 'Chiếc lá đổi màu rồi biến mất khỏi khung hình.',
    primaryBlock: 'block-color-shift',
    visualLifecycle: {
      enter: ['block-color-shift', 'visual-detail-color-shift'],
      stay: ['block-color-shift', 'visual-detail-color-shift'],
      exit: ['block-color-shift', 'visual-detail-color-shift'],
    },
  };
  section.beats = [firstBeat, secondBeat];
  return request;
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
  const visualEvidence: MotionCanvasVisualEvidence[] = currentScenes.map(
    (scene, index) => ({
      sceneId: scene.id,
      beatId: request.voiceVisualPlan.sections[index]!.beats[0]!.id,
      phase: 'middle',
      frame: 12,
      timeSeconds: 6,
      png: Buffer.from(`scene-${index + 1}`),
      issues: [{
        code: 'content-occluded',
        sceneId: scene.id,
        beatId: request.voiceVisualPlan.sections[index]!.beats[0]!.id,
        timeSeconds: 6,
        semanticKey: 'overlay>content',
        bounds: {x: 0, y: 0, width: 10, height: 10},
        reason: 'Overlay covers content.',
      }],
      nodes: [{key: 'overlay', bounds: {x: 0, y: 0, width: 10, height: 10}}],
    }),
  );
  const client = new FakeCodexClient();
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
  });
  const result = await generator.generate({
    ...request,
    guidance: 'Chỉ làm scene thứ hai trực quan hơn.',
    sectionIndexes: [1],
    currentScenes,
    visualEvidence,
  });
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0]?.outlineSectionId, request.outline.sections[1]?.id);
  assert.equal(result.scenes[0]?.id, currentScenes[1]?.id);
  assert.equal(result.scenes[0]?.filePath, currentScenes[1]?.filePath);
  assert.equal(
    client.calls.filter(call => call.method === 'turn/start').length,
    1,
  );
  const turnInput = (client.calls.find(call => call.method === 'turn/start')
    ?.params as {input: Array<{type: string; text?: string; url?: string}>}).input;
  assert.equal(turnInput.filter(item => item.type === 'image').length, 1);
  const promptText = turnInput
    .filter(item => item.type === 'text')
    .map(item => item.text ?? '')
    .join('\n');
  assert.match(promptText, new RegExp(currentScenes[1]!.id, 'u'));
  assert.doesNotMatch(promptText, new RegExp(currentScenes[0]!.id, 'u'));
  assert.match(promptText, /Before editing, inspect every attached frame/u);
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
    videoFrame: {aspectRatio: 'portrait' as const, width: 1080, height: 1920, fps: 30 as const},
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
  voiceVisualPlan.sections.forEach(section => section.beats.forEach(beat => Object.assign(beat, {
    primaryBlock: 'block-concept-card',
    visualLifecycle: {enter: ['block-concept-card'], stay: ['block-concept-card'], exit: ['block-concept-card']},
  })));
  const generator = createCodexMotionCanvasGenerator(
    client,
    {runtimeDirectory, timeoutMs: 1_000},
  );

  const result = await generator.generate({
    projectId: 'capability-test-project',
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

test('local harness reproduces layout repair, invalid regeneration, and diagnostic-only fallback without Codex', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-failure-harness-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    undefined,
    (turnNumber, beatIds) => turnNumber <= 2
      ? {
          name: `Unsafe layout scene ${turnNumber}`,
          source: artifactLayoutFailureSource(beatIds, '-400'),
        }
      : {
          name: 'Malformed clean regeneration',
          source: timedSceneSource(beatIds).replace('width={640}', 'width={'),
        },
  );
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    concurrency: 1,
    qualityRetryLimit: 0,
  });
  const request = {
    ...createSingleSceneGenerationRequest(),
    videoFrame: {
      aspectRatio: 'portrait' as const,
      width: 540,
      height: 960,
      fps: 30 as const,
    },
  };

  const result = await generator.generate(request);

  assert.deepEqual(
    result.attemptEvidence?.map(attempt => [attempt.phase, attempt.error.reason]),
    [
      ['initial', 'source_validation_failed'],
      ['repair', 'source_validation_failed'],
      ['regeneration', 'response_invalid'],
    ],
  );
  assert.equal(
    client.calls.filter(call => call.method === 'turn/start').length,
    3,
  );
  const repairPrompt = JSON.stringify(
    client.calls.filter(call => call.method === 'turn/start')[1]?.params,
  );
  assert.match(repairPrompt, /semanticKey=reduced-search-range/u);
  assert.match(repairPrompt, /safeArea=/u);
  assert.match(result.attemptEvidence?.[0]?.error.diagnostics ?? '', /semanticKey=reduced-search-range/u);
  assert.match(result.attemptEvidence?.[0]?.error.diagnostics ?? '', /safeArea=/u);
  assert.match(result.attemptEvidence?.[2]?.error.diagnostics ?? '', /generated-scene\.tsx\(/u);
  assert.match(result.attemptEvidence?.[2]?.sourceExcerpt ?? '', /width=\{/u);
  assert.match(result.scenes[0]!.source, /pad-semantic:unverified-fallback/u);
  assert.throws(
    () => assertMotionCanvasScenesArePublishable(result.scenes, 'workspace preparation'),
    /deterministic fallback output.*workspace preparation/u,
  );
});

test('Motion Canvas defaults to eight workers and reports per-scene progress', async context => {
  assert.equal(DEFAULT_MOTION_CANVAS_GENERATION_CONCURRENCY, 8);
  assert.equal(MAXIMUM_MOTION_CANVAS_GENERATION_CONCURRENCY, 8);
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-progress-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const events: Array<{completedScenes: number; outcome: string}> = [];
  const request = createGenerationRequest();
  request.onProgress = progress => events.push(progress);
  const generator = createCodexMotionCanvasGenerator(new FakeCodexClient(), {
    runtimeDirectory,
    timeoutMs: 1_000,
    qualityRetryLimit: 0,
  });

  const result = await generator.generate(request);

  assert.equal(result.scenes.length, 2);
  assert.deepEqual(events.map(event => event.outcome), [
    'started',
    'completed',
    'completed',
  ]);
  assert.equal(events.at(-1)?.completedScenes, 2);
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

test('Motion Canvas generator sinh mới sạch khi lượt sửa vẫn vi phạm lifecycle binding', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-lifecycle-regeneration-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    (turnNumber, beatIds) => turnNumber <= 2
      ? timedSceneSource(beatIds).replace('ref={conceptBlock}', '')
      : timedSceneSource(beatIds),
  );
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    qualityRetryLimit: 0,
  });

  const result = await generator.generate(
    createSingleSceneGenerationRequest(),
  );

  assert.doesNotMatch(result.model, /local-safe-fallback/u);
  assert.equal(
    client.calls.filter(call => call.method === 'turn/start').length,
    3,
  );
  const firstPrompt = JSON.stringify(
    client.calls.find(call => call.method === 'turn/start')?.params,
  );
  assert.match(firstPrompt, /inseparable triple/u);
  assert.match(firstPrompt, /lifecycle binding/iu);
  assert.doesNotMatch(firstPrompt, /ref=\\u007bpriorityOrbit\\u007d|ref=\{priorityOrbit\}/u);
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
  const request = {
    ...createSingleSceneGenerationRequest(),
    videoFrame: {
      aspectRatio: 'square' as const,
      width: 480,
      height: 480,
      fps: 24 as const,
    },
  };

  const result = await generator.generate(request);

  assert.match(result.model, /local-safe-fallback/);
  assert.match(
    result.scenes[0]!.source,
    /fontFamily=\{"Segoe UI, Helvetica Neue, Arial, sans-serif"\}/u,
  );
  assert.match(result.scenes[0]!.source, /width=\{canvasWidth\} height=\{canvasHeight\}/u);
  assert.doesNotMatch(result.scenes[0]!.source, /1080|1920/u);
  validateMotionCanvasSceneSource(result.scenes[0]!.source);
  validateMotionCanvasBackground(result.scenes[0]!.source, '#10231D');
  validateMotionCanvasContainerContract(result.scenes[0]!.source);
  validateMotionCanvasTimingContract(
    result.scenes[0]!.source,
    request.voiceVisualPlan.sections[0]!.beats,
  );
  validateMotionCanvasBeatLifecycle(result.scenes[0]!.source, request.voiceVisualPlan.sections[0]!.beats, request.videoFrame);
  assert.match(result.scenes[0]!.source, /const beatEndTime1 = useThread\(\)\.time\(\) \+ beatDuration1;/u);
  assert.match(result.scenes[0]!.source, /yield\* all\(\s*lifecycleNode1\(\)\.opacity\(0, exitDuration1\),/u);
  assert.match(result.scenes[0]!.source, /yield\* waitFor\(Math\.max\(0, beatEndTime1 - useThread\(\)\.time\(\)\)\);/u);
  // Invalid-source recovery is bounded at three Codex turns. The old fourth
  // turn was a speculative richness retry of the local fallback and duplicated
  // the rendered/semantic gate that follows this generator.
  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').length,
    3,
  );
});

test('direct-TSX failure artifact giữ ba attempt và reject fallback trước mutation', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-failure-attempts-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const failedSources = (beatIds: string[]) => [
    `${timedSceneSource(beatIds).replace('width={canvasWidth}', 'width={')}\n// attempt-source-initial`,
    `${timedSceneSource(beatIds).replace('ref={conceptBlock}', '')}\n// attempt-source-repair`,
    `${timedSceneSource(beatIds).replace('const canvasWidth = view.width();', 'const canvasWidth = 1080;')}\n// attempt-source-regeneration\n// sk-proj-DO_NOT_PERSIST_THIS_CREDENTIAL_123456789`,
  ];
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    undefined,
    (turnNumber, beatIds) => ({
      name: `Invalid direct source ${turnNumber}`,
      source: failedSources(beatIds)[Math.min(turnNumber - 1, 2)]!,
    }),
  );
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    concurrency: 1,
    qualityRetryLimit: 0,
  });
  const request = createSingleSceneGenerationRequest();
  const result = await generator.generate(request);

  assert.match(result.model, /local-safe-fallback/u);
  assert.deepEqual(
    result.attemptEvidence?.map(attempt => attempt.phase),
    ['initial', 'repair', 'regeneration'],
  );
  assert.equal(result.attemptEvidence?.length, 3);
  for (const [index, attempt] of (result.attemptEvidence ?? []).entries()) {
    assert.equal(attempt.model, 'scene-model');
    assert.equal(attempt.reasoningEffort, 'medium');
    assert.match(attempt.error.code, /^CODEX_MOTION_CANVAS_/u);
    assert.ok(attempt.error.message.length > 0);
    assert.ok(attempt.error.diagnostics.length > 0);
    assert.match(attempt.sourceHash, /^[a-f0-9]{64}$/u);
    assert.ok(attempt.sourceLength > 0);
    assert.ok(attempt.sourceExcerpt.length <= MOTION_CANVAS_FAILURE_ATTEMPT_SOURCE_MAX_CHARS);
    assert.match(attempt.sourceExcerpt, new RegExp(`attempt-source-${['initial', 'repair', 'regeneration'][index]}`, 'u'));
  }
  assert.doesNotMatch(
    JSON.stringify(result.attemptEvidence),
    /DO_NOT_PERSIST_THIS_CREDENTIAL|sk-proj-/u,
  );

  const workspace = createMotionCanvasWorkspace(runtimeDirectory);
  const generationId = randomUUID();
  const evidenceDirectory = await workspace.recordFailure!(
    request.projectId,
    generationId,
    {
      stage: 'render-quality',
      code: 'MOTION_CANVAS_VISUAL_QUALITY_FAILED',
      message: 'Fallback scene output was rejected.',
      issues: [{reason: 'Fallback scene output was rejected before workspace preparation.'}],
      attempts: result.attemptEvidence,
      scenes: result.scenes,
    },
  );
  let workspacePrepareCalls = 0;
  let projectMutations = 0;
  const publish = () => {
    assertMotionCanvasScenesArePublishable(result.scenes, 'workspace preparation');
    workspacePrepareCalls += 1;
    projectMutations += 1;
  };
  assert.throws(publish, /deterministic fallback output.*workspace preparation/u);
  assert.equal(workspacePrepareCalls, 0);
  assert.equal(projectMutations, 0);

  const artifact = JSON.parse(
    await readFile(path.join(evidenceDirectory, 'failure.json'), 'utf8'),
  ) as {
    message: string;
    attempts: Array<{phase: string; sourceExcerpt: string; error: {code: string; diagnostics: string}}>;
  };
  assert.equal(artifact.message, 'Fallback scene output was rejected.');
  assert.equal(artifact.attempts.length, 3);
  assert.deepEqual(
    artifact.attempts.map(attempt => attempt.phase),
    ['initial', 'repair', 'regeneration'],
  );
  assert.ok(artifact.attempts.every(attempt => attempt.error.code && attempt.error.diagnostics));
  assert.doesNotMatch(
    await readFile(path.join(evidenceDirectory, 'failure.json'), 'utf8'),
    /DO_NOT_PERSIST_THIS_CREDENTIAL|sk-proj-/u,
  );
});

test('Motion Canvas fallback is derived from arbitrary multi-beat lifecycle keys', async (context) => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-lifecycle-fallback-'),
  );
  context.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  const request = createSingleSceneGenerationRequest();
  const section = request.voiceVisualPlan.sections[0]!;
  const first = section.beats[0]!;
  Object.assign(first, {
    primaryBlock: 'block-priority-orbit',
    visualLifecycle: {
      enter: ['block-priority-orbit', 'diagram-processing-gate'],
      stay: ['block-priority-orbit', 'diagram-processing-gate'],
      exit: ['block-priority-orbit', 'diagram-processing-gate'],
    },
  });
  section.beats = [
    first,
    {
      ...first,
      id: randomUUID(),
      visualDescription: 'Các đỉnh đồ thị hội tụ về phần tử tốt nhất.',
      primaryBlock: 'block-graph-frontier',
      visualLifecycle: {
        enter: ['block-graph-frontier', 'indicator-best-candidate'],
        stay: ['block-graph-frontier', 'indicator-best-candidate'],
        exit: ['block-graph-frontier', 'indicator-best-candidate'],
      },
    },
  ];
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    (_turnNumber, beatIds) => timedSceneSource(beatIds),
  );
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    qualityRetryLimit: 0,
  });

  const result = await generator.generate(request);
  const source = result.scenes[0]!.source;

  assert.match(result.model, /local-safe-fallback/u);
  for (const key of [
    'block-priority-orbit',
    'diagram-processing-gate',
    'block-graph-frontier',
    'indicator-best-candidate',
  ]) {
    assert.match(source, new RegExp(`key="${key}"\\s+ref=\\{lifecycleNode\\d+\\}`, 'u'));
  }
  validateMotionCanvasSceneSource(source);
  validateMotionCanvasBackground(source, request.topicInput.background.color);
  validateMotionCanvasContainerContract(source);
  validateMotionCanvasTimingContract(source, section.beats);
  validateMotionCanvasBeatLifecycle(source, section.beats, request.topicInput.videoFrame);
  validateMotionCanvasResponsiveLayout(source, request.topicInput.videoFrame, section.beats);
  const prepared = await createMotionCanvasWorkspace(runtimeDirectory).prepare(
    request.projectId,
    randomUUID(),
    result.scenes,
    request.topicInput.videoFrame,
  );
  assert.equal(prepared.scenes.length, 1);
  assert.match(prepared.validation.sourceHash, /^[a-f0-9]{64}$/u);
  assert.equal(
    client.calls.filter(call => call.method === 'turn/start').length,
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
  assert.match(recovered.scenes[0]!.source, /block-fallback-scene-heading/u);
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

test('Motion Canvas source policy cho phép import icon atlas cố định', () => {
  const source = sceneSource.replace(
    "import {makeScene2D, Rect} from '@motion-canvas/2d';",
    `import {makeScene2D, Rect} from '@motion-canvas/2d';\nimport {Icon} from '${MOTION_CANVAS_ICON_ATLAS_IMPORT_SPECIFIER}';`,
  );
  assert.doesNotThrow(() => validateMotionCanvasSceneSource(source));
});

test('Motion Canvas icon reference validator chấp nhận icon hợp lệ và từ chối icon không tồn tại kèm gợi ý', () => {
  assert.doesNotThrow(() =>
    validateMotionCanvasIconReferences(
      '<Icon key="leaf-icon" id="ph:leaf" width={40} height={40} />',
    ),
  );
  assert.throws(
    () =>
      validateMotionCanvasIconReferences(
        '<Icon key="leaf-icon" id="ph:this-icon-does-not-exist" width={40} height={40} />',
      ),
    (error: unknown) =>
      error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
  );
  // A non-Icon element with an "id" attribute must never be mistaken for an
  // icon reference.
  assert.doesNotThrow(() =>
    validateMotionCanvasIconReferences(
      '<Rect key="card" id="not-an-icon-reference" />',
    ),
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

test('Motion Canvas source policy binds every mustShow Visual Intent id to an exact JSX key', () => {
  const beats = [{visualIntent: {
    entities: [{id: 'main-visual-card', mustShow: true}],
    relations: [{id: 'concept-relation', mustShow: true}],
    actions: [{id: 'concept-action', mustShow: true}],
  }}] as Parameters<typeof validateMotionCanvasVisualIntentBindings>[1];
  const bound = `// pad-semantic:bindings-v1\n${sceneSource}`.replace(
    '    </Rect>,',
    '      <Rect key="concept-relation" />\n      <Rect key="concept-action" />\n    </Rect>,',
  );
  assert.doesNotThrow(() => validateMotionCanvasVisualIntentBindings(bound, beats));
  assert.throws(
    () => validateMotionCanvasVisualIntentBindings(`// pad-semantic:bindings-v1\n${sceneSource}`, beats),
    (error: unknown) => error instanceof MotionCanvasGenerationError &&
      error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE' &&
      /concept-relation/u.test(error.message),
  );
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

test('Motion Canvas ghi attempt initial khi turn/start bị reject trước khi có source', async context => {
  const runtimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-initial-failure-evidence-'),
  );
  context.after(() =>
    rm(runtimeDirectory, {recursive: true, force: true}),
  );
  const progressEvents: Array<{
    completedScenes: number;
    failedScenes: number;
    outcome: string;
  }> = [];
  const request = createSingleSceneGenerationRequest();
  request.onProgress = progress => progressEvents.push(progress);
  const client = new FakeCodexClient(
    false,
    undefined,
    false,
    undefined,
    undefined,
    new Error('turn/start rejected by app-server: request was refused'),
  );
  const generator = createCodexMotionCanvasGenerator(client, {
    runtimeDirectory,
    timeoutMs: 1_000,
    concurrency: 1,
  });

  let failure: unknown;
  try {
    await generator.generate(request);
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof MotionCanvasGenerationError);
  const generationError = failure as MotionCanvasGenerationError;
  assert.equal(generationError.code, 'CODEX_MOTION_CANVAS_TURN_START_REJECTED');
  assert.equal(generationError.rootCause?.reason, 'turn_start_rejected');
  assert.equal(generationError.rootCause?.operation, 'turn/start');
  assert.match(generationError.rootCause?.providerMessage ?? '', /turn\/start rejected/u);
  assert.equal(generationError.attemptEvidence.length, 1);
  const attempt = generationError.attemptEvidence[0]!;
  assert.equal(attempt.phase, 'initial');
  assert.equal(attempt.model, 'scene-model');
  assert.equal(attempt.reasoningEffort, 'medium');
  assert.equal(attempt.error.reason, 'turn_start_rejected');
  assert.equal(attempt.error.code, 'CODEX_MOTION_CANVAS_TURN_START_REJECTED');
  assert.equal(attempt.error.operation, 'turn/start');
  assert.equal(attempt.sourceLength, 0);
  assert.match(attempt.sourceHash, /^[a-f0-9]{64}$/u);
  assert.equal(attempt.sourceExcerpt, '');
  assert.equal(progressEvents.at(-1)?.completedScenes, 0);
  assert.equal(progressEvents.at(-1)?.failedScenes, 1);
  assert.equal(progressEvents.at(-1)?.outcome, 'failed');
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
