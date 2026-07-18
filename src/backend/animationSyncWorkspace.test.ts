import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  AnimationSyncBundle,
  MotionCanvasBundle,
  VoiceBundle,
} from '../shared/topic.ts';
import {AnimationSyncBundleSchema} from '../shared/topic.ts';
import {
  AnimationSyncWorkspaceError,
  createAnimationSyncWorkspace,
} from './animationSyncWorkspace.ts';
import {createAnimationSyncPreviewService} from './animationSyncPreviewService.ts';

function wavSilence(durationSeconds: number, sampleRate = 16_000) {
  const samples = Math.round(durationSeconds * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function sceneSource(beatId: string) {
  return `import {makeScene2D, Rect} from '@motion-canvas/2d';
import {createRef, useDuration, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const card = createRef<Rect>();
  view.add(<Rect key={String(0)} ref={card} width={120} height={120} fill={'#dbe9e2'} />);
  yield* waitUntil('beat:${beatId}:start');
  const beatDuration = useDuration('beat:${beatId}:end');
  yield* card().width(720, beatDuration);
  yield* waitUntil('beat:${beatId}:end');
});
`;
}

test('Animation sync tạo track WAV và time-event theo voice thật', async (context) => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-sync-workspace-'),
  );
  context.after(() =>
    rm(projectsDirectory, {recursive: true, force: true}),
  );

  const projectId = 'animation-sync-test';
  const projectDirectory = path.join(projectsDirectory, projectId);
  const motionGenerationId = randomUUID();
  const voiceGenerationId = randomUUID();
  const syncGenerationId = randomUUID();
  const motionWorkspacePath =
    `motion-canvas/generations/${motionGenerationId}` as const;
  const voiceWorkspacePath =
    `voice/generations/${voiceGenerationId}` as const;
  const outlineIds = [randomUUID(), randomUUID()];
  const beatIds = [randomUUID(), randomUUID()];
  const voiceDurations = [0.5, 0.75];
  const sceneIds = [randomUUID(), randomUUID()];

  const scenes = outlineIds.map((outlineSectionId, index) => ({
    id: sceneIds[index]!,
    outlineSectionId,
    name: `Scene ${index + 1}`,
    filePath: `src/scenes/0${index + 1}-scene-${index + 1}.tsx` as const,
    durationSeconds: 4,
    timingEvents: [
      {
        beatId: beatIds[index]!,
        startEvent: `beat:${beatIds[index]}:start`,
        endEvent: `beat:${beatIds[index]}:end`,
        plannedDurationSeconds: 4,
      },
    ],
  }));
  for (const [index, scene] of scenes.entries()) {
    const destination = path.join(
      projectDirectory,
      motionWorkspacePath,
      scene.filePath,
    );
    await mkdir(path.dirname(destination), {recursive: true});
    await writeFile(destination, sceneSource(beatIds[index]!), 'utf8');
  }

  const voiceSections = outlineIds.map((outlineSectionId, index) => {
    const audioPath =
      `audio/0${index + 1}-${outlineSectionId}.wav` as const;
    return {
      outlineSectionId,
      audioPath,
      alignmentPath:
        `alignments/0${index + 1}-${outlineSectionId}.json` as const,
      durationSeconds: voiceDurations[index]!,
      characterCost: 10,
      requestId: `request-${index + 1}`,
      sourceTextHash: 'a'.repeat(64),
      beats: [
        {
          beatId: beatIds[index]!,
          textStartIndex: 0,
          textEndIndex: 10,
          startSeconds: 0,
          endSeconds: voiceDurations[index]!,
        },
      ],
    };
  });
  for (const [index, section] of voiceSections.entries()) {
    const destination = path.join(
      projectDirectory,
      voiceWorkspacePath,
      section.audioPath,
    );
    await mkdir(path.dirname(destination), {recursive: true});
    await writeFile(destination, wavSilence(voiceDurations[index]!));
  }

  const motionBundle: MotionCanvasBundle = {
    status: 'approved',
    contentRevision: 2,
    sourceVoiceVisualContentRevision: 3,
    workspacePath: motionWorkspacePath,
    projectFile: 'src/project.ts',
    width: 1080,
    height: 1920,
    fps: 30,
    timingContractVersion: 1,
    scenes,
    validation: {
      validatedAt: new Date().toISOString(),
      sourceHash: 'b'.repeat(64),
      motionCanvasVersion: '3.17.2',
    },
    generation: {
      generationId: motionGenerationId,
      provider: 'codex',
      model: 'test-model',
      promptVersion: 'motion-canvas-v3',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  };
  const voiceBundle: VoiceBundle = {
    status: 'approved',
    contentRevision: 4,
    sourceVoiceVisualContentRevision: 3,
    workspacePath: voiceWorkspacePath,
    configuration: {
      voiceId: 'voice-test',
      voiceName: 'Giọng thử',
      voiceCategory: 'premade',
      modelId: 'eleven_multilingual_v2',
      modelName: 'Multilingual v2',
      languageCode: 'vi',
      outputFormat: 'mp3_44100_128',
      settings: {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        useSpeakerBoost: true,
        speed: 1,
      },
      seed: null,
    },
    sections: voiceSections,
    totalDurationSeconds: 1.25,
    generation: {
      generationId: voiceGenerationId,
      provider: 'elevenlabs',
      generatedAt: new Date().toISOString(),
      characterCost: 20,
      requestIds: ['request-1', 'request-2'],
    },
  };

  const workspace = createAnimationSyncWorkspace(projectsDirectory);
  const prepared = await workspace.prepare(
    projectId,
    syncGenerationId,
    motionBundle,
    voiceBundle,
  );

  assert.equal(
    prepared.workspacePath,
    `sync/generations/${syncGenerationId}`,
  );
  assert.equal(prepared.totalDurationSeconds, 1.25);
  assert.ok(
    Math.abs(prepared.validation.audioDurationSeconds - 1.25) < 0.01,
  );
  assert.equal(prepared.sections[0]?.driftSeconds, -3.5);
  assert.equal(
    prepared.sections[1]?.beats[0]?.synchronizedDurationSeconds,
    0.75,
  );

  const workspaceDirectory = path.join(
    projectDirectory,
    prepared.workspacePath,
  );
  const projectSource = await readFile(
    path.join(workspaceDirectory, prepared.projectFile),
    'utf8',
  );
  assert.match(projectSource, /import narration from '\.\.\/audio\/narration\.wav'/);
  assert.match(projectSource, /audio: narration/);
  const firstSceneSource = await readFile(
    path.join(workspaceDirectory, scenes[0]!.filePath),
    'utf8',
  );
  assert.match(
    firstSceneSource,
    new RegExp(`useDuration\\('beat:${beatIds[0]}:end'\\)`),
  );
  assert.doesNotMatch(
    firstSceneSource,
    new RegExp(`waitUntil\\('beat:${beatIds[0]}:end'\\)`),
  );
  assert.match(firstSceneSource, /padSyncWaitFor\(Math\.max\(0,/);
  assert.match(firstSceneSource, /key=\{\('pad-sync-1-'/);
  const firstSceneMeta = JSON.parse(
    await readFile(
      path.join(
        workspaceDirectory,
        scenes[0]!.filePath.replace(/\.tsx$/, '.meta'),
      ),
      'utf8',
    ),
  );
  assert.deepEqual(firstSceneMeta.timeEvents, [
    {name: `beat:${beatIds[0]}:start`, targetTime: 0},
    {name: `beat:${beatIds[0]}:end`, targetTime: 0.5},
  ]);

  const syncBundle: AnimationSyncBundle = {
    status: 'draft',
    contentRevision: 1,
    sourceMotionCanvasContentRevision: motionBundle.contentRevision,
    sourceVoiceContentRevision: voiceBundle.contentRevision,
    workspacePath: prepared.workspacePath,
    projectFile: prepared.projectFile,
    audioFile: prepared.audioFile,
    totalDurationSeconds: prepared.totalDurationSeconds,
    sections: prepared.sections,
    validation: prepared.validation,
    generation: {
      generationId: syncGenerationId,
      provider: 'local',
      tool: 'ffmpeg',
      generatedAt: new Date().toISOString(),
    },
  };
  assert.equal(AnimationSyncBundleSchema.safeParse(syncBundle).success, true);
  assert.equal(
    AnimationSyncBundleSchema.safeParse({
      ...syncBundle,
      sections: syncBundle.sections.map((section, index) =>
        index === 0
          ? {...section, driftSeconds: section.driftSeconds + 1}
          : section,
      ),
    }).success,
    false,
  );

  const previewService = createAnimationSyncPreviewService(
    projectsDirectory,
    {maximumActivePreviews: 1},
  );
  try {
    const preview = await previewService.start(projectId, syncBundle);
    assert.equal(preview.generationId, syncGenerationId);
    const previewResponse = await fetch(preview.url);
    const previewHtml = await previewResponse.text();
    assert.equal(previewResponse.status, 200);
    assert.match(previewHtml, /PAD Studio · Bản nháp đồng bộ/);
    const editorModuleResponse = await fetch(
      new URL('/@id/__x00__virtual:editor', preview.url),
    );
    const editorModule = await editorModuleResponse.text();
    assert.equal(editorModuleResponse.status, 200, editorModule);
    assert.match(editorModule, /\?project/);
    assert.equal(
      (await previewService.start(projectId, syncBundle)).url,
      preview.url,
    );
  } finally {
    await previewService.close();
  }

  const files = await workspace.readFiles(projectId, syncBundle);
  assert.deepEqual(
    files.map((file) => file.path),
    ['src/project.ts', ...scenes.map((scene) => scene.filePath)],
  );
  const audio = await workspace.readAudio(projectId, syncBundle);
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');

  await assert.rejects(
    () =>
      workspace.prepare(
        projectId,
        syncGenerationId,
        motionBundle,
        voiceBundle,
      ),
    (error) =>
      error instanceof AnimationSyncWorkspaceError &&
      error.code === 'ANIMATION_SYNC_WORKSPACE_CONFLICT',
  );
});

test('Animation sync chặn scene legacy thiếu timing contract', async () => {
  const workspace = createAnimationSyncWorkspace(
    path.join(os.tmpdir(), `pad-sync-${randomUUID()}`),
  );
  await assert.rejects(
    () =>
      workspace.prepare(
        'legacy-sync-test',
        randomUUID(),
        {
          timingContractVersion: undefined,
          scenes: [],
        } as unknown as MotionCanvasBundle,
        {sections: []} as unknown as VoiceBundle,
      ),
    (error) =>
      error instanceof AnimationSyncWorkspaceError &&
      error.code === 'ANIMATION_SYNC_TIMING_CONTRACT_REQUIRED',
  );
});
