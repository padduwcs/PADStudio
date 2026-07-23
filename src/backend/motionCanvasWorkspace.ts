import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {
  MotionCanvasSceneSchema,
  type MotionCanvasBundle,
  type MotionCanvasScene,
} from '../shared/topic.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {
  MOTION_CANVAS_FPS,
  MOTION_CANVAS_HEIGHT,
  MOTION_CANVAS_VERSION,
  MOTION_CANVAS_WIDTH,
  type MotionCanvasSourceScene,
} from './motionCanvasGenerator.ts';

const execFileAsync = promisify(execFile);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const staleStagingPattern =
  /^\.staging-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STALE_STAGING_AGE_MS = 6 * 60 * 60 * 1_000;

export interface PreparedMotionCanvasWorkspace {
  workspacePath: string;
  projectFile: 'src/project.ts';
  scenes: MotionCanvasScene[];
  validation: MotionCanvasBundle['validation'];
}

export interface MotionCanvasWorkspaceFile {
  path: string;
  source: string;
}

export interface MotionCanvasWorkspace {
  prepare(
    projectId: string,
    generationId: string,
    scenes: MotionCanvasSourceScene[],
  ): Promise<PreparedMotionCanvasWorkspace>;
  readFiles(
    projectId: string,
    bundle: MotionCanvasBundle,
  ): Promise<MotionCanvasWorkspaceFile[]>;
  readSceneSources(
    projectId: string,
    bundle: MotionCanvasBundle,
  ): Promise<MotionCanvasSourceScene[]>;
  verify(
    projectId: string,
    bundle: MotionCanvasBundle,
  ): Promise<{
    projectDirectory: string;
    workspaceDirectory: string;
    projectFile: string;
    sourceHash: string;
  }>;
}

const StoredMotionCanvasManifestSchema = z
  .object({
    generationId: z.string().uuid(),
    motionCanvasVersion: z.string().trim().min(1).max(40),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough();

export class MotionCanvasWorkspaceError extends Error {
  readonly code: string;
  readonly details: string | null;

  constructor(
    code: string,
    message: string,
    options?: ErrorOptions & {details?: string},
  ) {
    super(message, {cause: options?.cause});
    this.code = code;
    this.details = options?.details ?? null;
  }
}

function assertProjectId(projectId: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId)) {
    throw new MotionCanvasWorkspaceError(
      'MOTION_CANVAS_WORKSPACE_INVALID',
      'Project ID của workspace Motion Canvas không hợp lệ.',
    );
  }
}

function projectSource(scenes: MotionCanvasSourceScene[]) {
  const imports = scenes.map((scene, index) => {
    const importPath = `./scenes/${path.posix.basename(scene.filePath, '.tsx')}?scene`;
    return `import scene${String(index + 1).padStart(2, '0')} from '${importPath}';`;
  });
  const sceneNames = scenes.map((_scene, index) =>
    `scene${String(index + 1).padStart(2, '0')}`,
  );

  return [
    "import {makeProject} from '@motion-canvas/core';",
    '',
    ...imports,
    '',
    'export default makeProject({',
    `  scenes: [${sceneNames.join(', ')}],`,
    '});',
    '',
  ].join('\n');
}

function projectMetaSource() {
  return `${JSON.stringify(
    {
      version: 1,
      shared: {
        background: 'rgb(17,31,27)',
        range: [0, null],
        size: {x: MOTION_CANVAS_WIDTH, y: MOTION_CANVAS_HEIGHT},
        audioOffset: 0,
      },
      preview: {
        fps: MOTION_CANVAS_FPS,
        resolutionScale: 0.5,
      },
      rendering: {
        fps: MOTION_CANVAS_FPS,
        resolutionScale: 1,
        colorSpace: 'srgb',
        fileType: 'image/png',
        quality: 1,
      },
    },
    null,
    2,
  )}\n`;
}

function sceneMetaSource(scene: MotionCanvasSourceScene) {
  let targetTime = 0;
  const timeEvents = (scene.timingEvents ?? []).flatMap((event) => {
    const start = {name: event.startEvent, targetTime};
    targetTime += event.plannedDurationSeconds;
    const end = {name: event.endEvent, targetTime};
    return [start, end];
  });
  const seed = Number.parseInt(scene.id.replaceAll('-', '').slice(0, 8), 16);
  return `${JSON.stringify(
    {
      version: 0,
      timeEvents,
      seed: Number.isSafeInteger(seed) ? seed : 0,
    },
    null,
    2,
  )}\n`;
}

