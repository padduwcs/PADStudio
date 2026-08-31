import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {MotionCanvasBundle} from '../shared/topic.ts';
import type {MotionCanvasSourceScene} from './motionCanvasGenerator.ts';
import {
  createMotionCanvasWorkspace,
  MotionCanvasWorkspaceError,
} from './motionCanvasWorkspace.ts';
import type {MotionCanvasVisualEvidence} from './motionCanvasVisualQuality.ts';

const source = `import {makeScene2D, Rect} from '@motion-canvas/2d';
import {createRef, waitFor} from '@motion-canvas/core';
import {Icon} from '../iconAtlas';

export default makeScene2D(function* (view) {
  const leaf = createRef<Icon>();
  view.add(
    <Rect width={720} height={120} radius={24} fill={'#dbe9e2'}>
      <Icon ref={leaf} id="ph:leaf" width={64} height={64} />
    </Rect>,
  );
  yield* waitFor(10);
});
`;

const directTsxBeatId = '40000000-0000-4000-8000-000000000001';
const directVisualIntentIds = [
  'waiting-patient',
  'urgent-patient',
  'treatment-door',
  'urgent-dispatch-path',
  'urgent-moves-first',
] as const;
const directTsxSource = `// pad-semantic:bindings-v1
import {Circle, Layout, Line, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {createRef, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const canvasWidth = view.width();
  const canvasHeight = view.height();
  const safeMarginX = canvasWidth * 0.08;
  const safeMarginY = canvasHeight * 0.07;
  const priorityBlock = createRef<Layout>();

  view.add(
    <Rect key="scene-background" width={canvasWidth} height={canvasHeight} fill="#10231D">
      <Layout key="scene-content-root" width={canvasWidth - safeMarginX * 2} height={canvasHeight - safeMarginY * 2}>
        <Layout key="block-priority-flow" ref={priorityBlock} width={canvasWidth * 0.8} height={canvasHeight * 0.62} opacity={0}>
          <Rect key="priority-flow-card" width={canvasWidth * 0.72} height={canvasHeight * 0.58} radius={canvasWidth * 0.04} fill="#173B31" />
          <Txt key="priority-flow-title" text="Priority flow" y={-canvasHeight * 0.17} width={canvasWidth * 0.62} fontSize={canvasWidth * 0.055} fill="#F7FBF8" fontFamily="Segoe UI, Helvetica Neue, Arial, sans-serif" textAlign="center" />
          <Line key="urgent-dispatch-path" points={[[30, 10], [58, 10]]} lineWidth={6} stroke="#F5C451" endArrow />
          <Line key="urgent-moves-first" points={[[-70, 72], [70, 72]]} lineWidth={5} stroke="#F7FBF8" endArrow />
          <Circle key="waiting-patient" x={-85} y={10} width={42} height={42} fill="#51B68E" />
          <Circle key="urgent-patient" x={0} y={10} width={56} height={56} fill="#F5C451" />
          <Rect key="treatment-door" x={85} y={10} width={54} height={78} radius={8} fill="#51B68E" />
        </Layout>
      </Layout>
    </Rect>,
  );

  // lifecycle:beat:${directTsxBeatId}:enter=block-priority-flow|stay=block-priority-flow|exit=block-priority-flow|primary=block-priority-flow
  yield* waitUntil('beat:${directTsxBeatId}:start');
  const beatDuration = useDuration('beat:${directTsxBeatId}:end');
  const beatEndTime = useThread().time() + beatDuration;
  yield* priorityBlock().opacity(1, Math.min(0.4, beatDuration * 0.12));
  yield* waitFor(Math.max(0, beatEndTime - useThread().time()));
  yield* priorityBlock().opacity(0, Math.min(0.4, beatDuration * 0.1));
});
`;

