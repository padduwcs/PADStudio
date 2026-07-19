import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {createRequire} from 'node:module';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  LayoutEditorManifestSchema,
  type LayoutBundle,
  type LayoutEditorManifest,
  type LayoutOverridesDocument,
} from '../shared/layout.ts';
import type {AnimationSyncBundle} from '../shared/topic.ts';
import {
  createLayoutWorkspace,
  LayoutWorkspaceError,
} from './layoutWorkspace.ts';
import {copyPreviewWorkspace} from './previewWorkspaceCopy.ts';

const MANIFEST_CAPTURE_PATH = '/__pad_layout_manifest';
const OVERRIDES_PATH = '/__pad_layout_overrides';
const EDITOR_MANIFEST_PATH = '/__pad_layout_editor_manifest';
const MAXIMUM_MANIFEST_BYTES = 512 * 1024;

interface PreviewRuntimeServer {
  resolvedUrls: {local: string[]; network: string[]} | null;
  httpServer?: {listening: boolean} | null;
  listen(): Promise<PreviewRuntimeServer>;
  close(): Promise<void>;
  transformRequest(url: string): Promise<unknown>;
}

interface PreviewRuntime {
  createServer(config: Record<string, unknown>): Promise<PreviewRuntimeServer>;
  motionCanvas: (config: Record<string, unknown>) => unknown[];
}

interface MiddlewareServer {
  middlewares: {
    use(
      handler: (
        request: IncomingMessage,
        response: ServerResponse,
        next: () => void,
      ) => void,
    ): void;
  };
}

interface ActivePreview {
  identity: string;
  generationId: string;
  sourceSyncGenerationId: string;
  sourceSyncContentRevision: number;
  sourceSyncSourceHash: string;
  sourceWorkspaceHash: string;
  parentOrigin: string;
  sessionNonce: string;
  lastAccessedAt: number;
  cacheDirectory: string;
  promise: Promise<LayoutPreview>;
  server: PreviewRuntimeServer | null;
  overrides: LayoutOverridesDocument;
  manifestSeed: LayoutEditorManifest;
  manifest: LayoutEditorManifest | null;
}

export interface LayoutPreview {
  generationId: string;
  sourceSyncGenerationId: string;
  sessionNonce: string;
  url: string;
}

export interface LayoutPreviewService {
  start(
    projectId: string,
    animationSyncBundle: AnimationSyncBundle,
    layoutBundle: LayoutBundle | null,
    options: {parentOrigin: string},
  ): Promise<LayoutPreview>;
  getManifest(
    projectId: string,
    sessionNonce: string,
    sourceSyncGenerationId: string,
  ): LayoutEditorManifest;
  getSourceWorkspaceHash(
    projectId: string,
    sessionNonce: string,
    sourceSyncGenerationId: string,
  ): string;
  close(): Promise<void>;
}

export class LayoutPreviewError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function isInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

function assertProjectId(projectId: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId)) {
    throw new LayoutPreviewError(
      'LAYOUT_PREVIEW_INVALID',
      'Project ID của Layout preview không hợp lệ.',
    );
  }
}

function normalizeParentOrigin(value: string) {
  if (typeof value !== 'string' || value.length > 320) {
    throw new LayoutPreviewError(
      'LAYOUT_PREVIEW_PARENT_ORIGIN_INVALID',
      'Origin của Layout Editor không hợp lệ.',
    );
  }
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.origin !== value ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('invalid origin');
    }
    return url.origin;
  } catch (error) {
    throw new LayoutPreviewError(
      'LAYOUT_PREVIEW_PARENT_ORIGIN_INVALID',
      'Origin của Layout Editor phải là HTTP(S) origin chính xác.',
      {cause: error},
    );
  }
}

function moduleUrl(filePath: string, query = '') {
  return `/@fs/${filePath.replaceAll('\\', '/')}${query}`;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function canonicalHash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(value)))
    .digest('hex');
}

function safeTokenEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isLoopbackAddress(address: string | undefined) {
  if (!address) return false;
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address.startsWith('::ffff:127.')
  );
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
) {
  const source = `${JSON.stringify(value)}\n`;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(source);
}

