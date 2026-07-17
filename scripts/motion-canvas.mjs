import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTopicProject} from '../src/shared/topic.ts';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const command = process.argv[2];
const projectArgumentIndex = process.argv.indexOf('--project');
const projectId =
  projectArgumentIndex >= 0 ? process.argv[projectArgumentIndex + 1] : '';

if (command !== 'serve' || !projectId) {
  console.error(
    'Cách dùng: npm run motion:serve -- --project <project-id>',
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
  const bundle = projectData.motionCanvasBundle;

  if (!bundle?.workspacePath || !bundle?.projectFile) {
    console.error('Project chưa có workspace Motion Canvas.');
    process.exitCode = 1;
  } else {
    const workspaceDirectory = path.resolve(
      projectDirectory,
      bundle.workspacePath,
    );
    const projectFile = path.resolve(
      workspaceDirectory,
      bundle.projectFile,
    );
    const outputDirectory = path.join(
      projectDirectory,
      'renders',
      'motion-canvas',
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

    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
    child.on('exit', (code) => {
      process.exitCode = code ?? 1;
    });
  }
}