test('Motion Canvas workspace ghi generation bất biến và kiểm tra TypeScript', async (context) => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-workspace-'),
  );
  context.after(() =>
    rm(projectsDirectory, {recursive: true, force: true}),
  );
  const projectId = 'motion-workspace-test';
  const generationId = randomUUID();
  const outlineIds = [randomUUID(), randomUUID()];
  const beatIds = [randomUUID(), randomUUID()];
  const scenes: MotionCanvasSourceScene[] = outlineIds.map(
    (outlineSectionId, index) => ({
      id: randomUUID(),
      outlineSectionId,
      name: `Scene ${index + 1}`,
      filePath: `src/scenes/0${index + 1}-scene-${index + 1}.tsx`,
      durationSeconds: 10,
      timingEvents: [
        {
          beatId: beatIds[index]!,
          startEvent: `beat:${beatIds[index]}:start`,
          endEvent: `beat:${beatIds[index]}:end`,
          plannedDurationSeconds: 10,
        },
      ],
      source:
        index === 0
          ? source.replace("'#dbe9e2'", "'transparent'")
          : source,
    }),
  );
  const workspace = createMotionCanvasWorkspace(projectsDirectory);
  const staleStagingDirectory = path.join(
    projectsDirectory,
    projectId,
    'motion-canvas',
    'generations',
    `.staging-${randomUUID()}`,
  );
  await mkdir(staleStagingDirectory, {recursive: true});
  const staleTime = new Date(Date.now() - 7 * 60 * 60 * 1_000);
  await utimes(staleStagingDirectory, staleTime, staleTime);

  const prepared = await workspace.prepare(
    projectId,
    generationId,
    scenes,
    {aspectRatio: 'landscape', width: 1920, height: 1080, fps: 24},
  );

  assert.equal(
    prepared.workspacePath,
    `motion-canvas/generations/${generationId}`,
  );
  assert.match(prepared.validation.sourceHash, /^[a-f0-9]{64}$/);
  await assert.rejects(stat(staleStagingDirectory), {code: 'ENOENT'});
  const projectSource = await readFile(
    path.join(
      projectsDirectory,
      projectId,
      prepared.workspacePath,
      prepared.projectFile,
    ),
    'utf8',
  );
  assert.match(projectSource, /makeProject/);
  assert.match(projectSource, /01-scene-1\?scene/);
  const projectMeta = JSON.parse(
    await readFile(
      path.join(
        projectsDirectory,
        projectId,
        prepared.workspacePath,
        'src/project.meta',
      ),
      'utf8',
    ),
  );
  assert.deepEqual(projectMeta.shared.size, {x: 1920, y: 1080});
  assert.equal(projectMeta.preview.fps, 24);
  assert.equal(projectMeta.rendering.fps, 24);
  const sceneMeta = JSON.parse(
    await readFile(
      path.join(
        projectsDirectory,
        projectId,
        prepared.workspacePath,
        scenes[0]!.filePath.replace(/\.tsx$/, '.meta'),
      ),
      'utf8',
    ),
  );
  assert.deepEqual(sceneMeta.timeEvents, [
    {name: `beat:${beatIds[0]}:start`, targetTime: 0},
    {name: `beat:${beatIds[0]}:end`, targetTime: 10},
  ]);

  const bundle: MotionCanvasBundle = {
    status: 'draft',
    contentRevision: 1,
    sourceVoiceVisualContentRevision: 1,
    workspacePath: prepared.workspacePath,
    projectFile: prepared.projectFile,
    width: 1080,
    height: 1920,
    fps: 30,
    scenes: prepared.scenes,
    validation: prepared.validation,
    generation: {
      generationId,
      provider: 'codex',
      model: 'test-model',
      promptVersion: 'motion-canvas-v1',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  };
  const files = await workspace.readFiles(projectId, bundle);
  assert.deepEqual(
    files.map((file) => file.path),
    ['src/project.ts', ...scenes.map((scene) => scene.filePath)],
  );
  assert.match(scenes[0]!.source, /'transparent'/);
  assert.match(files[1]!.source, /'#00000000'|"#00000000"/);
  assert.doesNotMatch(files[1]!.source, /['"]transparent['"]/i);

  await assert.rejects(
    () => workspace.prepare(projectId, generationId, scenes),
    (error) =>
      error instanceof MotionCanvasWorkspaceError &&
      error.code === 'MOTION_CANVAS_WORKSPACE_CONFLICT',
  );

  await assert.rejects(
    () =>
      workspace.prepare(projectId, randomUUID(), [
        {...scenes[0]!, filePath: '../outside.tsx'},
        scenes[1]!,
      ]),
    (error) =>
      error instanceof MotionCanvasWorkspaceError &&
      error.code === 'MOTION_CANVAS_WORKSPACE_INVALID',
  );

  const rendererLockingSource = `import {Line, makeScene2D} from '@motion-canvas/2d';
import {createRef} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const path = createRef<Line>();
  view.add(
    <Line
      ref={path}
      points={[[0, 0], [100, 0]]}
      stroke={'#FFFFFF'}
    />,
  );
  yield* path().points([[0, 0], [50, 50], [100, 0]], 1);
});
`;
  await assert.rejects(
    () =>
      workspace.prepare(projectId, randomUUID(), [
        {...scenes[0]!, source: rendererLockingSource},
      ]),
    (error) =>
      error instanceof MotionCanvasWorkspaceError &&
      error.code === 'MOTION_CANVAS_VALIDATION_FAILED' &&
      /Line\.points/u.test(error.details ?? ''),
  );
});

test('Motion Canvas workspace keeps direct TSX semantic bindings intact through staging', async context => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-direct-tsx-workspace-'),
  );
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const scene: MotionCanvasSourceScene = {
    id: randomUUID(),
    outlineSectionId: randomUUID(),
    name: 'Direct semantic TSX',
    filePath: 'src/scenes/01-direct-semantic.tsx',
    durationSeconds: 4,
    timingEvents: [{
      beatId: directTsxBeatId,
      startEvent: `beat:${directTsxBeatId}:start`,
      endEvent: `beat:${directTsxBeatId}:end`,
      plannedDurationSeconds: 4,
    }],
    source: directTsxSource,
  };
  const originalScene = structuredClone(scene);
  const prepared = await createMotionCanvasWorkspace(projectsDirectory).prepare(
    'direct-tsx-workspace',
    randomUUID(),
    [scene],
    {aspectRatio: 'landscape', width: 640, height: 360, fps: 24},
  );

  assert.deepEqual(scene, originalScene);
  assert.equal(prepared.sourceScenes[0]?.source, directTsxSource);
  assert.match(prepared.validation.sourceHash, /^[a-f0-9]{64}$/);
  const stagedSource = await readFile(
    path.join(
      prepared.workspaceDirectory,
      'src/scenes/01-direct-semantic.tsx',
    ),
    'utf8',
  );
  assert.equal(stagedSource, directTsxSource);
  assert.match(stagedSource, /^\/\/ pad-semantic:bindings-v1/u);
  assert.match(stagedSource, /key="scene-background"/u);
  assert.match(stagedSource, /key="scene-content-root"/u);
  for (const intentId of directVisualIntentIds) {
    assert.match(stagedSource, new RegExp(`key="${intentId}"`, 'u'));
  }
  assert.match(stagedSource, /waitUntil\('beat:40000000-0000-4000-8000-000000000001:start'\)/u);
  assert.match(stagedSource, /useDuration\('beat:40000000-0000-4000-8000-000000000001:end'\)/u);
  assert.match(stagedSource, /const beatEndTime = useThread\(\).time\(\) \+ beatDuration/u);
  assert.match(stagedSource, /waitFor\(Math\.max\(0, beatEndTime - useThread\(\).time\(\)\)\)/u);
  assert.match(stagedSource, /lifecycle:beat:40000000-0000-4000-8000-000000000001:/u);
  assert.doesNotMatch(
    stagedSource,
    /pad-scene-spec-v[123]|pad-semantic:unverified-fallback|compileMotionCanvasSceneSpec|Scene Spec/u,
  );
});

