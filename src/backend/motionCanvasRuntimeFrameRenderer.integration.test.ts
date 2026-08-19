import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {findBrowserExecutable} from './finalRenderService.ts';
import type {MotionCanvasSourceScene} from './motionCanvasGenerator.ts';
import {createMotionCanvasRuntimeFrameRenderer} from './motionCanvasRuntimeFrameRenderer.ts';
import {createMotionCanvasWorkspace} from './motionCanvasWorkspace.ts';
import {MotionCanvasVisualQualityError, validateRenderedMotionCanvas} from './motionCanvasVisualQuality.ts';

const browser = findBrowserExecutable(process.env.PAD_BROWSER_PATH);

function source(key: string, color: string) {
  return `import {Rect, makeScene2D} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(<Rect key="${key}" width={160} height={90} fill="${color}" />);
  yield* waitFor(4);
});
`;
}

test('runtime renderer returns independent RGBA and semantic geometry for two real Chrome scenes', {
  skip: browser ? false : 'Chrome or Edge is unavailable.',
  timeout: 60_000,
}, async context => {
  const blockKeys = ['block-integration-one', 'block-integration-two'];
  const projectsDirectory = await mkdtemp(path.join(os.tmpdir(), 'pad-quality-integration-'));
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const generationId = randomUUID();
  const beatIds = [randomUUID(), randomUUID()];
  const scenes: MotionCanvasSourceScene[] = beatIds.map((beatId, index) => ({
    id: randomUUID(),
    outlineSectionId: randomUUID(),
    name: `integration-${index + 1}`,
    filePath: `src/scenes/0${index + 1}-integration-${index + 1}.tsx`,
    durationSeconds: 4,
    timingEvents: [{
      beatId,
      startEvent: `beat:${beatId}:start`,
      endEvent: `beat:${beatId}:end`,
      plannedDurationSeconds: 4,
    }],
    source: source(blockKeys[index]!, index === 0 ? '#ff0000' : '#00ff00'),
  }));
  const prepared = await createMotionCanvasWorkspace(projectsDirectory).prepare(
    'quality-integration',
    generationId,
    scenes,
    {aspectRatio: 'landscape', width: 320, height: 180, fps: 24},
  );
  const samples = scenes.map((scene, index) => ({
    sampleId: `sample-${index + 1}`,
    sceneId: scene.id,
    beatId: beatIds[index]!,
    phase: 'middle' as const,
    timeSeconds: 2,
    frame: index * 96 + 48,
  }));
  const rendered = await createMotionCanvasRuntimeFrameRenderer({browserNoSandbox: true}).render({
    scenes,
    samples,
    frame: {width: 320, height: 180, fps: 24},
    workspaceDirectory: prepared.workspaceDirectory,
    projectFile: prepared.projectFilePath,
    managedKeysByBeat: new Map(beatIds.map((beatId, index) => [beatId, [blockKeys[index]!]])),
  });

  assert.deepEqual([...rendered.keys()], ['sample-1', 'sample-2']);
  for (const [index, sample] of samples.entries()) {
    const frame = rendered.get(sample.sampleId);
    assert.ok(frame);
    assert.equal(frame.width, 320);
    assert.equal(frame.height, 180);
    assert.equal(frame.rgba.length, 320 * 180 * 4);
    const node = frame.nodes.find(candidate => candidate.key === blockKeys[index]);
    assert.ok(node);
    assert.equal(node.managed, true);
    assert.ok(node.bounds.width > 0);
    assert.ok(node.bounds.height > 0);
  }
  assert.notDeepEqual(rendered.get('sample-1')!.rgba, rendered.get('sample-2')!.rgba);
});

function occludedSource() {
  return `import {Rect, makeScene2D} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(
    <Rect key="scene-background" width={320} height={180} fill="#10231D">
      <Rect key="block-focus-card" width={160} height={90} fill="#51B68E" />
      <Rect key="overlay-panel" width={220} height={140} fill="#F5C451" />
    </Rect>,
  );
  yield* waitFor(4);
});
`;
}

function denseSource() {
  return `import {Rect, makeScene2D} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(
    <Rect key="scene-background" width={320} height={180} fill="#10231D">
      <Rect key="block-dense-wall" width={320} height={180} fill="#51B68E" />
    </Rect>,
  );
  yield* waitFor(4);
});
`;
}

