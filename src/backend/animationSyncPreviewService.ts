import {createRequire} from 'node:module';
import {mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import type {AnimationSyncBundle} from '../shared/topic.ts';
import {copyPreviewWorkspace} from './previewWorkspaceCopy.ts';

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

interface ActivePreview {
  generationId: string;
  lastAccessedAt: number;
  cacheDirectory: string;
  promise: Promise<AnimationSyncPreview>;
  server: PreviewRuntimeServer | null;
}

export interface AnimationSyncPreview {
  generationId: string;
  url: string;
}

export interface AnimationSyncPreviewService {
  start(
    projectId: string,
    bundle: AnimationSyncBundle,
  ): Promise<AnimationSyncPreview>;
  close(): Promise<void>;
}

export class AnimationSyncPreviewError extends Error {
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
    throw new AnimationSyncPreviewError(
      'ANIMATION_SYNC_PREVIEW_INVALID',
      'Project ID của bản nháp đồng bộ không hợp lệ.',
    );
  }
}

function moduleUrl(filePath: string, query = '') {
  return `/@fs/${filePath.replaceAll('\\', '/')}${query}`;
}

async function closeRuntimeServer(server: PreviewRuntimeServer) {
  const closing = server.close();
  await Promise.race([closing, delay(2_000)]);
}

export function createAnimationSyncPreviewService(
  projectsDirectory: string,
  options: {
    maximumActivePreviews?: number;
  } = {},
): AnimationSyncPreviewService {
  const resolvedProjectsDirectory = path.resolve(projectsDirectory);
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
  const previewEditorEntry = path.join(
    repositoryRoot,
    'motion-canvas-runtime',
    'preview',
    'main.js',
  );
  const temporaryRoot = path.join(repositoryRoot, 'tmp', 'sync-previews');
  const maximumActivePreviews = Math.max(
    1,
    Math.min(4, options.maximumActivePreviews ?? 2),
  );
  const previews = new Map<string, ActivePreview>();
  let runtimePromise: Promise<PreviewRuntime> | null = null;
  let closed = false;

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
        throw new AnimationSyncPreviewError(
          'ANIMATION_SYNC_PREVIEW_RUNTIME_UNAVAILABLE',
          'Motion Canvas preview runtime chưa sẵn sàng.',
        );
      }
      return {
        createServer: viteModule.createServer as PreviewRuntime['createServer'],
        motionCanvas,
      };
    });
    return runtimePromise;
  }

  function resolveWorkspace(
    projectId: string,
    bundle: AnimationSyncBundle,
  ) {
    assertProjectId(projectId);
    const projectDirectory = path.join(
      resolvedProjectsDirectory,
      projectId,
    );
    const workspaceDirectory = path.resolve(
      projectDirectory,
      bundle.workspacePath,
    );
    const projectFile = path.resolve(
      workspaceDirectory,
      bundle.projectFile,
    );
    if (
      !isInside(projectDirectory, workspaceDirectory) ||
      !isInside(workspaceDirectory, projectFile)
    ) {
      throw new AnimationSyncPreviewError(
        'ANIMATION_SYNC_PREVIEW_INVALID',
        'Workspace của bản nháp đồng bộ không hợp lệ.',
      );
    }
    return {projectDirectory, projectFile, workspaceDirectory};
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
      await rm(entry.cacheDirectory, {recursive: true, force: true}).catch(
        () => undefined,
      );
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
    projectId: string,
    bundle: AnimationSyncBundle,
    entry: ActivePreview,
  ) {
    const {projectFile, workspaceDirectory} =
      resolveWorkspace(projectId, bundle);
    const projectRelativePath = path.relative(
      workspaceDirectory,
      projectFile,
    );
    const previewWorkspaceDirectory = path.join(
      entry.cacheDirectory,
      'workspace',
    );
    const previewProjectFile = path.join(
      previewWorkspaceDirectory,
      projectRelativePath,
    );
    const runtime = await loadRuntime();
    await rm(entry.cacheDirectory, {recursive: true, force: true});
    await mkdir(entry.cacheDirectory, {recursive: true});

    let server: PreviewRuntimeServer | null = null;
    try {
      await copyPreviewWorkspace(
        workspaceDirectory,
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
        plugins: runtime.motionCanvas({
          project: previewProjectFile.replaceAll('\\', '/'),
          output: path.join(entry.cacheDirectory, 'render-output'),
          editor: previewEditorEntry.replaceAll('\\', '/'),
          bufferedAssets: false,
        }),
        server: {
          host: '127.0.0.1',
          port: 0,
          strictPort: false,
          hmr: false,
          fs: {
            allow: [repositoryRoot, previewWorkspaceDirectory],
          },
        },
      });
      entry.server = server;
      await server.listen();

      const transformedEditor = await server.transformRequest(
        moduleUrl(previewEditorEntry),
      );
      const transformedProject = await server.transformRequest(
        moduleUrl(previewProjectFile, '?project'),
      );
      if (!transformedEditor || !transformedProject) {
        throw new AnimationSyncPreviewError(
          'ANIMATION_SYNC_PREVIEW_VALIDATION_FAILED',
          'Không thể tải player hoặc project đồng bộ vào preview.',
        );
      }

      const localUrl = server.resolvedUrls?.local[0];
      if (!localUrl) {
        throw new AnimationSyncPreviewError(
          'ANIMATION_SYNC_PREVIEW_START_FAILED',
          'Preview runtime không cung cấp URL local.',
        );
      }
      const url = new URL(localUrl);
      url.searchParams.set(
        'generation',
        bundle.generation.generationId,
      );
      return {
        generationId: bundle.generation.generationId,
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
      if (error instanceof AnimationSyncPreviewError) throw error;
      throw new AnimationSyncPreviewError(
        'ANIMATION_SYNC_PREVIEW_START_FAILED',
        'Không thể khởi động bản nháp Motion Canvas.',
        {cause: error},
      );
    }
  }

  return {
    async start(projectId, bundle) {
      if (closed) {
        throw new AnimationSyncPreviewError(
          'ANIMATION_SYNC_PREVIEW_CLOSED',
          'Preview runtime đã dừng.',
        );
      }
      const existing = previews.get(projectId);
      if (existing?.generationId === bundle.generation.generationId) {
        existing.lastAccessedAt = Date.now();
        try {
          const preview = await existing.promise;
          if (
            previews.get(projectId) === existing &&
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

      const cacheDirectory = path.join(
        temporaryRoot,
        projectId,
        bundle.generation.generationId,
      );
      if (!isInside(temporaryRoot, cacheDirectory)) {
        throw new AnimationSyncPreviewError(
          'ANIMATION_SYNC_PREVIEW_INVALID',
          'Generation ID của bản nháp đồng bộ không hợp lệ.',
        );
      }
      const entry: ActivePreview = {
        generationId: bundle.generation.generationId,
        lastAccessedAt: Date.now(),
        cacheDirectory,
        promise: Promise.resolve(null as never),
        server: null,
      };
      entry.promise = createPreview(projectId, bundle, entry).catch(
        (error) => {
          if (previews.get(projectId) === entry) {
            previews.delete(projectId);
          }
          throw error;
        },
      );
      previews.set(projectId, entry);
      await trimPreviews(projectId);
      return entry.promise;
    },

    async close() {
      if (closed) return;
      closed = true;
      const active = [...previews.values()];
      previews.clear();
      await Promise.all(active.map((entry) => closePreview(entry)));
    },
  };
}
