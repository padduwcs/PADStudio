import {spawn} from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyPreviewWorkspace} from '../src/backend/previewWorkspaceCopy.ts';
import {parseTopicProject} from '../src/shared/topic.ts';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const command = process.argv[2];
const projectArgumentIndex = process.argv.indexOf('--project');
const projectId =
  projectArgumentIndex >= 0 ? process.argv[projectArgumentIndex + 1] : '';
const stageArgumentIndex = process.argv.indexOf('--stage');
const stage =
  stageArgumentIndex >= 0
    ? process.argv[stageArgumentIndex + 1]
    : 'motion';
const temporaryRoot = path.join(rootDirectory, 'tmp');

function isInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

async function createPreviewCopy(sourceDirectory, stage, scenePaths) {
  await mkdir(temporaryRoot, {recursive: true});
  const temporaryDirectory = await mkdtemp(
    path.join(temporaryRoot, `${stage}-serve-`),
  );
  // Keep the same directory depth as the immutable generation workspace.
  // The generated tsconfig uses portable ../../../../../node_modules paths.
  const workspaceDirectory = path.join(
    temporaryDirectory,
    stage === 'sync' ? 'sync' : 'motion-canvas',
    'generations',
    path.basename(sourceDirectory),
  );
  try {
    await mkdir(path.dirname(workspaceDirectory), {recursive: true});
    await copyPreviewWorkspace(sourceDirectory, workspaceDirectory, {
      motionCanvasScenePaths: scenePaths,
    });
    return {temporaryDirectory, workspaceDirectory};
  } catch (error) {
    if (isInside(temporaryRoot, temporaryDirectory)) {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function removePreviewCopy(temporaryDirectory) {
  if (
    temporaryDirectory &&
    isInside(temporaryRoot, temporaryDirectory)
  ) {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });
  }
}

if (
  command !== 'serve' ||
  !projectId ||
  (stage !== 'motion' && stage !== 'sync')
) {
  console.error(
    'Cách dùng: npm run motion:serve -- --project <project-id> [--stage motion|sync]',
  );
  process.exitCode = 1;
} else if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId)) {
  console.error('Project ID không hợp lệ.');
  process.exitCode = 1;
} else {
  const projectDirectory = path.join(rootDirectory, 'projects', projectId);
  const projectData = parseTopicProject(
    JSON.parse(
      await readFile(path.join(projectDirectory, 'project.json'), 'utf8'),
    ),
  );
  const bundle =
    stage === 'sync'
      ? projectData.animationSyncBundle
      : projectData.motionCanvasBundle;

  if (!bundle?.workspacePath || !bundle?.projectFile) {
    console.error(
      stage === 'sync'
        ? 'Project chưa có workspace đồng bộ.'
        : 'Project chưa có workspace Motion Canvas.',
    );
    process.exitCode = 1;
  } else {
    const sourceWorkspaceDirectory = path.resolve(
      projectDirectory,
      bundle.workspacePath,
    );
    const scenePaths =
      stage === 'sync'
        ? bundle.sections.map((section) => section.filePath)
        : bundle.scenes.map((scene) => scene.filePath);
    const previewCopy = await createPreviewCopy(
      sourceWorkspaceDirectory,
      stage,
      scenePaths,
    );
    const temporaryDirectory = previewCopy.temporaryDirectory;
    const workspaceDirectory = previewCopy.workspaceDirectory;
    const projectFile = path.resolve(workspaceDirectory, bundle.projectFile);
    const outputDirectory = path.join(
      projectDirectory,
      'renders',
      stage === 'sync' ? 'sync' : 'motion-canvas',
    );
    const runtimePackage = path.join(
      rootDirectory,
      'motion-canvas-runtime',
      'package.json',
    );
    const runtimeRequire = createRequire(runtimePackage);
    const vitePackage = runtimeRequire.resolve('vite/package.json');
    const viteCli = path.join(path.dirname(vitePackage), 'bin', 'vite.js');
    const viteConfig = path.join(
      rootDirectory,
      'motion-canvas-runtime',
      'vite.config.ts',
    );
    try {
      const child = spawn(
        process.execPath,
        [viteCli, '--config', viteConfig],
        {
          cwd: workspaceDirectory,
          stdio: 'inherit',
          windowsHide: true,
          env: {
            ...process.env,
            PAD_MOTION_PROJECT_FILE: projectFile,
            PAD_MOTION_OUTPUT_DIRECTORY: outputDirectory,
          },
        },
      );

      const stop = (signal) => {
        if (!child.killed) child.kill(signal);
      };
      const stopOnInterrupt = () => stop('SIGINT');
      const stopOnTermination = () => stop('SIGTERM');

      process.on('SIGINT', stopOnInterrupt);
      process.on('SIGTERM', stopOnTermination);
      try {
        const code = await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (exitCode) => resolve(exitCode));
        });
        process.exitCode = code ?? 1;
      } finally {
        process.off('SIGINT', stopOnInterrupt);
        process.off('SIGTERM', stopOnTermination);
      }
    } finally {
      await removePreviewCopy(temporaryDirectory);
    }
  }
}
