import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {createReadStream, existsSync} from 'node:fs';
import {
  mkdir,
  lstat,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {
  FinalRenderBundleSchema,
  type FinalRenderBundle,
  type FinalRenderJobStatus,
} from '../shared/render.ts';
import type {
  AnimationSyncBundle,
  LayoutBundle,
} from '../shared/topic.ts';
import {
  createLayoutWorkspace,
  LayoutWorkspaceError,
  type LayoutWorkspace,
} from './layoutWorkspace.ts';
import {copyPreviewWorkspace} from './previewWorkspaceCopy.ts';

const execFileAsync = promisify(execFile);
const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
const CRF = 18;
const PRESET = 'medium' as const;
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const MAX_STATUS_BYTES = 64 * 1024;
const RENDER_MANIFEST_FILE = 'manifest.json';
const VIDEO_FILE = 'video.mp4' as const;

export interface RenderFrameTiming {
  estimatedFrameCount: number;
  encodedDurationSeconds: number;
  differenceSeconds: number;
  toleranceSeconds: number;
  matches: boolean;
}

export function estimateRenderFrameCount(
  targetDurationSeconds: number,
  fps = FPS,
): number {
  return Math.ceil(targetDurationSeconds * fps) + 1;
}

export function inspectRenderFrameTiming(
  renderedFrameCount: number,
  targetDurationSeconds: number,
  fps = FPS,
): RenderFrameTiming {
  const estimatedFrameCount = estimateRenderFrameCount(
    targetDurationSeconds,
    fps,
  );
  const encodedDurationSeconds = renderedFrameCount / fps;
  const differenceSeconds = encodedDurationSeconds - targetDurationSeconds;
  const toleranceSeconds = Math.max(0.08, 2 / fps);
  return {
    estimatedFrameCount,
    encodedDurationSeconds,
    differenceSeconds,
    toleranceSeconds,
    matches:
      Number.isInteger(renderedFrameCount) &&
      renderedFrameCount > 0 &&
      Number.isFinite(targetDurationSeconds) &&
      targetDurationSeconds > 0 &&
      Number.isFinite(fps) &&
      fps > 0 &&
      Math.abs(differenceSeconds) <= toleranceSeconds,
  };
}

function waitForChildExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    child.once('exit', onExit);
  });
}

async function terminateChildProcess(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32' && child.pid) {
    await new Promise<void>(resolve => {
      const killer = spawn(
        'taskkill',
        ['/pid', String(child.pid), '/t', '/f'],
        {stdio: 'ignore', windowsHide: true},
      );
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      killer.once('error', finish);
      killer.once('exit', finish);
    });
  } else {
    child.kill('SIGTERM');
  }

  if (await waitForChildExit(child, 2_000)) return;
  child.kill('SIGKILL');
  await waitForChildExit(child, 1_000);
}

