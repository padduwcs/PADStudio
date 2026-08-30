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
import {defaultVideoFrame, type VideoFrame} from '../shared/videoFormat.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {
  MOTION_CANVAS_UNVERIFIED_SEMANTIC_FALLBACK_MARKER,
  MOTION_CANVAS_FAILURE_ATTEMPT_DIAGNOSTICS_MAX_CHARS,
  MOTION_CANVAS_FAILURE_ATTEMPT_MAX_COUNT,
  MOTION_CANVAS_FAILURE_ATTEMPT_SOURCE_MAX_CHARS,
  MOTION_CANVAS_VERSION,
  boundMotionCanvasFailureSourceExcerpt,
  redactMotionCanvasFailureText,
  type MotionCanvasGenerationFailureReason,
  type MotionCanvasFailureRootCause,
  validateMotionCanvasRuntimeSafety,
  type MotionCanvasGenerationAttemptEvidence,
  type MotionCanvasSourceScene,
} from './motionCanvasGenerator.ts';
import {
  extractReferencedMotionCanvasIconIds,
  generateMotionCanvasIconAtlasSource,
  isKnownMotionCanvasIconId,
} from './motionCanvasIconLibrary.ts';
import {normalizeMotionCanvasColorFormats} from './motionCanvasSourceCompatibility.ts';
import type {MotionCanvasVisualEvidence} from './motionCanvasVisualQuality.ts';
import {
  CODEX_APP_SERVER_STDERR_MAX_CHARS,
  type CodexAppServerProcessDiagnostics,
} from './codexConnection.ts';

const execFileAsync = promisify(execFile);
const MAX_STORED_VISUAL_EVIDENCE_FRAMES = 16;
const MAX_STORED_VISUAL_EVIDENCE_BYTES = 32 * 1024 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const staleStagingPattern =
  /^\.staging-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STALE_STAGING_AGE_MS = 6 * 60 * 60 * 1_000;

export interface PreparedMotionCanvasWorkspace {
  workspacePath: string;
  projectFile: 'src/project.ts';
  scenes: MotionCanvasScene[];
  /** Exactly the sources written to disk, after color normalisation, so the
   * rendered-frame gate hashes what the renderer will actually load. */
  sourceScenes: MotionCanvasSourceScene[];
  validation: MotionCanvasBundle['validation'];
  workspaceDirectory: string;
  projectFilePath: string;
}

export interface MotionCanvasWorkspaceFile {
  path: string;
  source: string;
}

export interface MotionCanvasFailureRecord {
  stage: 'compile' | 'render-quality' | 'generation';
  code: string;
  message: string;
  details?: string | null;
  issues?: unknown[];
  /** Redacted structured root cause for failures that happen before a usable source exists. */
  rootCause?: MotionCanvasFailureRootCause | null;
  /** Bounded, model-ready remediation derived from rendered-frame evidence. */
  recoveryGuidance?: string | null;
  /** Bounded direct-TSX failure evidence, retained only in failure artifacts. */
  attempts?: MotionCanvasGenerationAttemptEvidence[];
  /** Rendered frames tied to the blocking visual issues. */
  visualEvidence?: MotionCanvasVisualEvidence[];
  scenes?: MotionCanvasSourceScene[];
}

/** Safe, compact status for the UI; source files and raw diagnostics remain
 * inspectable only in the project failure evidence directory. */
export interface MotionCanvasFailureSummary {
  generationId: string;
  failedAt: string;
  stage: MotionCanvasFailureRecord['stage'];
  code: string;
  message: string;
  firstIssueReason: string | null;
  rootCause?: MotionCanvasFailureRootCause | null;
  /** Safe remediation context that a fresh Codex generation can use. */
  recoveryGuidance: string | null;
}