async function readBoundedJson(request: IncomingMessage) {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > MAXIMUM_MANIFEST_BYTES
  ) {
    throw new LayoutPreviewError(
      'LAYOUT_PREVIEW_MANIFEST_TOO_LARGE',
      'Layout manifest vượt quá giới hạn cho phép.',
    );
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAXIMUM_MANIFEST_BYTES) {
      throw new LayoutPreviewError(
        'LAYOUT_PREVIEW_MANIFEST_TOO_LARGE',
        'Layout manifest vượt quá giới hạn cho phép.',
      );
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    throw new LayoutPreviewError(
      'LAYOUT_PREVIEW_MANIFEST_INVALID',
      'Layout manifest gửi từ runtime không phải JSON hợp lệ.',
      {cause: error},
    );
  }
}

function validateManifestEnvelope(
  value: unknown,
  entry: ActivePreview,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LayoutPreviewError(
      'LAYOUT_PREVIEW_MANIFEST_INVALID',
      'Envelope của Layout manifest không hợp lệ.',
    );
  }
  const envelope = value as Record<string, unknown>;
  const expectedKeys = [
    'generationId',
    'manifest',
    'sessionNonce',
    'sourceSyncGenerationId',
  ];
  if (
    Object.keys(envelope).sort().join('\0') !== expectedKeys.join('\0') ||
    typeof envelope.sessionNonce !== 'string' ||
    !safeTokenEqual(envelope.sessionNonce, entry.sessionNonce) ||
    envelope.generationId !== entry.generationId ||
    envelope.sourceSyncGenerationId !== entry.sourceSyncGenerationId
  ) {
    throw new LayoutPreviewError(
      'LAYOUT_PREVIEW_SESSION_MISMATCH',
      'Layout manifest không thuộc đúng preview session.',
    );
  }
  const parsed = LayoutEditorManifestSchema.safeParse(envelope.manifest);
  if (
    !parsed.success ||
    parsed.data.sourceAnimationSyncGenerationId !==
      entry.sourceSyncGenerationId ||
    parsed.data.sourceAnimationSyncContentRevision !==
      entry.sourceSyncContentRevision ||
    parsed.data.sourceAnimationSyncSourceHash !== entry.sourceSyncSourceHash
  ) {
    throw new LayoutPreviewError(
      'LAYOUT_PREVIEW_MANIFEST_SOURCE_MISMATCH',
      'Layout manifest không khớp bản đồng bộ của preview.',
      {cause: parsed.success ? undefined : parsed.error},
    );
  }
  return normalizeManifest(parsed.data, entry.manifestSeed);
}

function normalizeManifest(
  manifest: LayoutEditorManifest,
  seed: LayoutEditorManifest,
): LayoutEditorManifest {
  const scenes = new Map(
    manifest.scenes.map((scene) => [scene.sceneId, scene]),
  );
  if (
    manifest.scenes.length !== seed.scenes.length ||
    manifest.scenes.some(
      (scene) =>
        !seed.scenes.some(
          (seedScene) =>
            seedScene.sceneId === scene.sceneId &&
            seedScene.filePath === scene.filePath,
        ),
    )
  ) {
    throw new LayoutPreviewError(
      'LAYOUT_PREVIEW_MANIFEST_SOURCE_MISMATCH',
      'Danh sách scene của runtime không khớp bản đồng bộ.',
    );
  }
  return {
    ...manifest,
    scenes: seed.scenes.map((seedScene) => {
      const scene = scenes.get(seedScene.sceneId);
      if (!scene || scene.filePath !== seedScene.filePath) {
        throw new LayoutPreviewError(
          'LAYOUT_PREVIEW_MANIFEST_SOURCE_MISMATCH',
          'Runtime không trả đủ scene của bản đồng bộ.',
        );
      }
      return {
        ...scene,
        nodes: [...scene.nodes]
          .map((node) => ({
            ...node,
            editableProperties: [...node.editableProperties].sort(),
            lockedProperties: [...node.lockedProperties].sort(),
          }))
          .sort((left, right) => left.key.localeCompare(right.key)),
      };
    }),
  };
}