test('Motion Canvas workspace keeps bounded failure evidence after cleanup', async context => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-failure-evidence-'),
  );
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const workspace = createMotionCanvasWorkspace(projectsDirectory);
  assert.ok(workspace.recordFailure);
  assert.ok(workspace.readLatestFailure);
  assert.ok(workspace.readFailureScenes);
  assert.ok(workspace.readFailureCheckpoint);
  const generationId = randomUUID();
  const beatId = randomUUID();
  const failedScene: MotionCanvasSourceScene = {
    id: randomUUID(),
    outlineSectionId: randomUUID(),
    name: 'Failed priority scene',
    filePath: 'src/scenes/01-failed-priority.tsx',
    durationSeconds: 10,
    timingEvents: [{
      beatId,
      startEvent: `beat:${beatId}:start`,
      endEvent: `beat:${beatId}:end`,
      plannedDurationSeconds: 10,
    }],
    source: 'export default null;',
  };
  const visualEvidence: MotionCanvasVisualEvidence = {
    sceneId: failedScene.id,
    beatId,
    phase: 'middle',
    frame: 20,
    timeSeconds: 2,
    png: Buffer.from('png-evidence'),
    issues: [{
      code: 'content-occluded',
      sceneId: failedScene.id,
      beatId,
      timeSeconds: 2,
      semanticKey: 'overlay-panel>important-label',
      bounds: {x: 20, y: 20, width: 10, height: 10},
      reason: 'Overlay covers the label.',
    }],
    nodes: [{
      key: 'overlay-panel',
      kind: 'other',
      bounds: {x: 20, y: 20, width: 10, height: 10},
    }],
  };

  const evidenceDirectory = await workspace.recordFailure(
    'failure-evidence-project',
    generationId,
    {
      stage: 'render-quality',
      code: 'MOTION_CANVAS_VISUAL_QUALITY_FAILED',
      message: 'Pre-exit frame is empty.',
      sourceVoiceVisualContentRevision: 7,
      issues: [{code: 'empty-frame', reason: 'Pre-exit frame is empty.'}],
      failedSceneIds: [failedScene.id],
      recoveryGuidance: 'Keep the primary visual visible until the exit window.',
      rootCause: {
        reason: 'turn_failed',
        code: 'CODEX_TURN_FAILED',
        operation: 'turn/completed',
        message: 'Codex turn failed.',
        providerMessage: 'The provider refused this turn.',
        providerCode: 'provider_failed',
        appServer: {
          exitCode: 1,
          signal: null,
          commandBasename: 'node.exe',
          entrypointBasename: 'codex.js',
          cliVersion: '1.2.3',
          method: 'initialize',
          pendingMethods: ['initialize'],
          stderr: 'authorization=[REDACTED_SECRET]',
        },
      },
      attempts: [{
        phase: 'initial',
        model: 'scene-model',
        reasoningEffort: 'medium',
        error: {
          code: 'CODEX_TURN_FAILED',
          reason: 'turn_failed',
          operation: 'turn/completed',
          message: 'Codex turn failed.',
          providerMessage: 'The provider refused this turn.',
          providerCode: 'provider_failed',
          diagnostics: 'Codex failure reason: turn_failed',
          appServer: {
            exitCode: 1,
            signal: null,
            commandBasename: 'node.exe',
            entrypointBasename: 'codex.js',
            cliVersion: '1.2.3',
            method: 'initialize',
            pendingMethods: ['initialize'],
            stderr: 'authorization=[REDACTED_SECRET]',
          },
        },
        sourceHash: 'a'.repeat(64),
        sourceLength: 0,
        sourceExcerpt: '',
      }],
      visualEvidence: [visualEvidence],
      scenes: [failedScene],
    },
  );
  await workspace.discard('failure-evidence-project', generationId);

  const record = JSON.parse(
    await readFile(path.join(evidenceDirectory, 'failure.json'), 'utf8'),
  ) as {
    code: string;
    scenes: Array<{id: string}>;
    rootCause: {
      reason: string;
      code: string;
      operation: string | null;
      message: string;
      providerMessage: string | null;
      appServer: {exitCode: number | null; method: string | null; stderr: string | null} | null;
    };
    attempts: Array<{phase: string; error: {reason: string; providerMessage: string | null; appServer: {exitCode: number | null; method: string | null; stderr: string | null} | null}}>;
  };
  assert.equal(record.code, 'MOTION_CANVAS_VISUAL_QUALITY_FAILED');
  assert.equal(record.scenes[0]?.id, failedScene.id);
  assert.equal(record.rootCause.reason, 'turn_failed');
  assert.equal(record.rootCause.code, 'CODEX_TURN_FAILED');
  assert.equal(record.rootCause.operation, 'turn/completed');
  assert.equal(record.rootCause.message, 'Codex turn failed.');
  assert.equal(record.rootCause.providerMessage, 'The provider refused this turn.');
  assert.equal(record.rootCause.appServer?.exitCode, 1);
  assert.equal(record.rootCause.appServer?.method, 'initialize');
  assert.equal(record.rootCause.appServer?.stderr, 'authorization=[REDACTED_SECRET]');
  assert.equal(record.attempts.length, 1);
  assert.equal(record.attempts[0]?.phase, 'initial');
  assert.equal(record.attempts[0]?.error.reason, 'turn_failed');
  assert.equal(record.attempts[0]?.error.providerMessage, 'The provider refused this turn.');
  assert.equal(record.attempts[0]?.error.appServer?.exitCode, 1);
  assert.equal(record.attempts[0]?.error.appServer?.method, 'initialize');
  const manifest = JSON.parse(
    await readFile(path.join(evidenceDirectory, 'frames', 'manifest.json'), 'utf8'),
  ) as {frames: Array<{file: string; sceneId: string; beatId: string; phase: string; frame: number; issueCodes: string[]}>};
  assert.equal(manifest.frames.length, 1);
  assert.equal(
    manifest.frames[0]?.file,
    `frames/01-${failedScene.id}-${beatId}-middle-20.png`,
  );
  assert.equal(manifest.frames[0]?.sceneId, failedScene.id);
  assert.equal(manifest.frames[0]?.beatId, beatId);
  assert.equal(manifest.frames[0]?.phase, 'middle');
  assert.equal(manifest.frames[0]?.frame, 20);
  assert.deepEqual(manifest.frames[0]?.issueCodes, ['content-occluded']);
  assert.equal(
    await readFile(
      path.join(evidenceDirectory, 'frames', `01-${failedScene.id}-${beatId}-middle-20.png`),
      'utf8',
    ),
    'png-evidence',
  );
  const failureSummary = await workspace.readLatestFailure(
    'failure-evidence-project',
  );
  assert.equal(failureSummary?.generationId, generationId);
  assert.equal(failureSummary?.stage, 'render-quality');
  assert.equal(failureSummary?.code, 'MOTION_CANVAS_VISUAL_QUALITY_FAILED');
  assert.equal(failureSummary?.message, 'Pre-exit frame is empty.');
  assert.equal(failureSummary?.firstIssueReason, 'Pre-exit frame is empty.');
  assert.equal(failureSummary?.rootCause?.reason, 'turn_failed');
  assert.equal(failureSummary?.rootCause?.operation, 'turn/completed');
  assert.equal(
    failureSummary?.recoveryGuidance,
    'Keep the primary visual visible until the exit window.',
  );
  assert.equal(
    await readFile(
      path.join(evidenceDirectory, 'scenes', `01-${failedScene.id}.tsx`),
      'utf8',
    ),
    failedScene.source,
  );
  const checkpoint = await workspace.readFailureCheckpoint(
    'failure-evidence-project',
    generationId,
  );
  assert.deepEqual(checkpoint?.failedSceneIds, [failedScene.id]);
  assert.equal(checkpoint?.sourceVoiceVisualContentRevision, 7);
  assert.equal(checkpoint?.scenes[0]?.source, failedScene.source);
  const resumedScenes = await workspace.readFailureScenes(
    'failure-evidence-project',
    generationId,
  );
  assert.equal(resumedScenes?.[0]?.id, failedScene.id);
  assert.equal(resumedScenes?.[0]?.source, failedScene.source);
});