function tsconfigSource(
  motionCanvas2dConfig: string,
  motionCanvasPackagesPattern: string,
) {
  return `${JSON.stringify(
    {
      extends: motionCanvas2dConfig.replaceAll(path.sep, '/'),
      compilerOptions: {
        baseUrl: '.',
        noEmit: true,
        strict: true,
        paths: {
          '@motion-canvas/*': [
            motionCanvasPackagesPattern.replaceAll(path.sep, '/'),
          ],
        },
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`;
}

function portableConfigPath(fromDirectory: string, target: string) {
  const relativePath = path.relative(fromDirectory, target);
  if (path.isAbsolute(relativePath)) return target;
  const configPath = relativePath || '.';
  return configPath.startsWith('.') ? configPath : `./${configPath}`;
}

function sourceHash(files: MotionCanvasWorkspaceFile[]) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.source);
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function cleanupStaleStagingDirectories(
  generationsDirectory: string,
) {
  const entries = await readdir(generationsDirectory, {
    withFileTypes: true,
  }).catch(() => []);
  const now = Date.now();
  await Promise.all(
    entries
      .filter(
        entry =>
          entry.isDirectory() && staleStagingPattern.test(entry.name),
      )
      .map(async entry => {
        const target = path.resolve(generationsDirectory, entry.name);
        if (!isInside(generationsDirectory, target)) return;
        const metadata = await lstat(target).catch(() => null);
        if (
          !metadata?.isDirectory() ||
          now - metadata.mtimeMs < STALE_STAGING_AGE_MS
        ) {
          return;
        }
        await rm(target, {recursive: true, force: true}).catch(
          () => undefined,
        );
      }),
  );
}

function isInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

async function commitWorkspace(
  stagingDirectory: string,
  finalDirectory: string,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(stagingDirectory, finalDirectory);
      return;
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (code === 'EEXIST' || code === 'ENOTEMPTY') {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_WORKSPACE_CONFLICT',
          'Generation ID này đã có workspace Motion Canvas.',
          {cause: error},
        );
      }
      const transientLock = code === 'EPERM' || code === 'EBUSY';
      if (
        transientLock &&
        attempt === 5 &&
        process.platform === 'win32'
      ) {
        try {
          await cp(stagingDirectory, finalDirectory, {
            recursive: true,
            errorOnExist: true,
            force: false,
          });
          return;
        } catch (copyError) {
          await rm(finalDirectory, {recursive: true, force: true}).catch(
            () => undefined,
          );
          throw new MotionCanvasWorkspaceError(
            'MOTION_CANVAS_WORKSPACE_WRITE_FAILED',
            'Không thể hoàn tất workspace Motion Canvas.',
            {cause: copyError},
          );
        }
      }
      if (!transientLock || attempt === 5) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_WORKSPACE_WRITE_FAILED',
          'Không thể hoàn tất workspace Motion Canvas.',
          {cause: error},
        );
      }
      await delay(50 * 2 ** attempt);
    }
  }
}

