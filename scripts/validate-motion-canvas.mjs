import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
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
    const bundle = projectData.motionCanvasBundle;
    if (!bundle) {
      throw new Error('Project chưa có workspace Motion Canvas.');
    }
    workspaceDirectory = path.resolve(
      projectDirectory,
      bundle.workspacePath,
    );
    projectFile = path.join(workspaceDirectory, bundle.projectFile);
    scenes = bundle.scenes;
  } else {
    projectId = 'runtime-validation';
    const generationId = randomUUID();
    const workspace = createMotionCanvasWorkspace(validationDirectory);
    const prepared = await workspace.prepare(projectId, generationId, [
      {
        id: randomUUID(),
        outlineSectionId: randomUUID(),
        name: 'Runtime validation one',
        filePath: 'src/scenes/01-runtime-validation-one.tsx',
        durationSeconds: 4,
        source: `import {makeScene2D, Rect} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(<Rect width={480} height={120} fill={'#dbe9e2'} />);
  yield* waitFor(4);
});
`,
      },
      {
        id: randomUUID(),
        outlineSectionId: randomUUID(),
        name: 'Runtime validation two',
        filePath: 'src/scenes/02-runtime-validation-two.tsx',
        durationSeconds: 4,
        source: `import {makeScene2D, Circle} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(<Circle size={180} fill={'#e77849'} />);
  yield* waitFor(4);
});
`,
      },
    ]);
    workspaceDirectory = path.join(
      validationDirectory,
      projectId,
      prepared.workspacePath,
    );
    projectFile = path.join(workspaceDirectory, prepared.projectFile);
    scenes = prepared.scenes;
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
  const {createServer} = await import(pathToFileURL(viteEntry).href);
  const server = await createServer({
    configFile: viteConfig,
    root: workspaceDirectory,
    logLevel: 'silent',
    server: {
      host: '127.0.0.1',
      port: 0,
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
    const response = await fetch(editorUrl);
    const html = await response.text();
    if (!response.ok || !html.toLowerCase().includes('<html')) {
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
        'Motion Canvas editor không đăng ký được project để preview.',
      );
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