export interface MotionCanvasWorkspace {
  prepare(
    projectId: string,
    generationId: string,
    scenes: MotionCanvasSourceScene[],
    frame?: VideoFrame,
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
  /** Removes only an unaccepted generation so a quality retry can reuse its id. */
  discard(projectId: string, generationId: string): Promise<void>;
  /** Keeps a bounded, inspectable copy after the transient workspace is removed. */
  recordFailure?(
    projectId: string,
    generationId: string,
    failure: MotionCanvasFailureRecord,
  ): Promise<string>;
  /** Reads the newest retained failure without exposing generated source. */
  readLatestFailure?(
    projectId: string,
  ): Promise<MotionCanvasFailureSummary | null>;
  /** Reloads an exact failed compile/render checkpoint for an idempotent
   * retry. Generation-stage failures are excluded because their scene set may
   * be incomplete. */
  readFailureScenes?(
    projectId: string,
    generationId: string,
  ): Promise<MotionCanvasSourceScene[] | null>;
}

const StoredMotionCanvasManifestSchema = z
  .object({
    generationId: z.string().uuid(),
    motionCanvasVersion: z.string().trim().min(1).max(40),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough();

const StoredCodexAppServerDiagnosticsSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    signal: z.string().max(32).nullable(),
    commandBasename: z.string().max(120).nullable(),
    entrypointBasename: z.string().max(120).nullable(),
    cliVersion: z.string().max(80).nullable(),
    method: z.string().max(80).nullable(),
    pendingMethods: z.array(z.string().max(80)).max(16),
    stderr: z.string().max(CODEX_APP_SERVER_STDERR_MAX_CHARS).nullable(),
  })
  .strict();

const StoredMotionCanvasFailureSchema = z
  .object({
    version: z.literal(1),
    generationId: z.string().uuid(),
    failedAt: z.string().datetime(),
    stage: z.enum(['compile', 'render-quality', 'generation']),
    code: z.string().trim().min(1).max(160),
    message: z.string().trim().min(1).max(2_000),
    issues: z.array(z.object({reason: z.string().trim().min(1).max(600)}).passthrough()).max(64),
    recoveryGuidance: z.string().trim().min(1).max(4_000).nullable().optional(),
    attempts: z.array(z.object({
      phase: z.enum(['initial', 'repair', 'regeneration']),
      model: z.string().trim().min(1).max(160),
      reasoningEffort: z.string().trim().min(1).max(80).nullable(),
      error: z.object({
        code: z.string().trim().min(1).max(160),
        reason: z.string().trim().min(1).max(80).default('unknown'),
        operation: z.string().trim().min(1).max(80).nullable().default(null),
        message: z.string().trim().min(1).max(2_000),
        providerMessage: z.string().max(2_000).nullable().default(null),
        providerCode: z.string().max(120).nullable().default(null),
        diagnostics: z.string().max(MOTION_CANVAS_FAILURE_ATTEMPT_DIAGNOSTICS_MAX_CHARS),
        appServer: StoredCodexAppServerDiagnosticsSchema.nullable().optional().default(null),
      }).strict(),
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
      sourceLength: z.number().int().nonnegative().max(pipelineSafetyLimits.maximumSceneSourceCharacters),
      sourceExcerpt: z.string().max(MOTION_CANVAS_FAILURE_ATTEMPT_SOURCE_MAX_CHARS),
    }).strict()).max(MOTION_CANVAS_FAILURE_ATTEMPT_MAX_COUNT).optional(),
    rootCause: z.object({
      reason: z.string().trim().min(1).max(80),
      code: z.string().trim().min(1).max(160),
      operation: z.string().trim().min(1).max(80).nullable(),
      message: z.string().trim().min(1).max(2_000),
      providerMessage: z.string().max(2_000).nullable(),
      providerCode: z.string().max(120).nullable(),
      appServer: StoredCodexAppServerDiagnosticsSchema.nullable().optional().default(null),
    }).strict().nullable().optional(),
    scenes: z.array(z.unknown()).max(pipelineSafetyLimits.maximumSections).optional(),
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

function projectMetaSource(frame: VideoFrame) {
  return `${JSON.stringify(
    {
      version: 1,
      shared: {
        background: 'rgb(17,31,27)',
        range: [0, null],
        size: {x: frame.width, y: frame.height},
        audioOffset: 0,
      },
      preview: {
        fps: frame.fps,
        resolutionScale: 0.5,
      },
      rendering: {
        fps: frame.fps,
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

function sanitizeFailureAttempt(
  attempt: MotionCanvasGenerationAttemptEvidence,
) {
  return {
    phase: attempt.phase,
    model: redactMotionCanvasFailureText(attempt.model).slice(0, 160) || 'unknown',
    reasoningEffort: attempt.reasoningEffort
      ? redactMotionCanvasFailureText(attempt.reasoningEffort).slice(0, 80) || null
      : null,
    error: {
      code: redactMotionCanvasFailureText(attempt.error.code).slice(0, 160) || 'UNKNOWN_FAILURE',
      reason: redactMotionCanvasFailureText(attempt.error.reason).slice(0, 80) || 'unknown',
      operation: attempt.error.operation
        ? redactMotionCanvasFailureText(attempt.error.operation).slice(0, 80)
        : null,
      message: redactMotionCanvasFailureText(attempt.error.message).slice(0, 2_000) || 'Unknown generation failure.',
      providerMessage: attempt.error.providerMessage
        ? redactMotionCanvasFailureText(attempt.error.providerMessage).slice(0, 2_000)
        : null,
      providerCode: attempt.error.providerCode
        ? redactMotionCanvasFailureText(attempt.error.providerCode).slice(0, 120)
        : null,
      diagnostics: redactMotionCanvasFailureText(attempt.error.diagnostics).slice(
        0,
        MOTION_CANVAS_FAILURE_ATTEMPT_DIAGNOSTICS_MAX_CHARS,
      ),
      appServer: sanitizeFailureProcessDiagnostics(attempt.error.appServer),
    },
    sourceHash: attempt.sourceHash,
    sourceLength: Math.min(
      pipelineSafetyLimits.maximumSceneSourceCharacters,
      Math.max(0, attempt.sourceLength),
    ),
    sourceExcerpt: boundMotionCanvasFailureSourceExcerpt(attempt.sourceExcerpt).slice(
      0,
      MOTION_CANVAS_FAILURE_ATTEMPT_SOURCE_MAX_CHARS,
    ),
  };
}

function sanitizeFailureProcessDiagnostics(
  diagnostics: CodexAppServerProcessDiagnostics | null | undefined,
) {
  if (!diagnostics) return null;
  const boundedText = (value: string | null | undefined, length: number) =>
    value
      ? redactMotionCanvasFailureText(value).slice(0, length) || null
      : null;
  return {
    exitCode: Number.isInteger(diagnostics.exitCode)
      ? diagnostics.exitCode
      : null,
    signal: diagnostics.signal,
    commandBasename: boundedText(diagnostics.commandBasename, 120),
    entrypointBasename: boundedText(diagnostics.entrypointBasename, 120),
    cliVersion: boundedText(diagnostics.cliVersion, 80),
    method: boundedText(diagnostics.method, 80),
    pendingMethods: diagnostics.pendingMethods
      .filter(method => typeof method === 'string')
      .map(method => redactMotionCanvasFailureText(method).slice(0, 80))
      .filter(Boolean)
      .slice(0, 16),
    stderr: boundedText(diagnostics.stderr, CODEX_APP_SERVER_STDERR_MAX_CHARS),
  };
}

function sanitizeFailureJsonValue(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return [];
  try {
    return JSON.parse(redactMotionCanvasFailureText(serialized)) as unknown;
  } catch {
    return [];
  }
}

function sanitizeFailureRootCause(
  rootCause: MotionCanvasFailureRootCause | null | undefined,
) {
  if (!rootCause) return null;
  return {
    reason: redactMotionCanvasFailureText(rootCause.reason).slice(0, 80) || 'unknown',
    code: redactMotionCanvasFailureText(rootCause.code).slice(0, 160) || 'UNKNOWN_FAILURE',
    operation: rootCause.operation
      ? redactMotionCanvasFailureText(rootCause.operation).slice(0, 80)
      : null,
    message: redactMotionCanvasFailureText(rootCause.message).slice(0, 2_000) || 'Unknown generation failure.',
    providerMessage: rootCause.providerMessage
      ? redactMotionCanvasFailureText(rootCause.providerMessage).slice(0, 2_000)
      : null,
    providerCode: rootCause.providerCode
      ? redactMotionCanvasFailureText(rootCause.providerCode).slice(0, 120)
      : null,
    appServer: sanitizeFailureProcessDiagnostics(rootCause.appServer),
  };
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
    async prepare(projectId, generationId, scenes, frame = defaultVideoFrame) {
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
      const normalizedScenes = scenes.map((scene) => ({
        ...scene,
        source: normalizeMotionCanvasColorFormats(scene.source),
      }));

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

      for (const scene of normalizedScenes) {
        try {
          validateMotionCanvasRuntimeSafety(scene.source);
        } catch (error) {
          const details =
            error instanceof Error
              ? `${scene.filePath}: ${error.message}`.slice(0, 12_000)
              : `${scene.filePath}: Scene source không vượt qua runtime safety policy.`;
          throw new MotionCanvasWorkspaceError(
            'MOTION_CANVAS_VALIDATION_FAILED',
            'Scene Motion Canvas có cấu trúc có thể làm treo runtime.',
            {cause: error, details},
          );
        }
      }

      // Codex authors TSX directly and can no longer rely on a backend
      // compiler to resolve icon ids, so this is a defensive backstop:
      // generation-time validation should already have rejected an unknown
      // icon id before a scene ever reaches the workspace.
      const referencedIconIds = [...new Set(
        normalizedScenes.flatMap(scene => extractReferencedMotionCanvasIconIds(scene.source)),
      )];
      const unknownIconIds = referencedIconIds.filter(id => !isKnownMotionCanvasIconId(id));
      if (unknownIconIds.length > 0) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_VALIDATION_FAILED',
          `Scene Motion Canvas tham chiếu icon không tồn tại: ${unknownIconIds.join(', ')}`,
        );
      }

      const files: MotionCanvasWorkspaceFile[] = [
        {path: 'src/project.ts', source: projectSource(normalizedScenes)},
        {path: 'src/project.meta', source: projectMetaSource(frame)},
        {
          path: 'src/motion-canvas.d.ts',
          source: `declare module '*?scene' {
  const value: import('@motion-canvas/core/lib/scenes/Scene').FullSceneDescription;
  export = value;
}

declare type Callback = (...args: any[]) => void;
`,
        },
        {path: 'src/iconAtlas.tsx', source: generateMotionCanvasIconAtlasSource(referencedIconIds)},
        {
          path: 'tsconfig.json',
          source: tsconfigSource(
            storedMotionCanvas2dConfig,
            storedMotionCanvasPackagesPattern,
          ),
        },
        ...normalizedScenes.map((scene) => ({
          path: scene.filePath,
          source: scene.source,
        })),
        ...normalizedScenes.map((scene) => ({
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
                60_000 + normalizedScenes.length * 15_000,
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
          workspaceDirectory: finalDirectory,
          projectFilePath: path.join(finalDirectory, 'src/project.ts'),
          scenes: normalizedScenes.map(({source: _source, ...scene}) => scene),
          sourceScenes: normalizedScenes,
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
        'src/iconAtlas.tsx',
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

    async recordFailure(projectId, generationId, failure) {
      assertProjectId(projectId);
      if (!uuidPattern.test(generationId)) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_WORKSPACE_INVALID',
          'Generation ID không hợp lệ.',
        );
      }
      const root = projectDirectory(projectId);
      const failuresRoot = path.join(root, 'motion-canvas', 'failures');
      const target = path.join(failuresRoot, generationId);
      if (!isInside(root, target)) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_WORKSPACE_INVALID',
          'Thư mục bằng chứng lỗi nằm ngoài project.',
        );
      }
      await rm(target, {recursive: true, force: true});
      await mkdir(path.join(target, 'scenes'), {recursive: true});
      const scenes = failure.scenes ?? [];
      const attempts = (failure.attempts ?? [])
        .slice(0, MOTION_CANVAS_FAILURE_ATTEMPT_MAX_COUNT)
        .map(sanitizeFailureAttempt);
      const framesDirectory = path.join(target, 'frames');
      await mkdir(framesDirectory, {recursive: true});
      const visualEvidence = (failure.visualEvidence ?? [])
        .slice(0, MAX_STORED_VISUAL_EVIDENCE_FRAMES)
        .filter(evidence =>
          Buffer.isBuffer(evidence.png) &&
          evidence.png.length <= MAX_STORED_VISUAL_EVIDENCE_BYTES,
        )
        .map((evidence, index) => ({
          evidence,
          filename: `${String(index + 1).padStart(2, '0')}-${evidence.sceneId}-${evidence.beatId}-${evidence.phase}-${evidence.frame}.png`,
        }));
      await Promise.all(
        scenes.map((scene, index) =>
          writeFile(
            path.join(
              target,
              'scenes',
              `${String(index + 1).padStart(2, '0')}-${scene.id}.tsx`,
            ),
            redactMotionCanvasFailureText(scene.source),
            'utf8',
          ),
        ),
      );
      await Promise.all(
        visualEvidence.map(({evidence, filename}) =>
          writeFile(path.join(framesDirectory, filename), evidence.png),
        ),
      );
      await writeFile(
        path.join(framesDirectory, 'manifest.json'),
        `${JSON.stringify({
          version: 1,
          frames: visualEvidence.map(({evidence, filename}) => ({
            file: `frames/${filename}`,
            sceneId: evidence.sceneId,
            beatId: evidence.beatId,
            phase: evidence.phase,
            frame: evidence.frame,
            timeSeconds: evidence.timeSeconds,
            issueCodes: [...new Set(evidence.issues.map(issue => issue.code))],
            issues: sanitizeFailureJsonValue(evidence.issues),
            nodes: sanitizeFailureJsonValue(evidence.nodes),
          })),
        }, null, 2)}\n`,
        'utf8',
      );
      await writeFile(
        path.join(target, 'failure.json'),
        `${JSON.stringify({
          version: 1,
          generationId,
          failedAt: new Date().toISOString(),
          stage: failure.stage,
          code: redactMotionCanvasFailureText(failure.code).slice(0, 160),
          message: redactMotionCanvasFailureText(failure.message).slice(0, 2_000),
          details: failure.details
            ? redactMotionCanvasFailureText(failure.details).slice(0, 12_000)
            : null,
          issues: sanitizeFailureJsonValue(failure.issues ?? []),
          recoveryGuidance: failure.recoveryGuidance
            ? redactMotionCanvasFailureText(failure.recoveryGuidance).slice(0, 4_000)
            : null,
          attempts,
          rootCause: sanitizeFailureRootCause(failure.rootCause),
          visualEvidence: {
            manifest: 'frames/manifest.json',
            frameCount: visualEvidence.length,
          },
          scenes: scenes.map(({source: _source, ...scene}) => scene),
        }, null, 2)}\n`,
        'utf8',
      );

      const stored = await readdir(failuresRoot, {withFileTypes: true});
      const dated = await Promise.all(
        stored
          .filter(entry => entry.isDirectory() && uuidPattern.test(entry.name))
          .map(async entry => ({
            name: entry.name,
            modified: (await stat(path.join(failuresRoot, entry.name))).mtimeMs,
          })),
      );
      for (const old of dated.sort((a, b) => b.modified - a.modified).slice(5)) {
        await rm(path.join(failuresRoot, old.name), {
          recursive: true,
          force: true,
        });
      }
      return target;
    },

    async readLatestFailure(projectId) {
      assertProjectId(projectId);
      const root = projectDirectory(projectId);
      const failuresRoot = path.join(root, 'motion-canvas', 'failures');
      let entries;
      try {
        entries = await readdir(failuresRoot, {withFileTypes: true});
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      const candidates = await Promise.all(
        entries
          .filter(entry => entry.isDirectory() && uuidPattern.test(entry.name))
          .map(async entry => ({
            generationId: entry.name,
            modified: (await stat(path.join(failuresRoot, entry.name))).mtimeMs,
          })),
      );
      for (const candidate of candidates.sort((left, right) => right.modified - left.modified)) {
        const failurePath = path.join(
          failuresRoot,
          candidate.generationId,
          'failure.json',
        );
        let parsed;
        try {
          parsed = StoredMotionCanvasFailureSchema.safeParse(
            JSON.parse(await readFile(failurePath, 'utf8')),
          );
        } catch {
          continue;
        }
        if (!parsed.success) continue;
        return {
          generationId: parsed.data.generationId,
          failedAt: parsed.data.failedAt,
          stage: parsed.data.stage,
          code: parsed.data.code,
          message: parsed.data.message,
          firstIssueReason: parsed.data.issues[0]?.reason ?? null,
          rootCause: parsed.data.rootCause
            ? {
                ...parsed.data.rootCause,
                reason: parsed.data.rootCause.reason as MotionCanvasGenerationFailureReason,
              }
            : null,
          recoveryGuidance: parsed.data.recoveryGuidance ?? null,
        };
      }
      return null;
    },

    async readFailureScenes(projectId, generationId) {
      assertProjectId(projectId);
      if (!uuidPattern.test(generationId)) {
        throw new MotionCanvasWorkspaceError('MOTION_CANVAS_WORKSPACE_INVALID', 'Generation ID không hợp lệ.');
      }
      const root = projectDirectory(projectId);
      const failureRoot = path.join(root, 'motion-canvas', 'failures', generationId);
      if (!isInside(root, failureRoot)) {
        throw new MotionCanvasWorkspaceError('MOTION_CANVAS_WORKSPACE_INVALID', 'Checkpoint lỗi nằm ngoài project.');
      }
      let parsed;
      try {
        parsed = StoredMotionCanvasFailureSchema.safeParse(
          JSON.parse(await readFile(path.join(failureRoot, 'failure.json'), 'utf8')),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      if (
        !parsed.success ||
        parsed.data.generationId !== generationId ||
        parsed.data.stage === 'generation' ||
        !parsed.data.scenes?.length
      ) return null;
      const metadata = parsed.data.scenes.map(scene => MotionCanvasSceneSchema.safeParse(scene));
      if (metadata.some(scene => !scene.success)) return null;
      const scenes: MotionCanvasSourceScene[] = [];
      for (const [index, result] of metadata.entries()) {
        const scene = result.data!;
        const sourcePath = path.join(
          failureRoot,
          'scenes',
          `${String(index + 1).padStart(2, '0')}-${scene.id}.tsx`,
        );
        const source = await readFile(sourcePath, 'utf8');
        scenes.push({...scene, source});
      }
      return scenes;
    },

    async discard(projectId, generationId) {
      assertProjectId(projectId);
      if (!uuidPattern.test(generationId)) {
        throw new MotionCanvasWorkspaceError('MOTION_CANVAS_WORKSPACE_INVALID', 'Generation ID không hợp lệ.');
      }
      const root = projectDirectory(projectId);
      const target = path.join(root, 'motion-canvas', 'generations', generationId);
      if (!isInside(root, target)) throw new MotionCanvasWorkspaceError('MOTION_CANVAS_WORKSPACE_INVALID', 'Workspace Motion Canvas nằm ngoài project.');
      await rm(target, {recursive: true, force: true});
    },
  };
}