const integrationBible = {
  palette: {background: '#10231D', surface: '#173B31', primary: '#51B68E', accent: '#F5C451', text: '#F7FBF8'},
  typographyScale: {title: 88, label: 42, body: 34},
  shapeLanguage: 'Thẻ bo góc nhất quán cho fixture kiểm thử.',
  diagramLanguage: 'Sơ đồ khối đơn giản cho fixture kiểm thử.',
  motionTempo: 'Nhịp vừa cho fixture kiểm thử.',
  transitionConvention: 'Giữ anchor giữa các scene cho fixture kiểm thử.',
  visualAnchor: 'Khối trung tâm của fixture kiểm thử.',
};

test('real Chrome geometry trips the composition checks on two deliberately broken scenes', {
  skip: browser ? false : 'Chrome or Edge is unavailable.',
  timeout: 120_000,
}, async context => {
  const projectsDirectory = await mkdtemp(path.join(os.tmpdir(), 'pad-quality-composition-'));
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const beatIds = [randomUUID(), randomUUID()];
  const sources = [occludedSource(), denseSource()];
  const scenes: MotionCanvasSourceScene[] = beatIds.map((beatId, index) => ({
    id: randomUUID(),
    outlineSectionId: randomUUID(),
    name: `composition-${index + 1}`,
    filePath: `src/scenes/0${index + 1}-composition-${index + 1}.tsx`,
    durationSeconds: 4,
    timingEvents: [{
      beatId,
      startEvent: `beat:${beatId}:start`,
      endEvent: `beat:${beatId}:end`,
      plannedDurationSeconds: 4,
    }],
    source: sources[index]!,
  }));
  const prepared = await createMotionCanvasWorkspace(projectsDirectory).prepare(
    'quality-composition',
    randomUUID(),
    scenes,
    {aspectRatio: 'landscape', width: 320, height: 180, fps: 24},
  );
  const primaryBlocks = ['block-focus-card', 'block-dense-wall'];
  const lifecycle = new Map(beatIds.map((beatId, index) => [beatId, {
    stay: [primaryBlocks[index]!],
    primaryBlock: primaryBlocks[index]!,
    compositionContract: {
      visualFocus: 'Khối trung tâm giữ toàn bộ sự chú ý của beat này.',
      hierarchy: [primaryBlocks[index]!, primaryBlocks[index]!],
      semanticRole: 'claim' as const,
      layout: 'full-bleed' as const,
      density: 'balanced' as const,
      spacingNotes: 'Giữ khoảng thở rộng quanh khối trung tâm.',
    },
  }]));

  const failure = await validateRenderedMotionCanvas({
    scenes: prepared.sourceScenes,
    lifecycle,
    frame: {width: 320, height: 180, fps: 24},
    backgroundColor: '#10231D',
    visualBible: integrationBible,
    renderer: createMotionCanvasRuntimeFrameRenderer({browserNoSandbox: true}),
    workspaceDirectory: prepared.workspaceDirectory,
    projectFile: prepared.projectFilePath,
  }).then(() => null, (error: unknown) => {
    if (error instanceof MotionCanvasVisualQualityError) return error.summary;
    throw error;
  });

  assert.ok(failure, 'the deliberately broken scenes must fail the rendered-frame gate');
  const codes = new Set(failure.issues.map(issue => issue.code));
  const detail = failure.issues.map(issue => `${issue.code}: ${issue.reason}`).join(' | ');
  assert.ok(codes.has('content-occluded'), `expected content-occluded, got ${detail}`);
  assert.ok(codes.has('frame-too-dense'), `expected frame-too-dense, got ${detail}`);
  assert.ok(failure.issues.some(issue => issue.code === 'content-occluded' && issue.sceneId === scenes[0]!.id));
  assert.ok(failure.issues.some(issue => issue.code === 'frame-too-dense' && issue.sceneId === scenes[1]!.id));
  assert.ok(!codes.has('palette-drift'), 'palette-conforming fills must not drift');
  assert.ok(!codes.has('renderer-error'), 'the real renderer must return every requested sample');
});
