import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {createAnimationSyncWorkspace} from '../src/backend/animationSyncWorkspace.ts';
import {createMotionCanvasWorkspace} from '../src/backend/motionCanvasWorkspace.ts';
import {parseTopicProject} from '../src/shared/topic.ts';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const temporaryRoot = path.join(rootDirectory, 'tmp');
await mkdir(temporaryRoot, {recursive: true});
const validationDirectory = await mkdtemp(
  path.join(temporaryRoot, 'motion-canvas-validation-'),
);
const projectArgumentIndex = process.argv.indexOf('--project');
const requestedProjectId =
  projectArgumentIndex >= 0 ? process.argv[projectArgumentIndex + 1] : '';
const stageArgumentIndex = process.argv.indexOf('--stage');
const stage =
  stageArgumentIndex >= 0
    ? process.argv[stageArgumentIndex + 1]
    : 'motion';
const browserArgumentIndex = process.argv.indexOf('--browser');
const browserExecutable =
  browserArgumentIndex >= 0
    ? process.argv[browserArgumentIndex + 1]
    : '';
const execFileAsync = promisify(execFile);

if (stage !== 'motion' && stage !== 'sync') {
  throw new Error('Stage phải là motion hoặc sync.');
}
if (browserArgumentIndex >= 0 && !browserExecutable) {
  throw new Error('--browser cần đường dẫn tới Chromium hoặc Chrome.');
}

function rawPcmSilence(durationSeconds, sampleRate = 16_000) {
  return Buffer.alloc(Math.round(durationSeconds * sampleRate) * 2);
}