test('legacy timeline mismatch checkpoints replace stale scene attribution on recovery', async context => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-motion-legacy-timeline-checkpoint-'),
  );
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const workspace = createMotionCanvasWorkspace(projectsDirectory);
  const generationId = randomUUID();
  const staleBeatId = randomUUID();
  const runtimeBeatId = randomUUID();
  const staleScene: MotionCanvasSourceScene = {
    id: randomUUID(),
    outlineSectionId: randomUUID(),
    name: 'Opening',
    filePath: 'src/scenes/01-opening.tsx',
    durationSeconds: 4,
    timingEvents: [{beatId: staleBeatId, startEvent: `beat:${staleBeatId}:start`, endEvent: `beat:${staleBeatId}:end`, plannedDurationSeconds: 4}],
    source: 'stale-source',
  };
  const runtimeScene: MotionCanvasSourceScene = {
    id: randomUUID(),
    outlineSectionId: randomUUID(),
    name: 'Emergency room',
    filePath: 'src/scenes/02-emergency-room.tsx',
    durationSeconds: 4,
    timingEvents: [{beatId: runtimeBeatId, startEvent: `beat:${runtimeBeatId}:start`, endEvent: `beat:${runtimeBeatId}:end`, plannedDurationSeconds: 4}],
    source: 'runtime-source',
  };
  await workspace.recordFailure!('legacy-timeline-project', generationId, {
    stage: 'render-quality',
    code: 'MOTION_CANVAS_VISUAL_QUALITY_FAILED',
    message: 'Motion Canvas frame renderer failed.',
    issues: [{
      sceneId: staleScene.id,
      reason: 'Quality sample sample-id rendered scene 02-emergency-room, expected 03-next-scene.',
    }],
    // This is the incorrect attribution written by the old renderer wrapper.
    failedSceneIds: [staleScene.id],
    scenes: [staleScene, runtimeScene],
  });

  const checkpoint = await workspace.readFailureCheckpoint!('legacy-timeline-project', generationId);
  assert.deepEqual(checkpoint?.failedSceneIds, [runtimeScene.id]);
});