function mergeManifest(
  existing: LayoutEditorManifest | null,
  incoming: LayoutEditorManifest,
  seed: LayoutEditorManifest,
) {
  if (!existing) return normalizeManifest(incoming, seed);
  const normalizedExisting = normalizeManifest(existing, seed);
  const normalizedIncoming = normalizeManifest(incoming, seed);
  return {
    ...normalizedIncoming,
    scenes: normalizedIncoming.scenes.map((scene, sceneIndex) => {
      const previousScene = normalizedExisting.scenes[sceneIndex]!;
      const incomingNodes = new Map(
        scene.nodes.map((node) => [node.key, node]),
      );
      for (const previousNode of previousScene.nodes) {
        const nextNode = incomingNodes.get(previousNode.key);
        if (!nextNode) {
          incomingNodes.set(previousNode.key, previousNode);
          continue;
        }
        if (
          nextNode.fingerprint !== previousNode.fingerprint ||
          nextNode.nodeType !== previousNode.nodeType ||
          nextNode.parentKey !== previousNode.parentKey ||
          nextNode.identity !== previousNode.identity ||
          JSON.stringify(nextNode.editableProperties) !==
            JSON.stringify(previousNode.editableProperties) ||
          JSON.stringify(nextNode.lockedProperties) !==
            JSON.stringify(previousNode.lockedProperties) ||
          nextNode.lockReason !== previousNode.lockReason
        ) {
          throw new LayoutPreviewError(
            'LAYOUT_PREVIEW_MANIFEST_CHANGED',
            `Node “${nextNode.key}” đã đổi định danh hoặc chính sách chỉnh sửa trong cùng nguồn Sync.`,
          );
        }
      }
      return {
        ...scene,
        nodes: [...incomingNodes.values()].sort((left, right) =>
          left.key.localeCompare(right.key),
        ),
      };
    }),
  } satisfies LayoutEditorManifest;
}

function queryMatchesEntry(url: URL, entry: ActivePreview) {
  const session = url.searchParams.get('session');
  return (
    typeof session === 'string' &&
    safeTokenEqual(session, entry.sessionNonce) &&
    url.searchParams.get('generation') === entry.generationId &&
    url.searchParams.get('sourceSyncGeneration') ===
      entry.sourceSyncGenerationId
  );
}

function sessionDataUrl(pathname: string, entry: ActivePreview) {
  const search = new URLSearchParams({
    session: entry.sessionNonce,
    generation: entry.generationId,
    sourceSyncGeneration: entry.sourceSyncGenerationId,
  });
  return `${pathname}?${search.toString()}`;
}

function createSessionPlugin(entry: ActivePreview) {
  return {
    name: 'pad-studio-layout-session',
    configureServer(server: MiddlewareServer) {
      server.middlewares.use((request, response, next) => {
        response.setHeader(
          'Content-Security-Policy',
          `frame-ancestors ${entry.parentOrigin}`,
        );
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        const handle = async () => {
          if (!request.url) {
            next();
            return;
          }
          const url = new URL(request.url, 'http://127.0.0.1');
          if (
            ![
              MANIFEST_CAPTURE_PATH,
              OVERRIDES_PATH,
              EDITOR_MANIFEST_PATH,
            ].includes(url.pathname)
          ) {
            next();
            return;
          }
          if (!isLoopbackAddress(request.socket.remoteAddress)) {
            sendJson(response, 403, {
              error: {code: 'LAYOUT_PREVIEW_LOOPBACK_REQUIRED'},
            });
            return;
          }

          if (
            url.pathname === OVERRIDES_PATH ||
            url.pathname === EDITOR_MANIFEST_PATH
          ) {
            if (request.method !== 'GET') {
              sendJson(response, 405, {
                error: {code: 'METHOD_NOT_ALLOWED'},
              });
              return;
            }
            if (!queryMatchesEntry(url, entry)) {
              sendJson(response, 403, {
                error: {code: 'LAYOUT_PREVIEW_SESSION_MISMATCH'},
              });
              return;
            }
            if (url.pathname === OVERRIDES_PATH) {
              sendJson(response, 200, entry.overrides);
              return;
            }
            sendJson(
              response,
              200,
              entry.manifest ?? entry.manifestSeed,
            );
            return;
          }

          if (request.method !== 'POST') {
            sendJson(response, 405, {
              error: {code: 'METHOD_NOT_ALLOWED'},
            });
            return;
          }
          const contentType = String(
            request.headers['content-type'] ?? '',
          ).toLowerCase();
          if (!contentType.startsWith('application/json')) {
            sendJson(response, 415, {
              error: {code: 'JSON_CONTENT_TYPE_REQUIRED'},
            });
            return;
          }
          const manifest = validateManifestEnvelope(
            await readBoundedJson(request),
            entry,
          );
          entry.manifest = mergeManifest(
            entry.manifest,
            manifest,
            entry.manifestSeed,
          );
          sendJson(response, 200, {ok: true});
        };

        void handle().catch((error) => {
          if (response.writableEnded) return;
          const layoutError =
            error instanceof LayoutPreviewError
              ? error
              : new LayoutPreviewError(
                  'LAYOUT_PREVIEW_MANIFEST_CAPTURE_FAILED',
                  'Không thể ghi nhận node manifest từ runtime.',
                  {cause: error},
                );
          const status =
            layoutError.code === 'LAYOUT_PREVIEW_MANIFEST_TOO_LARGE'
              ? 413
              : layoutError.code ===
                    'LAYOUT_PREVIEW_MANIFEST_CHANGED'
                ? 409
                : 400;
          sendJson(response, status, {
            error: {
              code: layoutError.code,
              message: layoutError.message,
            },
          });
        });
      });
    },
  };
}

