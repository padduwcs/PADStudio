import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {findBrowserExecutable} from './finalRenderService.ts';
import type {VoiceVisualBeat} from '../shared/topic.ts';
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
  const renderer = createMotionCanvasRuntimeFrameRenderer({browserNoSandbox: true});
  const rendered = await renderer.render({
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

  const cachedProgress: Array<{
    completedSamples: number;
    totalSamples: number;
    cachedSamples: number;
  }> = [];
  const cached = await renderer.render({
    scenes,
    samples,
    frame: {width: 320, height: 180, fps: 24},
    workspaceDirectory: prepared.workspaceDirectory,
    projectFile: prepared.projectFilePath,
    managedKeysByBeat: new Map(beatIds.map((beatId, index) => [beatId, [blockKeys[index]!]])),
    onProgress: progress => cachedProgress.push(progress),
  });
  assert.deepEqual([...cached.keys()], ['sample-1', 'sample-2']);
  assert.deepEqual(cachedProgress.at(-1), {
    completedSamples: 2,
    totalSamples: 2,
    cachedSamples: 2,
  });
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

/**
 * Hand-authored equivalent of what used to be a compiled Scene Spec fixture:
 * one primary `block-*` card carrying a title/caption pair plus a small
 * secondary decoration (`diagram-priority-flow`, not `block-`-prefixed so it
 * is not itself tracked as an active block). Every colour is taken verbatim
 * from `integrationBible.palette` so the palette-drift check passes exactly.
 */
function priorityQueueSource() {
  return `import {Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(
    <Rect key="scene-background" width={540} height={960} fill="#10231D">
      <Rect key="block-priority-queue" width={400} height={460} radius={24} fill="#173B31">
        <Txt key="priority-queue-title" text="Xử lý theo ưu tiên" y={-140} width={340} fontSize={50} fill="#F7FBF8" textAlign="center" />
        <Txt key="priority-queue-caption" text="Quan trọng trước, có thể chờ sau" y={140} width={340} fontSize={26} fill="#F7FBF8" textAlign="center" />
      </Rect>
      <Rect key="diagram-priority-flow" y={330} width={160} height={10} fill="#F5C451" />
    </Rect>,
  );
  yield* waitFor(8);
});
`;
}

test('hand-authored priority queue scene stays visible through pre-exit rendered sampling', {
  skip: browser ? false : 'Chrome or Edge is unavailable.',
  timeout: 120_000,
}, async context => {
  const projectsDirectory = await mkdtemp(path.join(os.tmpdir(), 'pad-scene-render-'));
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const beatId = randomUUID();
  const beat: VoiceVisualBeat = {
    id: beatId,
    voiceover: 'Các việc quan trọng đi qua hàng đợi theo đúng mức ưu tiên.',
    visualDescription: 'Ba thẻ ưu tiên đi theo một hàng đợi có hướng rõ ràng.',
    visualPurpose: 'Cho thấy trực quan thứ tự xử lý của hàng đợi ưu tiên.',
    animationDescription: 'Hàng đợi xuất hiện, dịch chuyển nhẹ rồi chỉ thoát ở cuối beat.',
    visualLifecycle: {
      enter: ['block-priority-queue', 'diagram-priority-flow'],
      stay: ['block-priority-queue', 'diagram-priority-flow'],
      exit: ['block-priority-queue', 'diagram-priority-flow'],
    },
    primaryBlock: 'block-priority-queue',
    compositionContract: {
      visualFocus: 'Hàng đợi ưu tiên ở trung tâm là khối thị giác lớn nhất.',
      hierarchy: ['block-priority-queue', 'diagram-priority-flow'],
      semanticRole: 'process',
      layout: 'center-focus',
      density: 'balanced',
      spacingNotes: 'Giữ khoảng thở đều quanh hàng đợi và nhãn ngắn.',
    },
    visualHoldSeconds: 0,
    durationSeconds: 8,
  };
  const frame = {aspectRatio: 'portrait' as const, width: 540, height: 960, fps: 24 as const};
  const visualBible = {
    ...integrationBible,
    typographyScale: {title: 50, label: 26, body: 22},
  };
  const scene: MotionCanvasSourceScene = {
    id: randomUUID(),
    outlineSectionId: randomUUID(),
    name: 'Hand-authored priority queue',
    filePath: 'src/scenes/01-priority-queue.tsx',
    durationSeconds: 8,
    timingEvents: [{
      beatId,
      startEvent: `beat:${beatId}:start`,
      endEvent: `beat:${beatId}:end`,
      plannedDurationSeconds: 8,
    }],
    source: priorityQueueSource(),
  };
  const prepared = await createMotionCanvasWorkspace(projectsDirectory).prepare(
    'priority-queue-render',
    randomUUID(),
    [scene],
    frame,
  );

  const summary = await validateRenderedMotionCanvas({
    scenes: prepared.sourceScenes,
    lifecycle: new Map([[beatId, {
      stay: beat.visualLifecycle!.stay,
      primaryBlock: beat.primaryBlock,
      compositionContract: beat.compositionContract,
    }]]),
    frame,
    backgroundColor: '#10231D',
    visualBible,
    renderer: createMotionCanvasRuntimeFrameRenderer({browserNoSandbox: true}),
    workspaceDirectory: prepared.workspaceDirectory,
    projectFile: prepared.projectFilePath,
  });

  assert.equal(summary.status, 'passed');
  assert.deepEqual(
    summary.scenes[0]?.samples.map(sample => sample.phase),
    ['stable-start', 'middle', 'pre-exit'],
  );
  assert.ok(summary.scenes[0]?.samples.every(sample =>
    sample.activeBlocks.includes('block-priority-queue'),
  ));
});

/**
 * Hand-authored equivalent of what used to be a compiled Scene Graph v3
 * fixture: one primary `block-*` card containing three simple composite
 * "figures" (two patients and a treatment doorway) plus a title/caption, so
 * the scene still tells the same visually-composite story without any
 * declarative spec or compiler in between. Colours are taken verbatim from
 * `integrationBible.palette`.
 */
function hospitalPrioritySource() {
  return `import {Circle, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(
    <Rect key="scene-background" width={540} height={960} fill="#10231D">
      <Rect key="block-hospital-priority" width={420} height={520} radius={24} fill="#173B31">
        <Txt key="hospital-priority-title" text="Điều trị theo ưu tiên" y={-210} width={360} fontSize={50} fill="#F7FBF8" textAlign="center" />
        <Circle key="waiting-patient-figure" x={-130} y={20} width={90} height={90} fill="#51B68E" />
        <Circle key="urgent-patient-figure" x={0} y={0} width={110} height={110} fill="#F5C451" />
        <Rect key="treatment-door-figure" x={130} y={20} width={90} height={130} radius={12} fill="#51B68E" />
        <Txt key="hospital-priority-caption" text="Khẩn cấp đi trước" y={210} width={360} fontSize={26} fill="#F7FBF8" textAlign="center" />
      </Rect>
    </Rect>,
  );
  yield* waitFor(8);
});
`;
}

test('hand-authored hospital priority scene renders composite figures through every stable sample', {
  skip: browser ? false : 'Chrome or Edge is unavailable.',
  timeout: 120_000,
}, async context => {
  const projectsDirectory = await mkdtemp(path.join(os.tmpdir(), 'pad-hospital-priority-render-'));
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const beatId = randomUUID();
  const frame = {aspectRatio: 'portrait' as const, width: 540, height: 960, fps: 24 as const};
  const visualIntent = {
    message: 'A critical patient visibly moves ahead into the treatment room.',
    viewerShouldInfer: 'Urgency changes the service order without relying on explanatory text.',
    abstraction: 'mixed' as const,
    entities: [
      {id: 'waiting-patient', kind: 'patient', label: 'Chờ', role: 'support' as const, appearance: 'A seated patient with a calm blue badge.', state: 'waiting', mustShow: true},
      {id: 'urgent-patient', kind: 'critical patient', label: 'Khẩn', role: 'primary' as const, appearance: 'A standing patient with an orange emergency badge.', state: 'urgent', mustShow: true},
      {id: 'treatment-door', kind: 'hospital room', label: 'Điều trị', role: 'context' as const, appearance: 'An open treatment doorway marked by a medical cross.', state: 'open', mustShow: true},
    ],
    relations: [{id: 'urgent-dispatch-path', type: 'dispatch path', from: 'urgent-patient', to: 'treatment-door', description: 'An arrow connects the urgent patient to treatment.', mustShow: true}],
    actions: [{id: 'urgent-moves-first', actor: 'urgent-patient', verb: 'moves first', target: 'treatment-door', description: 'The urgent patient advances into treatment.', fromState: 'waiting', toState: 'treated', mustShow: true}],
  };
  const beat: VoiceVisualBeat = {
    id: beatId,
    voiceover: 'Bệnh nhân khẩn cấp được điều trị trước người đang chờ.',
    visualDescription: 'Hai bệnh nhân và một cửa điều trị tạo thành câu chuyện ưu tiên trực quan.',
    visualPurpose: 'Cho thấy khẩn cấp làm thay đổi thứ tự phục vụ.',
    animationDescription: 'Bệnh nhân khẩn cấp tiến theo mũi tên vào cửa điều trị.',
    visualIntent,
    visualLifecycle: {enter: ['block-hospital-priority'], stay: ['block-hospital-priority'], exit: ['block-hospital-priority']},
    primaryBlock: 'block-hospital-priority',
    compositionContract: {visualFocus: 'Bệnh nhân khẩn cấp đang tiến về cửa điều trị.', hierarchy: ['block-hospital-priority', 'urgent-patient-figure'], semanticRole: 'process', layout: 'center-focus', density: 'balanced', spacingNotes: 'Giữ ba đối tượng tách nhau và đường đi không cắt nhãn.'},
    visualHoldSeconds: 0,
    durationSeconds: 8,
  };
  // The hierarchy key is an inner semantic key, so keep it explicitly active.
  beat.visualLifecycle!.stay.push('urgent-patient-figure');
  beat.visualLifecycle!.enter.push('urgent-patient-figure');
  beat.visualLifecycle!.exit.push('urgent-patient-figure');
  const scene: MotionCanvasSourceScene = {id: randomUUID(), outlineSectionId: randomUUID(), name: 'Hospital priority', filePath: 'src/scenes/01-hospital-priority.tsx', durationSeconds: 8, timingEvents: [{beatId, startEvent: `beat:${beatId}:start`, endEvent: `beat:${beatId}:end`, plannedDurationSeconds: 8}], source: hospitalPrioritySource()};
  const prepared = await createMotionCanvasWorkspace(projectsDirectory).prepare('hospital-priority-render', randomUUID(), [scene], frame);
  const summary = await validateRenderedMotionCanvas({scenes: prepared.sourceScenes, lifecycle: new Map([[beatId, {stay: beat.visualLifecycle!.stay, primaryBlock: beat.primaryBlock, compositionContract: beat.compositionContract, visualIntent}]]), frame, backgroundColor: '#10231D', visualBible: {...integrationBible, typographyScale: {title: 50, label: 26, body: 22}}, renderer: createMotionCanvasRuntimeFrameRenderer({browserNoSandbox: true}), workspaceDirectory: prepared.workspaceDirectory, projectFile: prepared.projectFilePath}).catch(error => {
    if (error instanceof MotionCanvasVisualQualityError) {
      assert.fail(error.summary.issues.map(issue => `${issue.code}: ${issue.reason}`).join(' | '));
    }
    throw error;
  });
  assert.equal(summary.status, 'passed');
  assert.ok(summary.scenes[0]?.samples.every(sample => sample.activeBlocks.includes('block-hospital-priority')));
});
