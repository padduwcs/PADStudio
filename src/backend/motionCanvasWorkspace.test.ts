import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {MotionCanvasBundle} from '../shared/topic.ts';
import type {MotionCanvasSourceScene} from './motionCanvasGenerator.ts';
import {
  createMotionCanvasWorkspace,
  MotionCanvasWorkspaceError,
} from './motionCanvasWorkspace.ts';

const source = `import {makeScene2D, Rect} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(<Rect width={720} height={120} radius={24} fill={'#dbe9e2'} />);
  yield* waitFor(10);
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
      source,
    }),
  );
  const workspace = createMotionCanvasWorkspace(projectsDirectory);

  const prepared = await workspace.prepare(
    projectId,
    generationId,
    scenes,
  );

  assert.equal(
    prepared.workspacePath,
    `motion-canvas/generations/${generationId}`,
  );
  assert.match(prepared.validation.sourceHash, /^[a-f0-9]{64}$/);
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
});