async function closeRuntimeServer(server: PreviewRuntimeServer) {
  const closing = server.close();
  await Promise.race([closing, delay(2_000)]);
}

export function createLayoutPreviewService(
  projectsDirectory: string,
  options: {
    maximumActivePreviews?: number;
  } = {},
): LayoutPreviewService {
  const artifactWorkspace = createLayoutWorkspace(projectsDirectory);
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const runtimePackage = path.join(
    repositoryRoot,
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
  const motionCanvasEntry = runtimeRequire.resolve(
    '@motion-canvas/vite-plugin',
  );
  const layoutEditorEntry = path.join(
    repositoryRoot,
    'motion-canvas-runtime',
    'layout-editor',
    'main.js',
  );
  const temporaryRoot = path.join(repositoryRoot, 'tmp', 'layout-previews');
  const maximumActivePreviews = Math.max(
    1,
    Math.min(4, options.maximumActivePreviews ?? 2),
  );
  const previews = new Map<string, ActivePreview>();
  const projectStartOperations = new Map<string, Promise<void>>();
  let runtimePromise: Promise<PreviewRuntime> | null = null;
  let closed = false;

  async function withProjectStartLock<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous =
      projectStartOperations.get(projectId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous
      .catch(() => undefined)
      .then(() => gate);
    projectStartOperations.set(projectId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (projectStartOperations.get(projectId) === tail) {
        projectStartOperations.delete(projectId);
      }
    }
  }

  async function loadRuntime(): Promise<PreviewRuntime> {
    runtimePromise ??= Promise.all([
      import(pathToFileURL(viteEntry).href),
      import(pathToFileURL(motionCanvasEntry).href),
    ]).then(([viteModule, motionCanvasModule]) => {
      const candidate = motionCanvasModule.default as
        | ((config: Record<string, unknown>) => unknown[])
        | {default?: (config: Record<string, unknown>) => unknown[]};
      const motionCanvas =
        typeof candidate === 'function' ? candidate : candidate?.default;
      if (
        typeof viteModule.createServer !== 'function' ||
        typeof motionCanvas !== 'function'
      ) {
        throw new LayoutPreviewError(
          'LAYOUT_PREVIEW_RUNTIME_UNAVAILABLE',
          'Motion Canvas Layout preview runtime chưa sẵn sàng.',
        );
      }
      return {
        createServer: viteModule.createServer as PreviewRuntime['createServer'],
        motionCanvas,
      };
    });
    return runtimePromise;
  }

  async function resolveSource(
    projectId: string,
    syncBundle: AnimationSyncBundle,
    layoutBundle: LayoutBundle | null,
  ) {
    assertProjectId(projectId);
    try {
      const verified = await artifactWorkspace.verify(
        projectId,
        syncBundle,
        layoutBundle,
      );
      return {
        projectDirectory: verified.projectDirectory,
        workspaceDirectory: verified.sourceWorkspaceDirectory,
        projectFile: verified.projectFile,
        sourceWorkspaceHash: verified.sourceWorkspaceHash,
        layoutWorkspaceDirectory:
          verified.layoutWorkspaceDirectory,
        generationId:
          layoutBundle?.generation.generationId ??
          syncBundle.generation.generationId,
        overrides: verified.overrides,
        manifest: verified.editorManifest,
      };
    } catch (error) {
      if (error instanceof LayoutPreviewError) throw error;
      const workspaceError =
        error instanceof LayoutWorkspaceError ? error : null;
      const sourceError =
        workspaceError?.code.startsWith('LAYOUT_SOURCE_') ?? false;
      const code = sourceError
        ? workspaceError?.code === 'LAYOUT_SOURCE_NOT_APPROVED'
          ? 'LAYOUT_PREVIEW_SOURCE_NOT_APPROVED'
          : workspaceError?.code === 'LAYOUT_SOURCE_MANIFEST_MISMATCH'
            ? 'LAYOUT_PREVIEW_SOURCE_MISMATCH'
            : 'LAYOUT_PREVIEW_SOURCE_INVALID'
        : layoutBundle
          ? 'LAYOUT_PREVIEW_LAYOUT_INTEGRITY_FAILED'
          : 'LAYOUT_PREVIEW_SOURCE_INVALID';
      throw new LayoutPreviewError(
        code,
        sourceError
          ? workspaceError?.message ??
            'Không thể xác minh toàn vẹn source của bản đồng bộ.'
          : 'Dữ liệu Layout workspace không khớp bundle.',
        {cause: error},
      );
    }
  }

  async function closePreview(entry: ActivePreview) {
    const server = entry.server;
    if (server) {
      await closeRuntimeServer(server).catch(() => undefined);
    } else {
      await entry.promise.catch(() => undefined);
      if (entry.server) {
        await closeRuntimeServer(entry.server).catch(() => undefined);
      }
    }
    if (isInside(temporaryRoot, entry.cacheDirectory)) {
      await rm(entry.cacheDirectory, {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
  }

  async function trimPreviews(currentProjectId: string) {
    if (previews.size <= maximumActivePreviews) return;
    const candidates = [...previews.entries()]
      .filter(([projectId]) => projectId !== currentProjectId)
      .sort(
        ([, left], [, right]) =>
          left.lastAccessedAt - right.lastAccessedAt,
      );
    const oldest = candidates[0];
    if (!oldest) return;
    previews.delete(oldest[0]);
    await closePreview(oldest[1]);
  }

  async function createPreview(
    source: Awaited<ReturnType<typeof resolveSource>>,
    entry: ActivePreview,
  ) {
    entry.overrides = source.overrides;
    entry.sourceWorkspaceHash = source.sourceWorkspaceHash;
    entry.manifest = source.manifest
      ? normalizeManifest(source.manifest, entry.manifestSeed)
      : null;
    const projectRelativePath = path.relative(
      source.workspaceDirectory,
      source.projectFile,
    );
    const previewWorkspaceDirectory = path.join(
      entry.cacheDirectory,
      'source',
      'workspace',
    );
    const previewProjectFile = path.join(
      previewWorkspaceDirectory,
      projectRelativePath,
    );
    const runtime = await loadRuntime();
    await rm(entry.cacheDirectory, {recursive: true, force: true});
    await mkdir(path.dirname(previewWorkspaceDirectory), {
      recursive: true,
    });

    let server: PreviewRuntimeServer | null = null;
    try {
      await copyPreviewWorkspace(
        source.workspaceDirectory,
        previewWorkspaceDirectory,
      );
      server = await runtime.createServer({
        configFile: false,
        root: previewWorkspaceDirectory,
        cacheDir: path.join(entry.cacheDirectory, 'vite-cache'),
        logLevel: 'error',
        appType: 'custom',
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
              repositoryRoot,
              'node_modules',
              '@motion-canvas',
              'core',
            ),
            '@motion-canvas/2d': path.join(
              repositoryRoot,
              'node_modules',
              '@motion-canvas',
              '2d',
            ),
          },
        },
        define: {
          'process.env.PAD_MOTION_PREVIEW_ONLY': JSON.stringify('true'),
          'process.env.PAD_MOTION_LAYOUT_EDITOR': JSON.stringify('true'),
        },
        plugins: [
          createSessionPlugin(entry),
          ...runtime.motionCanvas({
            project: previewProjectFile.replaceAll('\\', '/'),
            output: path.join(entry.cacheDirectory, 'render-output'),
            editor: layoutEditorEntry.replaceAll('\\', '/'),
            bufferedAssets: false,
          }),
        ],
        server: {
          host: '127.0.0.1',
          port: 0,
          strictPort: false,
          hmr: false,
          headers: {
            'Content-Security-Policy':
              `frame-ancestors ${entry.parentOrigin}`,
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
          },
          fs: {
            allow: [
              repositoryRoot,
              previewWorkspaceDirectory,
            ],
          },
        },
      });
      entry.server = server;
      await server.listen();

      const transformedEditor = await server.transformRequest(
        moduleUrl(layoutEditorEntry),
      );
      const transformedProject = await server.transformRequest(
        moduleUrl(previewProjectFile, '?project'),
      );
      if (!transformedEditor || !transformedProject) {
        throw new LayoutPreviewError(
          'LAYOUT_PREVIEW_VALIDATION_FAILED',
          'Không thể tải Layout Editor hoặc project đồng bộ.',
        );
      }

      const localUrl = server.resolvedUrls?.local[0];
      if (!localUrl) {
        throw new LayoutPreviewError(
          'LAYOUT_PREVIEW_START_FAILED',
          'Layout preview runtime không cung cấp URL local.',
        );
      }
      const url = new URL(localUrl);
      url.searchParams.set('generation', entry.generationId);
      url.searchParams.set('session', entry.sessionNonce);
      url.searchParams.set(
        'sourceSyncGeneration',
        entry.sourceSyncGenerationId,
      );
      url.searchParams.set(
        'sourceSyncContentRevision',
        String(entry.sourceSyncContentRevision),
      );
      url.searchParams.set(
        'sourceSyncSourceHash',
        entry.sourceSyncSourceHash,
      );
      url.searchParams.set('parentOrigin', entry.parentOrigin);
      url.searchParams.set(
        'overrides',
        sessionDataUrl(OVERRIDES_PATH, entry),
      );
      url.searchParams.set(
        'manifest',
        sessionDataUrl(EDITOR_MANIFEST_PATH, entry),
      );
      return {
        generationId: entry.generationId,
        sourceSyncGenerationId: entry.sourceSyncGenerationId,
        sessionNonce: entry.sessionNonce,
        url: url.toString(),
      };
    } catch (error) {
      if (server) {
        await closeRuntimeServer(server).catch(() => undefined);
      }
      entry.server = null;
      if (isInside(temporaryRoot, entry.cacheDirectory)) {
        await rm(entry.cacheDirectory, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
      if (error instanceof LayoutPreviewError) throw error;
      throw new LayoutPreviewError(
        'LAYOUT_PREVIEW_START_FAILED',
        'Không thể khởi động Motion Canvas Layout Editor.',
        {cause: error},
      );
    }
  }

  return {
    async start(
      projectId,
      animationSyncBundle,
      layoutBundle,
      startOptions,
    ) {
      assertProjectId(projectId);
      return withProjectStartLock(projectId, async () => {
        if (closed) {
          throw new LayoutPreviewError(
            'LAYOUT_PREVIEW_CLOSED',
            'Layout preview runtime đã dừng.',
          );
        }
        const parentOrigin = normalizeParentOrigin(
          startOptions.parentOrigin,
        );
        let resolvedSource: Awaited<ReturnType<typeof resolveSource>>;
        try {
          resolvedSource = await resolveSource(
            projectId,
            animationSyncBundle,
            layoutBundle,
          );
        } catch (error) {
          const invalidated = previews.get(projectId);
          if (invalidated) {
            previews.delete(projectId);
            await closePreview(invalidated);
          }
          throw error;
        }
        if (closed) {
          throw new LayoutPreviewError(
            'LAYOUT_PREVIEW_CLOSED',
            'Layout preview runtime đã dừng.',
          );
        }
        const generationId =
          layoutBundle?.generation.generationId ??
          animationSyncBundle.generation.generationId;
        const identity = canonicalHash({
          projectId,
          generationId,
          sourceSyncGenerationId:
            animationSyncBundle.generation.generationId,
          sourceSyncContentRevision:
            animationSyncBundle.contentRevision,
          sourceSyncSourceHash:
            animationSyncBundle.validation.sourceHash,
          sourceWorkspaceHash: resolvedSource.sourceWorkspaceHash,
          layoutOverridesHash:
            layoutBundle?.validation.overridesHash ?? null,
          layoutManifestHash:
            layoutBundle?.validation.manifestHash ?? null,
          parentOrigin,
        });
        const existing = previews.get(projectId);
        if (existing?.identity === identity) {
          try {
            existing.lastAccessedAt = Date.now();
            const preview = await existing.promise;
            if (previews.get(projectId) !== existing) {
              throw new LayoutPreviewError(
                'LAYOUT_PREVIEW_SUPERSEDED',
                'Layout preview đã được thay bằng một session mới.',
              );
            }
            if (
              existing.server &&
              existing.server.httpServer?.listening !== false
            ) {
              return preview;
            }
          } catch (error) {
            if (previews.get(projectId) === existing) {
              previews.delete(projectId);
            }
            await closePreview(existing);
            throw error;
          }
          if (previews.get(projectId) === existing) {
            previews.delete(projectId);
          }
          await closePreview(existing);
        }
        if (existing && previews.get(projectId) === existing) {
          previews.delete(projectId);
          await closePreview(existing);
        }

        const sessionNonce = randomBytes(32).toString('base64url');
        const cacheDirectory = path.join(
          temporaryRoot,
          identity.slice(0, 32),
        );
        const entry: ActivePreview = {
          identity,
          generationId,
          sourceSyncGenerationId:
            animationSyncBundle.generation.generationId,
          sourceSyncContentRevision:
            animationSyncBundle.contentRevision,
          sourceSyncSourceHash:
            animationSyncBundle.validation.sourceHash,
          sourceWorkspaceHash: resolvedSource.sourceWorkspaceHash,
          parentOrigin,
          sessionNonce,
          lastAccessedAt: Date.now(),
          cacheDirectory,
          promise: Promise.resolve(null as never),
          server: null,
          overrides: {
            version: 1,
            sourceAnimationSyncGenerationId:
              animationSyncBundle.generation.generationId,
            sourceAnimationSyncContentRevision:
              animationSyncBundle.contentRevision,
            sourceAnimationSyncSourceHash:
              animationSyncBundle.validation.sourceHash,
            overrides: [],
          },
          manifestSeed: {
            version: 1,
            sourceAnimationSyncGenerationId:
              animationSyncBundle.generation.generationId,
            sourceAnimationSyncContentRevision:
              animationSyncBundle.contentRevision,
            sourceAnimationSyncSourceHash:
              animationSyncBundle.validation.sourceHash,
            scenes: animationSyncBundle.sections.map((section) => ({
              sceneId: section.sceneId,
              filePath: section.filePath,
              nodes: [],
            })),
          },
          manifest: null,
        };
        entry.promise = createPreview(
          resolvedSource,
          entry,
        ).catch((error) => {
          if (previews.get(projectId) === entry) {
            previews.delete(projectId);
          }
          throw error;
        });
        previews.set(projectId, entry);
        await trimPreviews(projectId);
        const preview = await entry.promise;
        if (previews.get(projectId) !== entry) {
          throw new LayoutPreviewError(
            'LAYOUT_PREVIEW_SUPERSEDED',
            'Layout preview đã được thay bằng một session mới.',
          );
        }
        return preview;
      });
    },

    getManifest(projectId, sessionNonce, sourceSyncGenerationId) {
      assertProjectId(projectId);
      const entry = previews.get(projectId);
      if (
        !entry ||
        !safeTokenEqual(entry.sessionNonce, sessionNonce) ||
        entry.sourceSyncGenerationId !== sourceSyncGenerationId
      ) {
        throw new LayoutPreviewError(
          'LAYOUT_PREVIEW_SESSION_MISMATCH',
          'Layout preview session không còn hiệu lực.',
        );
      }
      if (!entry.manifest) {
        throw new LayoutPreviewError(
          'LAYOUT_PREVIEW_MANIFEST_UNAVAILABLE',
          'Runtime chưa gửi node manifest. Hãy tải lại Layout preview.',
        );
      }
      return structuredClone(entry.manifest);
    },

    getSourceWorkspaceHash(
      projectId,
      sessionNonce,
      sourceSyncGenerationId,
    ) {
      assertProjectId(projectId);
      const entry = previews.get(projectId);
      if (
        !entry ||
        !safeTokenEqual(entry.sessionNonce, sessionNonce) ||
        entry.sourceSyncGenerationId !== sourceSyncGenerationId ||
        !/^[a-f0-9]{64}$/.test(entry.sourceWorkspaceHash)
      ) {
        throw new LayoutPreviewError(
          'LAYOUT_PREVIEW_SESSION_MISMATCH',
          'Layout preview session không còn khớp source Sync hiện hành.',
        );
      }
      return entry.sourceWorkspaceHash;
    },

    async close() {
      if (closed) return;
      closed = true;
      await Promise.all(
        [...projectStartOperations.values()].map((operation) =>
          operation.catch(() => undefined),
        ),
      );
      const active = [...previews.values()];
      previews.clear();
      await Promise.all(active.map((entry) => closePreview(entry)));
    },
  };
}