async function removeDirectoryWithRetries(directory: string) {
  let lastError: unknown;
  for (const delayMs of [0, 100, 250, 500, 1_000]) {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    try {
      await rm(directory, {recursive: true, force: true});
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

interface RuntimeServer {
  resolvedUrls: {local: string[]; network: string[]} | null;
  listen(): Promise<RuntimeServer>;
  close(): Promise<void>;
  transformRequest(url: string): Promise<unknown>;
}

interface RenderRuntime {
  createServer(config: Record<string, unknown>): Promise<RuntimeServer>;
  motionCanvas(config: Record<string, unknown>): unknown[];
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

interface RenderBridge {
  token: string;
  name: string;
  durationSeconds: number;
  overrides: Awaited<ReturnType<LayoutWorkspace['readOverrides']>>;
  editorManifest: Awaited<
    ReturnType<LayoutWorkspace['readEditorManifest']>
  >;
  writeFrame(frame: number, body: Buffer): Promise<void>;
  complete(): void;
  fail(message: string): void;
}

interface ProbeResult {
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  pixelFormat: string;
}

export interface FinalRenderService {
  render(
    projectId: string,
    generationId: string,
    contentRevision: number,
    syncBundle: AnimationSyncBundle,
    layoutBundle: LayoutBundle,
  ): Promise<FinalRenderBundle>;
  getStatus(
    projectId: string,
    generationId?: string,
  ): FinalRenderJobStatus | null;
  resolveVideo(
    projectId: string,
    bundle: FinalRenderBundle,
  ): Promise<{filePath: string; size: number}>;
  close(): Promise<void>;
}

export class FinalRenderError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
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

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

async function fileSha256(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function assertProjectId(projectId: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId)) {
    throw new FinalRenderError(
      'FINAL_RENDER_INVALID',
      'Project ID của final render không hợp lệ.',
    );
  }
}

function assertGenerationId(generationId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generationId)) {
    throw new FinalRenderError(
      'FINAL_RENDER_INVALID',
      'Generation ID của final render không hợp lệ.',
    );
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

function safeTokenEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request: IncomingMessage, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) {
      throw new FinalRenderError(
        'FINAL_RENDER_FRAME_TOO_LARGE',
        'Frame render vượt quá giới hạn an toàn.',
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

function findBrowserExecutable(configured?: string) {
  const candidates = [
    configured,
    process.env.PAD_RENDER_BROWSER_PATH,
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : undefined,
    process.env['PROGRAMFILES(X86)']
      ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : undefined,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : undefined,
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : undefined,
    process.env['PROGRAMFILES(X86)']
      ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : undefined,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((value): value is string => Boolean(value));
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

function ffprobeExecutable(ffmpegPath: string, configured?: string) {
  if (configured) return configured;
  if (!path.dirname(ffmpegPath) || path.dirname(ffmpegPath) === '.') {
    return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  }
  const extension = path.extname(ffmpegPath);
  return path.join(path.dirname(ffmpegPath), `ffprobe${extension}`);
}

async function probeVideo(ffprobePath: string, videoPath: string) {
  let stdout: string;
  try {
    ({stdout} = await execFileAsync(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,width,height,pix_fmt:format=duration',
        '-of',
        'json',
        videoPath,
      ],
      {encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true},
    ));
  } catch (error) {
    throw new FinalRenderError(
      'FINAL_RENDER_PROBE_FAILED',
      'FFprobe không thể kiểm tra video vừa dựng.',
      {cause: error},
    );
  }
  const value = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
    }>;
    format?: {duration?: string};
  };
  const video = value.streams?.find(stream => stream.codec_type === 'video');
  const audio = value.streams?.find(stream => stream.codec_type === 'audio');
  const result: ProbeResult = {
    durationSeconds: Number(value.format?.duration),
    width: Number(video?.width),
    height: Number(video?.height),
    videoCodec: video?.codec_name ?? '',
    audioCodec: audio?.codec_name ?? '',
    pixelFormat: video?.pix_fmt ?? '',
  };
  if (
    !Number.isFinite(result.durationSeconds) ||
    result.durationSeconds <= 0 ||
    result.width !== WIDTH ||
    result.height !== HEIGHT ||
    result.videoCodec !== 'h264' ||
    result.audioCodec !== 'aac' ||
    result.pixelFormat !== 'yuv420p'
  ) {
    throw new FinalRenderError(
      'FINAL_RENDER_VALIDATION_FAILED',
      'Video cuối không đạt hợp đồng MP4 H.264/AAC 1080×1920.',
    );
  }
  return result;
}

function moduleUrl(filePath: string, query = '') {
  return `/@fs/${filePath.replaceAll('\\', '/')}${query}`;
}

export function createFinalRenderService(
  projectsDirectory: string,
  options: {
    layoutWorkspace?: LayoutWorkspace;
    browserPath?: string;
    ffmpegPath?: string;
    ffprobePath?: string;
    logger?: Pick<Console, 'error' | 'info'>;
  } = {},
): FinalRenderService {
  const artifactWorkspace =
    options.layoutWorkspace ?? createLayoutWorkspace(projectsDirectory);
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const temporaryRoot = path.join(repositoryRoot, 'tmp', 'final-renders');
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
  const renderEditorEntry = path.join(
    repositoryRoot,
    'motion-canvas-runtime',
    'render',
    'editor.js',
  );
  const browserPath = findBrowserExecutable(options.browserPath);
  const ffmpegPath =
    (
      options.ffmpegPath ??
      process.env.PAD_FFMPEG_PATH ??
      process.env.FFMPEG_PATH ??
      ''
    ).trim() || 'ffmpeg';
  const configuredFfprobe = (
    options.ffprobePath ??
    process.env.PAD_FFPROBE_PATH ??
    process.env.FFPROBE_PATH ??
    ''
  ).trim();
  const ffprobePath = ffprobeExecutable(
    ffmpegPath,
    configuredFfprobe || undefined,
  );
  const logger = options.logger ?? console;
  const statuses = new Map<string, FinalRenderJobStatus>();
  const latestByProject = new Map<string, string>();
  const activeRenders = new Map<string, Promise<FinalRenderBundle>>();
  const activeStoppers = new Set<() => void>();
  let runtimePromise: Promise<RenderRuntime> | null = null;
  let queueTail = Promise.resolve();
  let closed = false;

  function jobKey(projectId: string, generationId: string) {
    return `${projectId}:${generationId}`;
  }

  function updateStatus(
    projectId: string,
    generationId: string,
    patch: Partial<FinalRenderJobStatus>,
  ) {
    const key = jobKey(projectId, generationId);
    const previous = statuses.get(key);
    if (!previous) return;
    statuses.set(key, {
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  async function loadRuntime(): Promise<RenderRuntime> {
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
        throw new FinalRenderError(
          'FINAL_RENDER_RUNTIME_UNAVAILABLE',
          'Motion Canvas render runtime chưa sẵn sàng.',
        );
      }
      return {
        createServer: viteModule.createServer as RenderRuntime['createServer'],
        motionCanvas,
      };
    });
    return runtimePromise;
  }

  function createBridgePlugin(bridge: RenderBridge) {
    return {
      name: 'pad-studio-final-render-bridge',
      configureServer(server: MiddlewareServer) {
        server.middlewares.use((request, response, next) => {
          const handle = async () => {
            if (!request.url) return next();
            const url = new URL(request.url, 'http://127.0.0.1');
            if (!url.pathname.startsWith('/__pad-render/')) return next();
            if (
              !safeTokenEqual(url.searchParams.get('token') ?? '', bridge.token)
            ) {
              sendJson(response, 403, {error: {code: 'FINAL_RENDER_TOKEN_INVALID'}});
              return;
            }
            if (url.pathname === '/__pad-render/config') {
              if (request.method !== 'GET') {
                sendJson(response, 405, {error: {code: 'METHOD_NOT_ALLOWED'}});
                return;
              }
              sendJson(response, 200, {
                name: bridge.name,
                durationSeconds: bridge.durationSeconds,
                fps: FPS,
                width: WIDTH,
                height: HEIGHT,
                overrides: bridge.overrides,
                editorManifest: bridge.editorManifest,
              });
              return;
            }
            if (url.pathname === '/__pad-render/frame') {
              if (request.method !== 'POST') {
                sendJson(response, 405, {error: {code: 'METHOD_NOT_ALLOWED'}});
                return;
              }
              const frame = Number(url.searchParams.get('frame'));
              const body = await readBody(request, MAX_FRAME_BYTES);
              if (
                !Number.isSafeInteger(frame) ||
                frame < 0 ||
                body.length < 8 ||
                body.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
              ) {
                sendJson(response, 422, {error: {code: 'FINAL_RENDER_FRAME_INVALID'}});
                return;
              }
              await bridge.writeFrame(frame, body);
              sendJson(response, 200, {ok: true});
              return;
            }
            if (url.pathname === '/__pad-render/status') {
              if (request.method !== 'POST') {
                sendJson(response, 405, {error: {code: 'METHOD_NOT_ALLOWED'}});
                return;
              }
              const body = JSON.parse(
                (await readBody(request, MAX_STATUS_BYTES)).toString('utf8'),
              ) as {state?: string; message?: string};
              if (body.state === 'completed') bridge.complete();
              else if (body.state === 'failed') {
                bridge.fail(String(body.message ?? 'Motion Canvas render thất bại.'));
              } else {
                sendJson(response, 422, {error: {code: 'FINAL_RENDER_STATUS_INVALID'}});
                return;
              }
              sendJson(response, 200, {ok: true});
              return;
            }
            next();
          };
          void handle().catch(error => {
            bridge.fail(error instanceof Error ? error.message : String(error));
            if (!response.headersSent) {
              sendJson(response, 500, {error: {code: 'FINAL_RENDER_BRIDGE_FAILED'}});
            } else if (!response.writableEnded) {
              response.end();
            }
          });
        });
      },
    };
  }

  async function verifyExisting(
    targetDirectory: string,
    requestHash: string,
    generationId: string,
  ) {
    const targetEntry = await lstat(targetDirectory).catch(error => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    });
    if (!targetEntry) return null;
    try {
      if (!targetEntry.isDirectory() || targetEntry.isSymbolicLink()) {
        throw new Error('render generation is not a safe directory');
      }
      const raw = await readFile(path.join(targetDirectory, RENDER_MANIFEST_FILE), 'utf8');
      const parsed = FinalRenderBundleSchema.parse(JSON.parse(raw));
      if (
        parsed.generation.generationId !== generationId ||
        parsed.validation.sourceHash !== requestHash
      ) {
        throw new Error('manifest mismatch');
      }
      const videoPath = path.join(targetDirectory, parsed.videoFile);
      const videoStat = await stat(videoPath);
      if (
        !videoStat.isFile() ||
        videoStat.size !== parsed.fileSizeBytes ||
        (await fileSha256(videoPath)) !== parsed.validation.videoHash
      ) {
        throw new Error('video mismatch');
      }
      await probeVideo(ffprobePath, videoPath);
      return parsed;
    } catch (error) {
      throw new FinalRenderError(
        'FINAL_RENDER_GENERATION_CONFLICT',
        'Render generation đã tồn tại nhưng không khớp yêu cầu hiện tại.',
        {cause: error},
      );
    }
  }

  async function performRender(
    projectId: string,
    generationId: string,
    contentRevision: number,
    syncBundle: AnimationSyncBundle,
    layoutBundle: LayoutBundle,
  ) {
    if (closed) {
      throw new FinalRenderError('FINAL_RENDER_CLOSED', 'Bộ dựng video đang đóng.');
    }
    if (!browserPath) {
      throw new FinalRenderError(
        'FINAL_RENDER_BROWSER_UNAVAILABLE',
        'Không tìm thấy Chrome hoặc Edge để chạy Motion Canvas headless.',
      );
    }
    updateStatus(projectId, generationId, {
      state: 'preparing',
      progress: 0.01,
      startedAt: new Date().toISOString(),
      message: 'Đang xác minh Layout và chuẩn bị bộ dựng…',
    });

    let verified: Awaited<ReturnType<LayoutWorkspace['verify']>>;
    try {
      verified = await artifactWorkspace.verify(projectId, syncBundle, layoutBundle);
    } catch (error) {
      if (error instanceof LayoutWorkspaceError) {
        throw new FinalRenderError(
          'FINAL_RENDER_SOURCE_INVALID',
          'Layout hoặc workspace đồng bộ không còn hợp lệ để render.',
          {cause: error},
        );
      }
      throw error;
    }
    if (!verified.editorManifest) {
      throw new FinalRenderError(
        'FINAL_RENDER_SOURCE_INVALID',
        'Layout chưa có editor manifest đã xác minh.',
      );
    }
    const requestHash = sha256(
      JSON.stringify(
        canonicalValue({
          sourceLayoutContentRevision: layoutBundle.contentRevision,
          sourceLayoutGenerationId: layoutBundle.generation.generationId,
          sourceLayoutSourceHash: layoutBundle.validation.sourceHash,
          sourceWorkspaceHash: verified.sourceWorkspaceHash,
          durationSeconds: layoutBundle.totalDurationSeconds,
          width: WIDTH,
          height: HEIGHT,
          fps: FPS,
          crf: CRF,
          preset: PRESET,
        }),
      ),
    );
    const projectDirectory = await realpath(verified.projectDirectory);
    const rendersDirectory = path.join(projectDirectory, 'renders');
    const generationsCandidate = path.join(rendersDirectory, 'generations');
    await mkdir(generationsCandidate, {recursive: true});
    const [rendersEntry, generationsEntry, generationsDirectory] =
      await Promise.all([
        lstat(rendersDirectory),
        lstat(generationsCandidate),
        realpath(generationsCandidate),
      ]);
    if (
      rendersEntry.isSymbolicLink() ||
      generationsEntry.isSymbolicLink() ||
      !rendersEntry.isDirectory() ||
      !generationsEntry.isDirectory() ||
      !isInside(projectDirectory, generationsDirectory)
    ) {
      throw new FinalRenderError(
        'FINAL_RENDER_INVALID',
        'Thư mục lưu render không an toàn.',
      );
    }
    const targetDirectory = path.join(generationsDirectory, generationId);
    if (!isInside(projectDirectory, targetDirectory)) {
      throw new FinalRenderError('FINAL_RENDER_INVALID', 'Đường dẫn render không an toàn.');
    }
    const existing = await verifyExisting(targetDirectory, requestHash, generationId);
    if (existing) {
      updateStatus(projectId, generationId, {
        state: 'completed',
        progress: 1,
        renderedFrames: existing.validation.renderedFrameCount,
        message: 'Video cuối đã sẵn sàng.',
      });
      return existing;
    }

    const stagingDirectory = path.join(
      generationsDirectory,
      `.staging-${generationId}-${randomBytes(6).toString('hex')}`,
    );
    const cacheDirectory = path.join(temporaryRoot, `${generationId}-${randomBytes(6).toString('hex')}`);
    const copiedWorkspace = path.join(cacheDirectory, 'workspace');
    const outputVideo = path.join(stagingDirectory, VIDEO_FILE);
    const audioFile = path.join(copiedWorkspace, layoutBundle.audioFile);
    const projectRelativePath = path.relative(
      verified.sourceWorkspaceDirectory,
      verified.projectFile,
    );
    const copiedProjectFile = path.join(copiedWorkspace, projectRelativePath);
    const estimatedTotalFrames = estimateRenderFrameCount(
      layoutBundle.totalDurationSeconds,
    );
    await mkdir(path.dirname(copiedWorkspace), {recursive: true});
    await mkdir(stagingDirectory, {recursive: true});

    let viteServer: RuntimeServer | null = null;
    let browser: ReturnType<typeof spawn> | null = null;
    let ffmpeg: ReturnType<typeof spawn> | null = null;
    let completionSettled = false;
    let completeRender: () => void = () => {};
    let failRender: (error: Error) => void = () => {};
    const completion = new Promise<void>((resolve, reject) => {
      completeRender = () => {
        if (completionSettled) return;
        completionSettled = true;
        resolve();
      };
      failRender = error => {
        if (completionSettled) return;
        completionSettled = true;
        reject(error);
      };
    });
    const stopActiveRender = () => {
      failRender(
        new FinalRenderError(
          'FINAL_RENDER_CLOSED',
          'Final render đã dừng vì backend đang đóng.',
        ),
      );
      ffmpeg?.stdin?.destroy();
    };
    activeStoppers.add(stopActiveRender);
    const ffmpegErrors: string[] = [];
    const browserErrors: string[] = [];
    let framesReceived = 0;

    try {
      await copyPreviewWorkspace(
        verified.sourceWorkspaceDirectory,
        copiedWorkspace,
      );
      const runtime = await loadRuntime();
      ffmpeg = spawn(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'warning',
          '-y',
          '-f',
          'image2pipe',
          '-framerate',
          String(FPS),
          '-vcodec',
          'png',
          '-i',
          'pipe:0',
          '-i',
          audioFile,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'libx264',
          '-preset',
          PRESET,
          '-crf',
          String(CRF),
          '-pix_fmt',
          'yuv420p',
          '-vf',
          `tpad=stop_mode=clone:stop_duration=${(2 / FPS).toFixed(6)}`,
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ar',
          '48000',
          '-t',
          layoutBundle.totalDurationSeconds.toFixed(6),
          '-movflags',
          '+faststart',
          outputVideo,
        ],
        {stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true},
      );
      ffmpeg.stderr?.setEncoding('utf8');
      ffmpeg.stderr?.on('data', chunk => {
        ffmpegErrors.push(String(chunk));
        if (ffmpegErrors.length > 40) ffmpegErrors.shift();
      });
      const ffmpegExit = new Promise<void>((resolve, reject) => {
        ffmpeg?.once('error', error =>
          reject(
            new FinalRenderError(
              'FINAL_RENDER_ENCODER_UNAVAILABLE',
              'Không thể khởi động FFmpeg. Hãy kiểm tra FFMPEG_PATH.',
              {cause: error},
            ),
          ),
        );
        ffmpeg?.once('exit', code => {
          if (code === 0) resolve();
          else reject(
            new Error(
              `FFmpeg dừng với mã ${String(code)}. ${ffmpegErrors.join('').slice(-1200)}`,
            ),
          );
        });
      });
      ffmpegExit.catch(error => failRender(error));

      const bridge: RenderBridge = {
        token: randomBytes(32).toString('base64url'),
        name: `pad-studio-${projectId}`,
        durationSeconds: layoutBundle.totalDurationSeconds,
        overrides: verified.overrides,
        editorManifest: verified.editorManifest,
        async writeFrame(frame, body) {
          if (frame !== framesReceived) {
            throw new FinalRenderError(
              'FINAL_RENDER_FRAME_SEQUENCE_INVALID',
              `Frame ${frame} đến sai thứ tự (đang chờ ${framesReceived}).`,
            );
          }
          if (!ffmpeg?.stdin || ffmpeg.stdin.destroyed) {
            throw new FinalRenderError(
              'FINAL_RENDER_ENCODER_STOPPED',
              'FFmpeg đã dừng trước khi nhận đủ frame.',
            );
          }
          if (!ffmpeg.stdin.write(body)) {
            await once(ffmpeg.stdin, 'drain');
          }
          framesReceived += 1;
          updateStatus(projectId, generationId, {
            state: 'rendering',
            renderedFrames: framesReceived,
            progress: Math.min(
              0.94,
              0.04 + (framesReceived / estimatedTotalFrames) * 0.9,
            ),
            message: `Đang dựng frame ${framesReceived.toLocaleString('vi-VN')}/${estimatedTotalFrames.toLocaleString('vi-VN')} dự kiến…`,
          });
        },
        complete() {
          completeRender();
        },
        fail(message) {
          failRender(new Error(message));
        },
      };

      viteServer = await runtime.createServer({
        configFile: false,
        root: copiedWorkspace,
        cacheDir: path.join(cacheDirectory, 'vite-cache'),
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
            '@motion-canvas/core': path.join(repositoryRoot, 'node_modules', '@motion-canvas', 'core'),
            '@motion-canvas/2d': path.join(repositoryRoot, 'node_modules', '@motion-canvas', '2d'),
          },
        },
        plugins: [
          createBridgePlugin(bridge),
          ...runtime.motionCanvas({
            project: copiedProjectFile.replaceAll('\\', '/'),
            output: path.join(cacheDirectory, 'unused-output'),
            editor: renderEditorEntry.replaceAll('\\', '/'),
            bufferedAssets: false,
          }),
        ],
        server: {
          host: '127.0.0.1',
          port: 0,
          strictPort: false,
          hmr: false,
          headers: {
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
          },
          fs: {allow: [repositoryRoot, copiedWorkspace]},
        },
      });
      await viteServer.listen();
      await viteServer.transformRequest(moduleUrl(renderEditorEntry));
      await viteServer.transformRequest(moduleUrl(copiedProjectFile, '?project'));
      const localUrl = viteServer.resolvedUrls?.local[0];
      if (!localUrl) {
        throw new FinalRenderError(
          'FINAL_RENDER_START_FAILED',
          'Render runtime không cung cấp URL local.',
        );
      }
      const renderUrl = new URL(localUrl);
      renderUrl.searchParams.set('token', bridge.token);
      updateStatus(projectId, generationId, {
        state: 'rendering',
        progress: 0.04,
        message: `Đang dựng khoảng ${estimatedTotalFrames.toLocaleString('vi-VN')} frame…`,
      });
      browser = spawn(
        browserPath,
        [
          '--headless=new',
          '--disable-background-networking',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--disable-features=Translate',
          '--disable-sync',
          '--no-first-run',
          '--no-default-browser-check',
          '--autoplay-policy=no-user-gesture-required',
          `--user-data-dir=${path.join(cacheDirectory, 'browser-profile')}`,
          renderUrl.toString(),
        ],
        {stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true},
      );
      browser.stderr?.setEncoding('utf8');
      browser.stderr?.on('data', chunk => {
        browserErrors.push(String(chunk));
        if (browserErrors.length > 40) browserErrors.shift();
      });
      browser.once('error', error =>
        failRender(
          new FinalRenderError(
            'FINAL_RENDER_BROWSER_UNAVAILABLE',
            'Không thể khởi động Chrome/Edge cho final render.',
            {cause: error},
          ),
        ),
      );
      browser.once('exit', code => {
        if (!completionSettled) {
          failRender(
            new Error(
              `Trình duyệt render dừng sớm (${String(code)}). ${browserErrors.join('').slice(-1000)}`,
            ),
          );
        }
      });
      const timeoutMs = Math.min(
        2 * 60 * 60 * 1000,
        Math.max(5 * 60 * 1000, estimatedTotalFrames * 1_500),
      );
      let timer: NodeJS.Timeout | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Final render vượt quá thời gian cho phép.')),
          timeoutMs,
        );
        timer.unref();
      });
      try {
        await Promise.race([completion, timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      const renderedFrameTiming = inspectRenderFrameTiming(
        framesReceived,
        layoutBundle.totalDurationSeconds,
      );
      if (!renderedFrameTiming.matches) {
        throw new FinalRenderError(
          'FINAL_RENDER_FRAME_COUNT_MISMATCH',
          `Motion Canvas xuất ${framesReceived} frame (${renderedFrameTiming.encodedDurationSeconds.toFixed(3)} giây), không phủ đủ thời lượng Layout ${layoutBundle.totalDurationSeconds.toFixed(3)} giây.`,
        );
      }
      updateStatus(projectId, generationId, {
        state: 'finalizing',
        progress: 0.95,
        message: 'Đang hoàn tất MP4 và kiểm tra đầu ra…',
      });
      await terminateChildProcess(browser);
      browser = null;
      ffmpeg.stdin?.end();
      await ffmpegExit;
      ffmpeg = null;
      const probe = await probeVideo(ffprobePath, outputVideo);
      if (
        Math.abs(probe.durationSeconds - layoutBundle.totalDurationSeconds) >
        renderedFrameTiming.toleranceSeconds
      ) {
        throw new FinalRenderError(
          'FINAL_RENDER_DURATION_MISMATCH',
          'Thời lượng video cuối không khớp Layout đã duyệt.',
        );
      }
      const videoStat = await stat(outputVideo);
      const validatedAt = new Date().toISOString();
      const bundle = FinalRenderBundleSchema.parse({
        status: 'completed',
        contentRevision,
        sourceLayoutContentRevision: layoutBundle.contentRevision,
        sourceLayoutGenerationId: layoutBundle.generation.generationId,
        sourceLayoutSourceHash: layoutBundle.validation.sourceHash,
        workspacePath: `renders/generations/${generationId}`,
        videoFile: VIDEO_FILE,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        durationSeconds: layoutBundle.totalDurationSeconds,
        fileSizeBytes: videoStat.size,
        encoding: {
          container: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          pixelFormat: 'yuv420p',
          crf: CRF,
          preset: PRESET,
        },
        validation: {
          validatedAt,
          sourceHash: requestHash,
          videoHash: await fileSha256(outputVideo),
          renderedFrameCount: framesReceived,
          probedDurationSeconds: probe.durationSeconds,
        },
        generation: {
          generationId,
          provider: 'local',
          tool: 'motion-canvas-ffmpeg',
          generatedAt: validatedAt,
        },
      });
      await writeFile(
        path.join(stagingDirectory, RENDER_MANIFEST_FILE),
        `${JSON.stringify(bundle, null, 2)}\n`,
        'utf8',
      );
      await rename(stagingDirectory, targetDirectory);
      updateStatus(projectId, generationId, {
        state: 'completed',
        progress: 1,
        renderedFrames: framesReceived,
        totalFrames: framesReceived,
        message: 'Video cuối đã sẵn sàng.',
      });
      return bundle;
    } catch (error) {
      const renderError =
        error instanceof FinalRenderError
          ? error
          : new FinalRenderError(
              'FINAL_RENDER_FAILED',
              error instanceof Error ? error.message : 'Final render thất bại.',
              {cause: error},
            );
      updateStatus(projectId, generationId, {
        state: 'failed',
        errorCode: renderError.code,
        message: renderError.message,
      });
      logger.error(renderError);
      throw renderError;
    } finally {
      activeStoppers.delete(stopActiveRender);
      if (browser) await terminateChildProcess(browser).catch(() => undefined);
      if (ffmpeg) {
        ffmpeg.stdin?.destroy();
        await terminateChildProcess(ffmpeg).catch(() => undefined);
      }
      if (viteServer) await viteServer.close().catch(() => undefined);
      if (isInside(temporaryRoot, cacheDirectory)) {
        await removeDirectoryWithRetries(cacheDirectory).catch(error => {
          logger.error(error);
        });
      }
      if (isInside(generationsDirectory, stagingDirectory)) {
        await removeDirectoryWithRetries(stagingDirectory).catch(error => {
          logger.error(error);
        });
      }
    }
  }

  return {
    render(projectId, generationId, contentRevision, syncBundle, layoutBundle) {
      assertProjectId(projectId);
      assertGenerationId(generationId);
      const key = jobKey(projectId, generationId);
      const active = activeRenders.get(key);
      if (active) return active;
      const now = new Date().toISOString();
      const totalFrames = estimateRenderFrameCount(
        layoutBundle.totalDurationSeconds,
      );
      statuses.set(key, {
        generationId,
        state: 'queued',
        progress: 0,
        renderedFrames: 0,
        totalFrames,
        startedAt: null,
        updatedAt: now,
        message: 'Đã xếp hàng render.',
        errorCode: null,
      });
      latestByProject.set(projectId, generationId);
      const operation = queueTail
        .catch(() => undefined)
        .then(() =>
          performRender(
            projectId,
            generationId,
            contentRevision,
            syncBundle,
            layoutBundle,
          ),
        )
        .catch(error => {
          const renderError =
            error instanceof FinalRenderError
              ? error
              : new FinalRenderError(
                  'FINAL_RENDER_FAILED',
                  error instanceof Error
                    ? error.message
                    : 'Final render thất bại.',
                  {cause: error},
                );
          if (statuses.get(key)?.state !== 'failed') {
            updateStatus(projectId, generationId, {
              state: 'failed',
              errorCode: renderError.code,
              message: renderError.message,
            });
          }
          throw renderError;
        });
      queueTail = operation.then(
        () => undefined,
        () => undefined,
      );
      activeRenders.set(key, operation);
      void operation.finally(() => {
        if (activeRenders.get(key) === operation) activeRenders.delete(key);
      }).catch(() => undefined);
      return operation;
    },

    getStatus(projectId, generationId) {
      assertProjectId(projectId);
      const resolvedGeneration = generationId ?? latestByProject.get(projectId);
      if (!resolvedGeneration) return null;
      assertGenerationId(resolvedGeneration);
      return statuses.get(jobKey(projectId, resolvedGeneration)) ?? null;
    },

    async resolveVideo(projectId, bundle) {
      assertProjectId(projectId);
      const parsed = FinalRenderBundleSchema.parse(bundle);
      const projectsRoot = await realpath(path.resolve(projectsDirectory));
      const projectDirectory = await realpath(
        path.resolve(projectsRoot, projectId),
      );
      if (!isInside(projectsRoot, projectDirectory)) {
        throw new FinalRenderError(
          'FINAL_RENDER_INVALID',
          'Thư mục project của video cuối không an toàn.',
        );
      }
      const candidate = path.resolve(
        projectDirectory,
        parsed.workspacePath,
        parsed.videoFile,
      );
      if (!isInside(projectDirectory, candidate)) {
        throw new FinalRenderError(
          'FINAL_RENDER_INVALID',
          'Đường dẫn video cuối không an toàn.',
        );
      }
      const filePath = await realpath(candidate).catch(error => {
        throw new FinalRenderError(
          'FINAL_RENDER_VIDEO_MISSING',
          'File video cuối không còn tồn tại.',
          {cause: error},
        );
      });
      if (!isInside(projectDirectory, filePath)) {
        throw new FinalRenderError(
          'FINAL_RENDER_INVALID',
          'File video cuối đi qua liên kết không an toàn.',
        );
      }
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size !== parsed.fileSizeBytes) {
        throw new FinalRenderError(
          'FINAL_RENDER_VIDEO_INVALID',
          'File video cuối không còn khớp manifest.',
        );
      }
      return {filePath, size: fileStat.size};
    },

    async close() {
      closed = true;
      for (const stop of activeStoppers) stop();
      await queueTail.catch(() => undefined);
    },
  };
}