export function createMotionCanvasWorkspace(
  projectsDirectory: string,
  options: {typescriptPath?: string} = {},
): MotionCanvasWorkspace {
  const resolvedProjectsDirectory = path.resolve(projectsDirectory);
  const typescriptPath =
    options.typescriptPath ??
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../node_modules/typescript/bin/tsc',
    );
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const motionCanvas2dConfig = path.join(
    repositoryRoot,
    'node_modules',
    '@motion-canvas',
    '2d',
    'tsconfig.project.json',
  );
  const motionCanvasPackagesPattern = path.join(
    repositoryRoot,
    'node_modules',
    '@motion-canvas',
    '*',
  );

  function projectDirectory(projectId: string) {
    assertProjectId(projectId);
    return path.join(resolvedProjectsDirectory, projectId);
  }

  function resolveBundleDirectory(
    projectId: string,
    bundle: MotionCanvasBundle,
  ) {
    const root = projectDirectory(projectId);
    const directory = path.resolve(root, bundle.workspacePath);
    if (!isInside(root, directory)) {
      throw new MotionCanvasWorkspaceError(
        'MOTION_CANVAS_WORKSPACE_INVALID',
        'Workspace Motion Canvas nằm ngoài project.',
      );
    }
    return directory;
  }

  async function readWorkspaceFile(directory: string, relativePath: string) {
    const filePath = path.resolve(directory, relativePath);
    if (!isInside(directory, filePath)) {
      throw new MotionCanvasWorkspaceError(
        'MOTION_CANVAS_WORKSPACE_INVALID',
        'Đường dẫn file Motion Canvas không hợp lệ.',
      );
    }

    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      throw new MotionCanvasWorkspaceError(
        'MOTION_CANVAS_WORKSPACE_READ_FAILED',
        `Không thể đọc file Motion Canvas “${relativePath}”.`,
        {cause: error},
      );
    }
  }

  return {
    async prepare(projectId, generationId, scenes) {
      assertProjectId(projectId);
      if (!uuidPattern.test(generationId)) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_WORKSPACE_INVALID',
          'Generation ID của workspace Motion Canvas không hợp lệ.',
        );
      }
      if (
        scenes.length < pipelineSafetyLimits.minimumSections ||
        scenes.length > pipelineSafetyLimits.maximumSections
      ) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_WORKSPACE_INVALID',
          'Số scene của workspace Motion Canvas vượt cầu chì an toàn.',
        );
      }
      const scenePaths = new Set<string>();
      const sceneIds = new Set<string>();
      for (const scene of scenes) {
        const {source, ...metadata} = scene;
        if (
          !MotionCanvasSceneSchema.safeParse(metadata).success ||
          source.trim().length === 0 ||
          scenePaths.has(scene.filePath) ||
          sceneIds.has(scene.id)
        ) {
          throw new MotionCanvasWorkspaceError(
            'MOTION_CANVAS_WORKSPACE_INVALID',
            'Danh sách scene của workspace Motion Canvas không hợp lệ.',
          );
        }
        scenePaths.add(scene.filePath);
        sceneIds.add(scene.id);
      }

      const root = projectDirectory(projectId);
      const generationsDirectory = path.join(
        root,
        'motion-canvas',
        'generations',
      );
      const finalDirectory = path.join(generationsDirectory, generationId);
      const stagingDirectory = path.join(
        generationsDirectory,
        `.staging-${randomUUID()}`,
      );
      const workspacePath =
        `motion-canvas/generations/${generationId}` as const;
      const storedMotionCanvas2dConfig = portableConfigPath(
        finalDirectory,
        motionCanvas2dConfig,
      );
      const storedMotionCanvasPackagesPattern = portableConfigPath(
        finalDirectory,
        motionCanvasPackagesPattern,
      );

      await mkdir(generationsDirectory, {recursive: true});
      await cleanupStaleStagingDirectories(generationsDirectory);
      const finalExists = await stat(finalDirectory)
        .then((entry) => entry.isDirectory())
        .catch(() => false);
      if (finalExists) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_WORKSPACE_CONFLICT',
          'Generation ID này đã có workspace Motion Canvas.',
        );
      }

      const files: MotionCanvasWorkspaceFile[] = [
        {path: 'src/project.ts', source: projectSource(scenes)},
        {path: 'src/project.meta', source: projectMetaSource()},
        {
          path: 'src/motion-canvas.d.ts',
          source: `declare module '*?scene' {
  const value: import('@motion-canvas/core/lib/scenes/Scene').FullSceneDescription;
  export = value;
}

declare type Callback = (...args: any[]) => void;
`,
        },
        {
          path: 'tsconfig.json',
          source: tsconfigSource(
            storedMotionCanvas2dConfig,
            storedMotionCanvasPackagesPattern,
          ),
        },
        ...scenes.map((scene) => ({
          path: scene.filePath,
          source: scene.source,
        })),
        ...scenes.map((scene) => ({
          path: scene.filePath.replace(/\.tsx$/, '.meta'),
          source: sceneMetaSource(scene),
        })),
      ];

      try {
        for (const file of files) {
          const destination = path.resolve(stagingDirectory, file.path);
          if (!isInside(stagingDirectory, destination)) {
            throw new MotionCanvasWorkspaceError(
              'MOTION_CANVAS_WORKSPACE_INVALID',
              'Đường dẫn file Motion Canvas nằm ngoài workspace.',
            );
          }
          await mkdir(path.dirname(destination), {recursive: true});
          await writeFile(destination, file.source, 'utf8');
        }

        try {
          await execFileAsync(
            process.execPath,
            [
              typescriptPath,
              '--project',
              path.join(stagingDirectory, 'tsconfig.json'),
            ],
            {
              cwd: repositoryRoot,
              windowsHide: true,
              timeout: Math.min(
                10 * 60_000,
                60_000 + scenes.length * 15_000,
              ),
              maxBuffer: 1024 * 1024,
            },
          );
        } catch (error) {
          const details =
            error && typeof error === 'object' && 'stdout' in error
              ? String(error.stdout).trim().slice(0, 12_000)
              : '';
          throw new MotionCanvasWorkspaceError(
            'MOTION_CANVAS_VALIDATION_FAILED',
            details
              ? `Scene Motion Canvas chưa biên dịch được: ${details.slice(0, 2_000)}`
              : 'Scene Motion Canvas chưa biên dịch được.',
            {cause: error, details},
          );
        }

        const hash = sourceHash(files);
        await writeFile(
          path.join(stagingDirectory, 'pad-studio.manifest.json'),
          `${JSON.stringify(
            {
              generationId,
              motionCanvasVersion: MOTION_CANVAS_VERSION,
              sourceHash: hash,
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
        await commitWorkspace(stagingDirectory, finalDirectory);

        return {
          workspacePath,
          projectFile: 'src/project.ts',
          scenes: scenes.map(({source: _source, ...scene}) => scene),
          validation: {
            validatedAt: new Date().toISOString(),
            sourceHash: hash,
            motionCanvasVersion: MOTION_CANVAS_VERSION,
          },
        };
      } finally {
        await rm(stagingDirectory, {recursive: true, force: true}).catch(
          () => undefined,
        );
      }
    },

    async readFiles(projectId, bundle) {
      const directory = resolveBundleDirectory(projectId, bundle);
      const paths = [
        bundle.projectFile,
        ...bundle.scenes.map((scene) => scene.filePath),
      ];
      return Promise.all(
        paths.map(async (filePath) => ({
          path: filePath,
          source: await readWorkspaceFile(directory, filePath),
        })),
      );
    },

    async readSceneSources(projectId, bundle) {
      const directory = resolveBundleDirectory(projectId, bundle);
      return Promise.all(
        bundle.scenes.map(async (scene) => ({
          ...scene,
          source: await readWorkspaceFile(directory, scene.filePath),
        })),
      );
    },

    async verify(projectId, bundle) {
      const projectRoot = projectDirectory(projectId);
      const directory = resolveBundleDirectory(projectId, bundle);
      let realProjectRoot: string;
      let realDirectory: string;
      try {
        [realProjectRoot, realDirectory] = await Promise.all([
          realpath(projectRoot),
          realpath(directory),
        ]);
      } catch (error) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_WORKSPACE_READ_FAILED',
          'Không thể xác minh workspace Motion Canvas.',
          {cause: error},
        );
      }
      if (!isInside(realProjectRoot, realDirectory)) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_WORKSPACE_INVALID',
          'Workspace Motion Canvas đi qua liên kết không an toàn.',
        );
      }
      const paths = [
        bundle.projectFile,
        'src/project.meta',
        'src/motion-canvas.d.ts',
        'tsconfig.json',
        ...bundle.scenes.flatMap((scene) => [
          scene.filePath,
          scene.filePath.replace(/\.tsx$/, '.meta'),
        ]),
      ];
      const files = await Promise.all(
        paths.map(async (relativePath) => {
          const candidate = path.resolve(directory, relativePath);
          if (!isInside(directory, candidate)) {
            throw new MotionCanvasWorkspaceError(
              'MOTION_CANVAS_WORKSPACE_INVALID',
              'Workspace Motion Canvas chứa đường dẫn file không an toàn.',
            );
          }
          const [realCandidate, entry] = await Promise.all([
            realpath(candidate),
            lstat(candidate),
          ]);
          if (
            !isInside(realDirectory, realCandidate) ||
            entry.isSymbolicLink() ||
            !entry.isFile()
          ) {
            throw new MotionCanvasWorkspaceError(
              'MOTION_CANVAS_WORKSPACE_INVALID',
              `File Motion Canvas “${relativePath}” không an toàn.`,
            );
          }
          return {
            path: relativePath,
            source: await readFile(realCandidate, 'utf8'),
          };
        }),
      );
      const computedHash = sourceHash(files);
      const manifest = await readFile(
        path.join(realDirectory, 'pad-studio.manifest.json'),
        'utf8',
      )
        .then((source) => StoredMotionCanvasManifestSchema.safeParse(
          JSON.parse(source) as unknown,
        ))
        .catch(() => ({success: false as const, error: undefined}));
      if (
        !manifest.success ||
        manifest.data.generationId !== bundle.generation.generationId ||
        manifest.data.motionCanvasVersion !==
          bundle.validation.motionCanvasVersion ||
        manifest.data.sourceHash !== bundle.validation.sourceHash ||
        computedHash !== bundle.validation.sourceHash
      ) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_WORKSPACE_INVALID',
          'Workspace Motion Canvas không còn khớp artifact đã xác minh.',
        );
      }
      return {
        projectDirectory: realProjectRoot,
        workspaceDirectory: realDirectory,
        projectFile: path.join(realDirectory, bundle.projectFile),
        sourceHash: computedHash,
      };
    },
  };
}
