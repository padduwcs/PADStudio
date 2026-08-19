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
