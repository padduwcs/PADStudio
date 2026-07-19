import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
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
import {
  LayoutBundleSchema,
  type LayoutBundle,
  type LayoutEditorManifest,
  type LayoutNodeOverride,
} from '../shared/layout.ts';
import type {AnimationSyncBundle} from '../shared/topic.ts';
import {
  LayoutPreviewError,
  createLayoutPreviewService,
} from './layoutPreviewService.ts';
import {
  LayoutWorkspaceError,
  animationSyncWorkspaceSourceHash,
  createLayoutWorkspace,
} from './layoutWorkspace.ts';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

function wavSilence(durationSeconds: number, sampleRate = 48_000) {
  const samples = Math.round(durationSeconds * sampleRate);
  const dataSize = samples * 2 * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function sceneSource(key: string) {
  return `import {makeScene2D, Rect} from '@motion-canvas/2d';

export default makeScene2D(function* (view) {
  view.add(
    <Rect
      key="${key}"
      width={300}
      height={180}
      fill="#dbe9e2"
    />,
  );
});
`;
}

interface Fixture {
  projectsDirectory: string;
  projectId: string;
  projectDirectory: string;
  syncBundle: AnimationSyncBundle;
  manifest: LayoutEditorManifest;
  overrides: LayoutNodeOverride[];
}

async function createFixture(): Promise<Fixture> {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-layout-workspace-'),
  );
  const projectId = 'layout-workspace-test';
  const projectDirectory = path.join(projectsDirectory, projectId);
  const syncGenerationId = randomUUID();
  const workspacePath =
    `sync/generations/${syncGenerationId}` as const;
  const syncDirectory = path.join(projectDirectory, workspacePath);
  const sceneIds = [randomUUID(), randomUUID()];
  const outlineIds = [randomUUID(), randomUUID()];
  const beatIds = [randomUUID(), randomUUID()];
  const sourceMotionCanvasGenerationId = randomUUID();
  const sourceVoiceGenerationId = randomUUID();
  let sourceHash = '0'.repeat(64);
  const filePaths = [
    'src/scenes/01-layout-scene.tsx',
    'src/scenes/02-layout-scene.tsx',
  ] as const;

  await mkdir(path.join(syncDirectory, 'src', 'scenes'), {
    recursive: true,
  });
  await mkdir(path.join(syncDirectory, 'audio'), {recursive: true});
  await Promise.all([
    writeFile(
      path.join(syncDirectory, filePaths[0]),
      sceneSource('semantic-card'),
      'utf8',
    ),
    writeFile(
      path.join(syncDirectory, filePaths[1]),
      sceneSource('semantic-label'),
      'utf8',
    ),
    writeFile(
      path.join(syncDirectory, 'src/project.ts'),
      `import {makeProject} from '@motion-canvas/core';
import narration from '../audio/narration.wav';
import scene01 from './scenes/01-layout-scene?scene';
import scene02 from './scenes/02-layout-scene?scene';

export default makeProject({
  scenes: [scene01, scene02],
  audio: narration,
});
`,
      'utf8',
    ),
    writeFile(
      path.join(syncDirectory, 'src/project.meta'),
      `${JSON.stringify({
        version: 1,
        shared: {
          background: 'rgb(17,31,27)',
          range: [0, null],
          size: {x: 1080, y: 1920},
          audioOffset: 0,
        },
        preview: {fps: 30, resolutionScale: 0.5},
        rendering: {
          fps: 30,
          resolutionScale: 1,
          colorSpace: 'srgb',
          fileType: 'image/png',
          quality: 1,
        },
      })}\n`,
      'utf8',
    ),
    writeFile(
      path.join(syncDirectory, 'src/motion-canvas.d.ts'),
      `declare module '*?scene' {
  const value: import('@motion-canvas/core/lib/scenes/Scene').FullSceneDescription;
  export = value;
}

declare module '*.wav' {
  const source: string;
  export default source;
}

declare type Callback = (...args: any[]) => void;
`,
      'utf8',
    ),
    writeFile(
      path.join(syncDirectory, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            jsx: 'react-jsx',
            jsxImportSource: '@motion-canvas/2d/lib',
          },
          include: ['src'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    ...filePaths.map((filePath) =>
      writeFile(
        path.join(syncDirectory, filePath.replace(/\.tsx$/, '.meta')),
        '{"version":0,"timeEvents":[],"seed":1}\n',
        'utf8',
      ),
    ),
    writeFile(
      path.join(syncDirectory, 'audio/narration.wav'),
      wavSilence(8),
    ),
  ]);

  const sections = sceneIds.map((sceneId, index) => ({
    outlineSectionId: outlineIds[index]!,
    sceneId,
    filePath: filePaths[index]!,
    plannedDurationSeconds: 4,
    synchronizedDurationSeconds: 4,
    driftSeconds: 0,
    beats: [
      {
        beatId: beatIds[index]!,
        startEvent: `beat:${beatIds[index]}:start`,
        endEvent: `beat:${beatIds[index]}:end`,
        plannedDurationSeconds: 4,
        voiceStartSeconds: 0,
        voiceEndSeconds: 4,
        synchronizedDurationSeconds: 4,
      },
    ],
  }));
  const syncBundle: AnimationSyncBundle = {
    status: 'approved',
    contentRevision: 3,
    sourceMotionCanvasContentRevision: 2,
    sourceVoiceContentRevision: 4,
    workspacePath,
    projectFile: 'src/project.ts',
    audioFile: 'audio/narration.wav',
    totalDurationSeconds: 8,
    sections,
    validation: {
      validatedAt: new Date().toISOString(),
      sourceHash,
      motionCanvasVersion: '3.17.2',
      audioDurationSeconds: 8,
    },
    generation: {
      generationId: syncGenerationId,
      provider: 'local',
      tool: 'ffmpeg',
      generatedAt: new Date().toISOString(),
    },
  };
  sourceHash = await animationSyncWorkspaceSourceHash(
    syncDirectory,
    syncBundle,
  );
  syncBundle.validation.sourceHash = sourceHash;
  await writeFile(
    path.join(syncDirectory, 'pad-studio.manifest.json'),
    `${JSON.stringify(
      {
        version: 2,
        generationId: syncGenerationId,
        motionCanvasVersion: '3.17.2',
        sourceHash,
        audioDurationSeconds: 8,
        sourceMotionCanvasGenerationId,
        sourceVoiceGenerationId,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const nodeFingerprints = [
    sha256('semantic-card'),
    sha256('semantic-label'),
  ];
  const manifest: LayoutEditorManifest = {
    version: 1,
    sourceAnimationSyncGenerationId: syncGenerationId,
    sourceAnimationSyncContentRevision: syncBundle.contentRevision,
    sourceAnimationSyncSourceHash: sourceHash,
    scenes: sections.map((section, index) => ({
      sceneId: section.sceneId,
      filePath: section.filePath,
      nodes: [
        {
          key:
            index === 0
              ? 'semantic-card'
              : 'Scene/Rect[1]',
          fingerprint: nodeFingerprints[index]!,
          label: index === 0 ? 'Thẻ nội dung' : 'Nhãn nội dung',
          nodeType: 'Rect',
          parentKey: null,
          identity: index === 0 ? 'semantic' : 'legacy',
          editableProperties: [
            'x',
            'y',
            'scale',
            'rotation',
            'opacity',
            'hidden',
            'fill',
            'stroke',
            'strokeWidth',
            'zIndexDelta',
          ],
          lockedProperties: [],
          lockReason: null,
        },
      ],
    })),
  };
  const overrides: LayoutNodeOverride[] = [
    {
      sceneId: sceneIds[0]!,
      nodeKey: 'semantic-card',
      nodeFingerprint: nodeFingerprints[0]!,
      patch: {
        x: 28,
        fill: '#ABCDEF',
        hidden: true,
        editorLocked: true,
      },
    },
  ];

  return {
    projectsDirectory,
    projectId,
    projectDirectory,
    syncBundle,
    manifest,
    overrides,
  };
}

function layoutBundle(
  generationId: string,
  syncBundle: AnimationSyncBundle,
  prepared: Awaited<
    ReturnType<ReturnType<typeof createLayoutWorkspace>['prepare']>
  >,
): LayoutBundle {
  return {
    status: 'draft',
    contentRevision: 1,
    sourceAnimationSyncContentRevision: syncBundle.contentRevision,
    sourceAnimationSyncGenerationId:
      syncBundle.generation.generationId,
    sourceAnimationSyncSourceHash: syncBundle.validation.sourceHash,
    workspacePath: prepared.workspacePath,
    sourceWorkspacePath: prepared.sourceWorkspacePath,
    projectFile: prepared.projectFile,
    audioFile: prepared.audioFile,
    overridesFile: prepared.overridesFile,
    manifestFile: prepared.manifestFile,
    overrideContractVersion: prepared.overrideContractVersion,
    totalDurationSeconds: prepared.totalDurationSeconds,
    scenes: prepared.scenes,
    validation: prepared.validation,
    generation: {
      generationId,
      provider: 'local',
      tool: 'layout-editor',
      generatedAt: new Date().toISOString(),
    },
  };
}

test('Layout workspace ghi overlay bất biến, canonical và retry idempotent', async (context) => {
  const fixture = await createFixture();
  context.after(() =>
    rm(fixture.projectsDirectory, {recursive: true, force: true}),
  );

  const generationId = randomUUID();
  const workspace = createLayoutWorkspace(fixture.projectsDirectory);
  const prepared = await workspace.prepare(
    fixture.projectId,
    generationId,
    fixture.syncBundle,
    fixture.overrides,
    fixture.manifest,
  );
  assert.equal(
    prepared.workspacePath,
    `layout/generations/${generationId}`,
  );
  assert.equal(
    prepared.sourceWorkspacePath,
    fixture.syncBundle.workspacePath,
  );
  assert.equal(prepared.scenes[0]?.editableNodeCount, 1);
  assert.equal(prepared.scenes[0]?.overrideCount, 1);
  assert.equal(prepared.scenes[1]?.overrideCount, 0);

  const bundle = layoutBundle(
    generationId,
    fixture.syncBundle,
    prepared,
  );
  assert.equal(LayoutBundleSchema.safeParse(bundle).success, true);

  await assert.rejects(
    () =>
      workspace.prepare(
        fixture.projectId,
        randomUUID(),
        fixture.syncBundle,
        fixture.overrides,
        fixture.manifest,
        null,
        '0'.repeat(64),
      ),
    (error) =>
      error instanceof LayoutWorkspaceError &&
      error.code === 'LAYOUT_SOURCE_MANIFEST_MISMATCH',
  );

  const files = await workspace.readFiles(fixture.projectId, bundle);
  assert.deepEqual(
    files.map((file) => file.path),
    [
      'overrides.json',
      'editor-manifest.json',
      'pad-studio.manifest.json',
    ],
  );
  const storedOverrides = await workspace.readOverrides(
    fixture.projectId,
    bundle,
  );
  assert.deepEqual(storedOverrides.overrides, fixture.overrides);
  const storedManifest = await workspace.readEditorManifest(
    fixture.projectId,
    bundle,
  );
  assert.deepEqual(
    storedManifest.scenes.map((scene) => scene.sceneId),
    fixture.syncBundle.sections.map((section) => section.sceneId),
  );

  const syncManifestPath = path.join(
    fixture.projectDirectory,
    fixture.syncBundle.workspacePath,
    'pad-studio.manifest.json',
  );
  const syncManifestSource = await readFile(syncManifestPath, 'utf8');
  const legacySyncManifest = {
    ...JSON.parse(syncManifestSource),
    version: 1,
  };
  const syncScenePath = path.join(
    fixture.projectDirectory,
    fixture.syncBundle.workspacePath,
    fixture.syncBundle.sections[0]!.filePath,
  );
  const syncSceneSource = await readFile(syncScenePath, 'utf8');
  await writeFile(
    syncManifestPath,
    `${JSON.stringify(legacySyncManifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    syncScenePath,
    syncSceneSource.replace('#dbe9e2', '#ffffff'),
    'utf8',
  );
  await assert.rejects(
    () =>
      workspace.verify(
        fixture.projectId,
        fixture.syncBundle,
        bundle,
      ),
    (error) =>
      error instanceof LayoutWorkspaceError &&
      error.code === 'LAYOUT_SOURCE_MANIFEST_MISMATCH',
  );
  await writeFile(syncScenePath, syncSceneSource, 'utf8');
  await writeFile(syncManifestPath, syncManifestSource, 'utf8');

  const retry = await workspace.prepare(
    fixture.projectId,
    generationId,
    fixture.syncBundle,
    [...fixture.overrides].reverse(),
    fixture.manifest,
  );
  assert.deepEqual(retry, prepared);

  await assert.rejects(
    () =>
      workspace.prepare(
        fixture.projectId,
        generationId,
        fixture.syncBundle,
        fixture.overrides,
        fixture.manifest,
        randomUUID(),
      ),
    (error) =>
      error instanceof LayoutWorkspaceError &&
      error.code === 'LAYOUT_WORKSPACE_CONFLICT',
  );

  await assert.rejects(
    () =>
      workspace.prepare(
        fixture.projectId,
        generationId,
        fixture.syncBundle,
        [
          {
            ...fixture.overrides[0]!,
            patch: {x: 99},
          },
        ],
        fixture.manifest,
      ),
    (error) =>
      error instanceof LayoutWorkspaceError &&
      error.code === 'LAYOUT_WORKSPACE_CONFLICT',
  );

  const workspaceManifestPath = path.join(
    fixture.projectDirectory,
    bundle.workspacePath,
    'pad-studio.manifest.json',
  );
  const workspaceManifestSource = await readFile(
    workspaceManifestPath,
    'utf8',
  );
  const invalidWorkspaceManifest = {
    ...JSON.parse(workspaceManifestSource),
    totalDurationSeconds: -1,
  };
  await writeFile(
    workspaceManifestPath,
    `${JSON.stringify(invalidWorkspaceManifest, null, 2)}\n`,
    'utf8',
  );
  await assert.rejects(
    () =>
      workspace.prepare(
        fixture.projectId,
        generationId,
        fixture.syncBundle,
        fixture.overrides,
        fixture.manifest,
      ),
    (error) =>
      error instanceof LayoutWorkspaceError &&
      error.code === 'LAYOUT_WORKSPACE_INVALID',
  );
  await writeFile(
    workspaceManifestPath,
    workspaceManifestSource,
    'utf8',
  );

  const overridesPath = path.join(
    fixture.projectDirectory,
    bundle.workspacePath,
    bundle.overridesFile,
  );
  const original = await readFile(overridesPath, 'utf8');
  await writeFile(
    overridesPath,
    original.replace('"x": 28', '"x": 29'),
    'utf8',
  );
  await assert.rejects(
    () => workspace.readFiles(fixture.projectId, bundle),
    (error) =>
      error instanceof LayoutWorkspaceError &&
      error.code === 'LAYOUT_WORKSPACE_INTEGRITY_FAILED',
  );

  const previewService = createLayoutPreviewService(
    fixture.projectsDirectory,
    {maximumActivePreviews: 1},
  );
  context.after(() => previewService.close());
  await assert.rejects(
    () =>
      previewService.start(
        fixture.projectId,
        fixture.syncBundle,
        bundle,
        {parentOrigin: 'http://127.0.0.1:5173'},
      ),
    (error) =>
      error instanceof LayoutPreviewError &&
      error.code === 'LAYOUT_PREVIEW_LAYOUT_INTEGRITY_FAILED',
  );
});

test('Layout workspace chặn fingerprint và thuộc tính không được chỉnh', async (context) => {
  const fixture = await createFixture();
  context.after(() =>
    rm(fixture.projectsDirectory, {recursive: true, force: true}),
  );
  const workspace = createLayoutWorkspace(fixture.projectsDirectory);

  await assert.rejects(
    () =>
      workspace.prepare(
        fixture.projectId,
        randomUUID(),
        fixture.syncBundle,
        [
          {
            ...fixture.overrides[0]!,
            nodeFingerprint: sha256('wrong-node'),
          },
        ],
        fixture.manifest,
      ),
    (error) =>
      error instanceof LayoutWorkspaceError &&
      error.code === 'LAYOUT_OVERRIDE_TARGET_MISMATCH',
  );

  const lockedManifest: LayoutEditorManifest = {
    ...fixture.manifest,
    scenes: fixture.manifest.scenes.map((scene, index) =>
      index === 0
        ? {
            ...scene,
            nodes: scene.nodes.map((node) => ({
              ...node,
              lockedProperties: ['fill'],
              lockReason: 'Màu này thuộc nhận diện của scene.',
            })),
          }
        : scene,
    ),
  };
  await assert.rejects(
    () =>
      workspace.prepare(
        fixture.projectId,
        randomUUID(),
        fixture.syncBundle,
        fixture.overrides,
        lockedManifest,
      ),
    (error) =>
      error instanceof LayoutWorkspaceError &&
      error.code === 'LAYOUT_OVERRIDE_PROPERTY_LOCKED',
  );

  const fullyLockedManifest: LayoutEditorManifest = {
    ...fixture.manifest,
    scenes: fixture.manifest.scenes.map((scene, index) =>
      index === 0
        ? {
            ...scene,
            nodes: scene.nodes.map((node) => ({
              ...node,
              lockedProperties: [...node.editableProperties],
              lockReason: 'Node được khóa hoàn toàn từ source.',
            })),
          }
        : scene,
    ),
  };
  await assert.rejects(
    () =>
      workspace.prepare(
        fixture.projectId,
        randomUUID(),
        fixture.syncBundle,
        [
          {
            ...fixture.overrides[0]!,
            patch: {editorLocked: true},
          },
        ],
        fullyLockedManifest,
      ),
    (error) =>
      error instanceof LayoutWorkspaceError &&
      error.code === 'LAYOUT_OVERRIDE_PROPERTY_LOCKED',
  );
});

test('Layout workspace và preview từ chối source Sync đã bị thay đổi', async (context) => {
  const fixture = await createFixture();
  context.after(() =>
    rm(fixture.projectsDirectory, {recursive: true, force: true}),
  );
  const previewService = createLayoutPreviewService(
    fixture.projectsDirectory,
    {maximumActivePreviews: 1},
  );
  context.after(() => previewService.close());

  const sourcePath = path.join(
    fixture.projectDirectory,
    fixture.syncBundle.workspacePath,
    fixture.syncBundle.sections[0]!.filePath,
  );
  const originalSource = await readFile(sourcePath, 'utf8');
  await writeFile(
    sourcePath,
    originalSource.replace('#dbe9e2', '#ffffff'),
    'utf8',
  );

  await assert.rejects(
    () =>
      previewService.start(
        fixture.projectId,
        fixture.syncBundle,
        null,
        {parentOrigin: 'http://127.0.0.1:5173'},
      ),
    (error) =>
      error instanceof LayoutPreviewError &&
      error.code === 'LAYOUT_PREVIEW_SOURCE_MISMATCH',
  );

  const workspace = createLayoutWorkspace(fixture.projectsDirectory);
  await assert.rejects(
    () =>
      workspace.prepare(
        fixture.projectId,
        randomUUID(),
        fixture.syncBundle,
        fixture.overrides,
        fixture.manifest,
      ),
    (error) =>
      error instanceof LayoutWorkspaceError &&
      error.code === 'LAYOUT_SOURCE_MANIFEST_MISMATCH',
  );
});

test('Layout preview khóa generation/session và nhận manifest trực tiếp từ runtime', async (context) => {
  const fixture = await createFixture();
  context.after(() =>
    rm(fixture.projectsDirectory, {recursive: true, force: true}),
  );
  const previewService = createLayoutPreviewService(
    fixture.projectsDirectory,
    {maximumActivePreviews: 1},
  );
  context.after(() => previewService.close());
  const sourceWorkspaceDirectory = path.join(
    fixture.projectDirectory,
    fixture.syncBundle.workspacePath,
  );
  const immutableSourceHash = await animationSyncWorkspaceSourceHash(
    sourceWorkspaceDirectory,
    fixture.syncBundle,
  );
  assert.equal(
    immutableSourceHash,
    fixture.syncBundle.validation.sourceHash,
  );

  const preview = await previewService.start(
    fixture.projectId,
    fixture.syncBundle,
    null,
    {parentOrigin: 'http://127.0.0.1:5173'},
  );
  assert.equal(
    preview.generationId,
    fixture.syncBundle.generation.generationId,
  );
  assert.equal(
    preview.sourceSyncGenerationId,
    fixture.syncBundle.generation.generationId,
  );
  assert.match(preview.sessionNonce, /^[A-Za-z0-9_-]{32,128}$/);
  assert.equal(
    previewService.getSourceWorkspaceHash(
      fixture.projectId,
      preview.sessionNonce,
      preview.sourceSyncGenerationId,
    ),
    fixture.syncBundle.validation.sourceHash,
  );
  const previewUrl = new URL(preview.url);
  assert.equal(
    previewUrl.searchParams.get('parentOrigin'),
    'http://127.0.0.1:5173',
  );

  const htmlResponse = await fetch(preview.url);
  assert.equal(htmlResponse.status, 200);
  assert.match(
    htmlResponse.headers.get('content-security-policy') ?? '',
    /frame-ancestors http:\/\/127\.0\.0\.1:5173/,
  );
  const editorModuleResponse = await fetch(
    new URL('/@id/__x00__virtual:editor', preview.url),
  );
  assert.equal(
    editorModuleResponse.status,
    200,
    await editorModuleResponse.text(),
  );
  assert.equal(
    await animationSyncWorkspaceSourceHash(
      sourceWorkspaceDirectory,
      fixture.syncBundle,
    ),
    immutableSourceHash,
    'Layout preview không được thay đổi Sync generation nguồn.',
  );

  const overridesUrl = new URL(
    previewUrl.searchParams.get('overrides')!,
    preview.url,
  );
  const overridesResponse = await fetch(overridesUrl);
  assert.equal(overridesResponse.status, 200);
  assert.deepEqual(
    (await overridesResponse.json() as {overrides: unknown[]}).overrides,
    [],
  );
  const seedUrl = new URL(
    previewUrl.searchParams.get('manifest')!,
    preview.url,
  );
  const seedResponse = await fetch(seedUrl);
  const seed = await seedResponse.json() as LayoutEditorManifest;
  assert.equal(seedResponse.status, 200);
  assert.deepEqual(
    seed.scenes.map((scene) => scene.sceneId),
    fixture.syncBundle.sections.map((section) => section.sceneId),
  );
  assert.equal(seed.scenes.every((scene) => scene.nodes.length === 0), true);

  assert.throws(
    () =>
      previewService.getManifest(
        fixture.projectId,
        preview.sessionNonce,
        preview.sourceSyncGenerationId,
      ),
    (error) =>
      error instanceof LayoutPreviewError &&
      error.code === 'LAYOUT_PREVIEW_MANIFEST_UNAVAILABLE',
  );

  const captureResponse = await fetch(
    new URL('/__pad_layout_manifest', preview.url),
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sessionNonce: preview.sessionNonce,
        generationId: preview.generationId,
        sourceSyncGenerationId: preview.sourceSyncGenerationId,
        manifest: fixture.manifest,
      }),
    },
  );
  assert.equal(
    captureResponse.status,
    200,
    await captureResponse.text(),
  );
  const capturedManifest = previewService.getManifest(
    fixture.projectId,
    preview.sessionNonce,
    preview.sourceSyncGenerationId,
  );
  assert.deepEqual(
    capturedManifest.scenes[0]?.nodes[0]?.editableProperties,
    [...fixture.manifest.scenes[0]!.nodes[0]!.editableProperties].sort(),
  );

  const reorderedManifest: LayoutEditorManifest = {
    ...fixture.manifest,
    scenes: [...fixture.manifest.scenes]
      .reverse()
      .map((scene) => ({
        ...scene,
        nodes: [...scene.nodes].reverse().map((node) => ({
          ...node,
          editableProperties: [...node.editableProperties].reverse(),
          lockedProperties: [...node.lockedProperties].reverse(),
        })),
      })),
  };
  const reorderedCapture = await fetch(
    new URL('/__pad_layout_manifest', preview.url),
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sessionNonce: preview.sessionNonce,
        generationId: preview.generationId,
        sourceSyncGenerationId: preview.sourceSyncGenerationId,
        manifest: reorderedManifest,
      }),
    },
  );
  assert.equal(
    reorderedCapture.status,
    200,
    await reorderedCapture.text(),
  );
  assert.deepEqual(
    previewService
      .getManifest(
        fixture.projectId,
        preview.sessionNonce,
        preview.sourceSyncGenerationId,
      )
      .scenes.map((scene) => scene.sceneId),
    fixture.syncBundle.sections.map((section) => section.sceneId),
  );

  const semanticParent = fixture.manifest.scenes[0]!.nodes[0]!;
  const generatedNode = {
    ...semanticParent,
    key: 'runtime/TxtLeaf[1]',
    fingerprint: 'f'.repeat(64),
    label: 'TxtLeaf: internal text',
    nodeType: 'TxtLeaf',
    parentKey: semanticParent.key,
    identity: 'legacy' as const,
  };
  const manifestWithGeneratedNode: LayoutEditorManifest = {
    ...fixture.manifest,
    scenes: fixture.manifest.scenes.map((scene, sceneIndex) => ({
      ...scene,
      nodes:
        sceneIndex === 0
          ? [...scene.nodes, generatedNode]
          : scene.nodes,
    })),
  };
  const generatedCapture = await fetch(
    new URL('/__pad_layout_manifest', preview.url),
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sessionNonce: preview.sessionNonce,
        generationId: preview.generationId,
        sourceSyncGenerationId: preview.sourceSyncGenerationId,
        manifest: manifestWithGeneratedNode,
      }),
    },
  );
  assert.equal(generatedCapture.status, 200, await generatedCapture.text());
  assert.equal(
    previewService
      .getManifest(
        fixture.projectId,
        preview.sessionNonce,
        preview.sourceSyncGenerationId,
      )
      .scenes[0]!.nodes.some((node) => node.key === generatedNode.key),
    true,
  );
  const canonicalCapture = await fetch(
    new URL('/__pad_layout_manifest', preview.url),
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sessionNonce: preview.sessionNonce,
        generationId: preview.generationId,
        sourceSyncGenerationId: preview.sourceSyncGenerationId,
        manifest: fixture.manifest,
      }),
    },
  );
  assert.equal(canonicalCapture.status, 200, await canonicalCapture.text());
  assert.equal(
    previewService
      .getManifest(
        fixture.projectId,
        preview.sessionNonce,
        preview.sourceSyncGenerationId,
      )
      .scenes[0]!.nodes.some((node) => node.key === generatedNode.key),
    false,
    'Generated runtime child phải được bỏ khi semantic parent còn nguyên.',
  );

  const changedPolicyManifest: LayoutEditorManifest = {
    ...fixture.manifest,
    scenes: fixture.manifest.scenes.map((scene, sceneIndex) => ({
      ...scene,
      nodes: scene.nodes.map((node, nodeIndex) =>
        sceneIndex === 0 && nodeIndex === 0
          ? {
              ...node,
              lockedProperties: ['fill'],
              lockReason: 'Policy bị thay đổi trong cùng session.',
            }
          : node,
      ),
    })),
  };
  const changedPolicyCapture = await fetch(
    new URL('/__pad_layout_manifest', preview.url),
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sessionNonce: preview.sessionNonce,
        generationId: preview.generationId,
        sourceSyncGenerationId: preview.sourceSyncGenerationId,
        manifest: changedPolicyManifest,
      }),
    },
  );
  assert.equal(changedPolicyCapture.status, 409);

  const rejectedCapture = await fetch(
    new URL('/__pad_layout_manifest', preview.url),
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sessionNonce: `${preview.sessionNonce}x`,
        generationId: preview.generationId,
        sourceSyncGenerationId: preview.sourceSyncGenerationId,
        manifest: fixture.manifest,
      }),
    },
  );
  assert.equal(rejectedCapture.status, 400);
  assert.equal(
    (await previewService.start(
      fixture.projectId,
      fixture.syncBundle,
      null,
      {parentOrigin: 'http://127.0.0.1:5173'},
    )).url,
    preview.url,
  );

  const sourcePath = path.join(
    fixture.projectDirectory,
    fixture.syncBundle.workspacePath,
    fixture.syncBundle.sections[0]!.filePath,
  );
  const originalSource = await readFile(sourcePath, 'utf8');
  await writeFile(
    sourcePath,
    originalSource.replace('#dbe9e2', '#ffffff'),
    'utf8',
  );
  await assert.rejects(
    () =>
      previewService.start(
        fixture.projectId,
        fixture.syncBundle,
        null,
        {parentOrigin: 'http://127.0.0.1:5173'},
      ),
    (error) =>
      error instanceof LayoutPreviewError &&
      error.code === 'LAYOUT_PREVIEW_SOURCE_MISMATCH',
  );
});