try {
  let projectId;
  let workspaceDirectory;
  let projectFile;
  let scenes;

  if (requestedProjectId) {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(requestedProjectId)) {
      throw new Error('Project ID không hợp lệ.');
    }
    projectId = requestedProjectId;
    const projectDirectory = path.join(
      rootDirectory,
      'projects',
      requestedProjectId,
    );
    const projectData = parseTopicProject(
      JSON.parse(
        await readFile(path.join(projectDirectory, 'project.json'), 'utf8'),
      ),
    );
    const bundle =
      stage === 'sync'
        ? projectData.animationSyncBundle
        : projectData.motionCanvasBundle;
    const motionBundle = projectData.motionCanvasBundle;
    if (!bundle || !motionBundle) {
      throw new Error(
        stage === 'sync'
          ? 'Project chưa có workspace đồng bộ.'
          : 'Project chưa có workspace Motion Canvas.',
      );
    }
    workspaceDirectory = path.resolve(
      projectDirectory,
      bundle.workspacePath,
    );
    projectFile = path.join(workspaceDirectory, bundle.projectFile);
    scenes = motionBundle.scenes;
  } else {
    projectId =
      stage === 'sync'
        ? 'runtime-validation-sync'
        : 'runtime-validation';
    const generationId = randomUUID();
    const workspace = createMotionCanvasWorkspace(validationDirectory);
    const outlineSectionIds = [randomUUID(), randomUUID()];
    const beatIds = [randomUUID(), randomUUID()];
    const sourceScenes = [
      {
        id: randomUUID(),
        outlineSectionId: outlineSectionIds[0],
        name: 'Runtime validation one',
        filePath: 'src/scenes/01-runtime-validation-one.tsx',
        durationSeconds: 4,
        source: `import {makeScene2D, Rect} from '@motion-canvas/2d';
import {createRef, useDuration, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const card = createRef<Rect>();
  view.add(<Rect ref={card} width={480} height={120} fill={'#dbe9e2'} />);
  yield* waitUntil('beat:${beatIds[0]}:start');
  yield* card().opacity(0.5, useDuration('beat:${beatIds[0]}:end'));
});
`,
        timingEvents: [
          {
            beatId: beatIds[0],
            startEvent: `beat:${beatIds[0]}:start`,
            endEvent: `beat:${beatIds[0]}:end`,
            plannedDurationSeconds: 4,
          },
        ],
      },
      {
        id: randomUUID(),
        outlineSectionId: outlineSectionIds[1],
        name: 'Runtime validation two',
        filePath: 'src/scenes/02-runtime-validation-two.tsx',
        durationSeconds: 4,
        source: `import {makeScene2D, Circle} from '@motion-canvas/2d';
import {createRef, useDuration, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const dot = createRef<Circle>();
  view.add(<Circle ref={dot} size={180} fill={'#e77849'} />);
  yield* waitUntil('beat:${beatIds[1]}:start');
  yield* dot().scale(1.2, useDuration('beat:${beatIds[1]}:end'));
});
`,
        timingEvents: [
          {
            beatId: beatIds[1],
            startEvent: `beat:${beatIds[1]}:start`,
            endEvent: `beat:${beatIds[1]}:end`,
            plannedDurationSeconds: 4,
          },
        ],
      },
    ];
    const prepared = await workspace.prepare(
      projectId,
      generationId,
      sourceScenes,
    );

    if (stage === 'sync') {
      const voiceGenerationId = randomUUID();
      const voiceWorkspacePath =
        `voice/generations/${voiceGenerationId}`;
      const masterAudioPath = 'audio/narration.pcm';
      const masterAudioFile = path.join(
        validationDirectory,
        projectId,
        voiceWorkspacePath,
        masterAudioPath,
      );
      await mkdir(path.dirname(masterAudioFile), {recursive: true});
      await writeFile(masterAudioFile, rawPcmSilence(0.5));
      const voiceSections = outlineSectionIds.map(
        (outlineSectionId, index) => ({
          outlineSectionId,
          textStartIndex: index,
          textEndIndex: index + 1,
          startSeconds: index * 0.25,
          endSeconds: (index + 1) * 0.25,
          durationSeconds: 0.25,
          sourceTextHash: 'a'.repeat(64),
          beats: [
            {
              beatId: beatIds[index],
              textStartIndex: index,
              textEndIndex: index + 1,
              startSeconds: 0,
              endSeconds: 0.25,
            },
          ],
        }),
      );
      const syncWorkspace = createAnimationSyncWorkspace(
        validationDirectory,
      );
      const synchronized = await syncWorkspace.prepare(
        projectId,
        randomUUID(),
        {
          status: 'approved',
          contentRevision: 1,
          sourceVoiceVisualContentRevision: 1,
          workspacePath: prepared.workspacePath,
          projectFile: prepared.projectFile,
          width: 1080,
          height: 1920,
          fps: 30,
          timingContractVersion: 1,
          scenes: prepared.scenes,
          validation: prepared.validation,
          generation: {
            generationId,
            provider: 'codex',
            model: 'runtime-validation',
            promptVersion: 'runtime-validation',
            generatedAt: new Date().toISOString(),
            usage: null,
          },
        },
        {
          status: 'approved',
          contentRevision: 1,
          sourceNarrationRevision: 1,
          workspacePath: voiceWorkspacePath,
          configuration: {
            voiceId: 'runtime-validation',
            voiceName: 'Runtime validation',
            voiceCategory: 'test',
            modelId: 'runtime-validation',
            modelName: 'Runtime validation',
            languageCode: 'vi',
            outputFormat: 'pcm_16000',
            settings: {
              stability: 0.5,
              similarityBoost: 0.75,
              style: 0,
              useSpeakerBoost: true,
              speed: 1,
            },
            seed: null,
          },
          track: {
            audioPath: masterAudioPath,
            alignmentPath: 'alignments/narration.json',
            sourceTextHash: 'a'.repeat(64),
            durationSeconds: 0.5,
            characterCost: 2,
            strategy: 'single-request',
            chunkCount: 1,
            calibration: {
              whitespaceTokenCount: 2,
              characterCount: 2,
              whitespaceTokensPerMinute: 240,
              charactersPerSecond: 4,
            },
          },
          sections: voiceSections,
          totalDurationSeconds: 0.5,
          generation: {
            generationId: voiceGenerationId,
            provider: 'elevenlabs',
            generatedAt: new Date().toISOString(),
            characterCost: 2,
            requestIds: ['runtime-1', 'runtime-2'],
          },
        },
      );
      workspaceDirectory = path.join(
        validationDirectory,
        projectId,
        synchronized.workspacePath,
      );
      projectFile = path.join(
        workspaceDirectory,
        synchronized.projectFile,
      );
      scenes = prepared.scenes;
    } else {
      workspaceDirectory = path.join(
        validationDirectory,
        projectId,
        prepared.workspacePath,
      );
      projectFile = path.join(workspaceDirectory, prepared.projectFile);
      scenes = prepared.scenes;
    }
  }

  const runtimePackage = path.join(
    rootDirectory,
    'motion-canvas-runtime',
    'package.json',
  );
  const runtimeRequire = createRequire(runtimePackage);
  const viteEntry = path.join(
    path.dirname(runtimeRequire.resolve('vite/package.json')),
    'dist',
    'node',
    'index.js',
  );
  const viteConfig = path.join(
    rootDirectory,
    'motion-canvas-runtime',
    'vite.config.ts',
  );
  process.env.PAD_MOTION_PROJECT_FILE = projectFile;
  process.env.PAD_MOTION_OUTPUT_DIRECTORY = path.join(
    validationDirectory,
    'renders',
  );
  if (stage === 'sync') {
    process.env.PAD_MOTION_PREVIEW_ONLY = 'true';
  }
  const {createServer} = await import(pathToFileURL(viteEntry).href);
  const server = await createServer({
    configFile: viteConfig,
    root: workspaceDirectory,
    cacheDir: path.join(validationDirectory, 'vite-cache'),
    logLevel: 'silent',
    optimizeDeps: {
      noDiscovery: true,
      include: [
        'chroma-js',
        'parse-svg-path',
        'mathjax-full/js/adaptors/liteAdaptor',
        'mathjax-full/js/handlers/html',
        'mathjax-full/js/input/tex',
        'mathjax-full/js/input/tex/AllPackages',
        'mathjax-full/js/mathjax',
        'mathjax-full/js/output/svg',
      ],
    },
    resolve: {
      alias: {
        '@motion-canvas/core': path.join(
          rootDirectory,
          'node_modules',
          '@motion-canvas',
          'core',
        ),
        '@motion-canvas/2d': path.join(
          rootDirectory,
          'node_modules',
          '@motion-canvas',
          '2d',
        ),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      hmr: false,
      fs: {
        allow: [rootDirectory, workspaceDirectory],
      },
    },
  });

  try {
    await server.listen();
    const editorUrl = server.resolvedUrls?.local[0];
    if (!editorUrl) throw new Error('Motion Canvas editor không có URL local.');
    const sourceFiles = [
      projectFile,
      ...scenes.map((scene) =>
        path.join(workspaceDirectory, scene.filePath),
      ),
    ];
    for (const sourceFile of sourceFiles) {
      const viteFileUrl = `/@fs/${sourceFile.replaceAll('\\', '/')}${
        sourceFile === projectFile ? '?project' : '?scene'
      }`;
      const transformed = await server.transformRequest(viteFileUrl);
      if (!transformed) {
        throw new Error(
          `Motion Canvas could not transform ${path.basename(sourceFile)}.`,
        );
      }
    }
    if (stage === 'sync') {
      const previewEntry = path.join(
        rootDirectory,
        'motion-canvas-runtime',
        'preview',
        'main.js',
      );
      const transformedPreview = await server.transformRequest(
        `/@fs/${previewEntry.replaceAll('\\', '/')}`,
      );
      if (
        !transformedPreview?.code.includes('pad-studio-sync-preview')
      ) {
        throw new Error(
          'Player chỉ-đọc của workspace đồng bộ chưa được transform.',
        );
      }
    }
    const response = await fetch(editorUrl);
    const html = await response.text();
    if (
      !response.ok ||
      !html.toLowerCase().includes('<html') ||
      (stage === 'sync' &&
        !html.includes('PAD Studio · Bản nháp đồng bộ'))
    ) {
      throw new Error('Motion Canvas editor không trả về HTML hợp lệ.');
    }
    const editorModuleResponse = await fetch(
      new URL('/@id/__x00__virtual:editor', editorUrl),
    );
    const editorModule = await editorModuleResponse.text();
    if (
      !editorModuleResponse.ok ||
      !editorModule.includes('?project') ||
      editorModule.includes('index([])')
    ) {
      throw new Error(
        `Motion Canvas editor không đăng ký được project để preview ` +
          `(HTTP ${editorModuleResponse.status}): ` +
          editorModule.slice(0, 500),
      );
    }
    if (browserExecutable) {
      if (stage !== 'sync') {
        throw new Error(
          '--browser hiện chỉ dùng để kiểm tra player của stage sync.',
        );
      }
      const {stdout, stderr} = await execFileAsync(
        browserExecutable,
        [
          '--headless',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-networking',
          '--autoplay-policy=no-user-gesture-required',
          '--virtual-time-budget=8000',
          '--dump-dom',
          editorUrl,
        ],
        {
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30_000,
          windowsHide: true,
        },
      );
      if (
        !stdout.includes('data-ready="true"') ||
        !stdout.includes('class="preview-play"')
      ) {
        const browserDiagnostics = stderr
          .split(/\r?\n/)
          .filter((line) =>
            /(?:console|error|failed|uncaught|http:\/\/127\.0\.0\.1)/i.test(
              line,
            ),
          )
          .slice(-50)
          .join('\n');
        throw new Error(
          'Player sync không render xong trong trình duyệt headless.\n' +
            `DOM: ${stdout.slice(-3_000)}\n` +
            `Chromium: ${browserDiagnostics || stderr.slice(-3_000)}`,
        );
      }
      console.info('Sync preview browser player: OK');
    }
    await server.waitForRequestsIdle();
    console.info(`Motion Canvas runtime editor (${projectId}): OK`);
  } finally {
    await new Promise((resolve, reject) => {
      const closeTimeout = setTimeout(resolve, 2_000);
      void server.close().then(
        () => {
          clearTimeout(closeTimeout);
          resolve();
        },
        (error) => {
          clearTimeout(closeTimeout);
          reject(error);
        },
      );
    });
    delete process.env.PAD_MOTION_PROJECT_FILE;
    delete process.env.PAD_MOTION_OUTPUT_DIRECTORY;
    delete process.env.PAD_MOTION_PREVIEW_ONLY;
  }
} finally {
  const resolvedValidationDirectory = path.resolve(validationDirectory);
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  if (
    resolvedValidationDirectory.startsWith(
      `${resolvedTemporaryRoot}${path.sep}`,
    )
  ) {
    await rm(resolvedValidationDirectory, {
      recursive: true,
      force: true,
    });
  }
}
