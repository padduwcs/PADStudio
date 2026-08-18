import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {createReadStream, existsSync} from 'node:fs';
import {
  mkdir,
  lstat,
  readdir,
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
  FinalRenderDiagnosticSchema,
  FinalRenderBundleSchema,
  FinalRenderJobReportSchema,
  FinalRenderJobStatusSchema,
  finalRenderTimingToleranceSeconds,
  type FinalRenderDiagnostic,
  type FinalRenderBundle,
  type FinalRenderJobStatus,
  type RenderWatermark,
} from '../shared/render.ts';
import type {
  AnimationSyncBundle,
  LayoutBundle,
} from '../shared/topic.ts';
import {
  defaultRenderProfile,
  type RenderProfile,
} from '../shared/videoFormat.ts';
import {
  createLayoutWorkspace,
  LayoutWorkspaceError,
  type LayoutWorkspace,
} from './layoutWorkspace.ts';
import {copyPreviewWorkspace} from './previewWorkspaceCopy.ts';
import {
  createWatermarkAssetStore,
  type WatermarkAssetStore,
} from './watermarkAssetStore.ts';

const execFileAsync = promisify(execFile);
const DEFAULT_FPS = 30;
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const MAX_STATUS_BYTES = 64 * 1024;
const RENDER_MANIFEST_FILE = 'manifest.json';
const VIDEO_FILE = 'video.mp4' as const;
const RENDER_JOBS_DIRECTORY = 'jobs';
const MAX_JOB_REPORT_BYTES = 128 * 1024;

export interface RenderFrameTiming {
  estimatedFrameCount: number;
  encodedDurationSeconds: number;
  differenceSeconds: number;
  toleranceSeconds: number;
  matches: boolean;
}

export function estimateRenderFrameCount(
  targetDurationSeconds: number,
  fps = DEFAULT_FPS,
): number {
  return Math.ceil(targetDurationSeconds * fps) + 1;
}

export function inspectRenderFrameTiming(
  renderedFrameCount: number,
  targetDurationSeconds: number,
  fps = DEFAULT_FPS,
): RenderFrameTiming {
  const estimatedFrameCount = estimateRenderFrameCount(
    targetDurationSeconds,
    fps,
  );
  const encodedDurationSeconds = renderedFrameCount / fps;
  const differenceSeconds = encodedDurationSeconds - targetDurationSeconds;
  const toleranceSeconds = finalRenderTimingToleranceSeconds(
    fps,
    targetDurationSeconds,
  );
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
  rangeFrames: [number, number];
  frame: RenderProfile['frame'];
  overrides: Awaited<ReturnType<LayoutWorkspace['readOverrides']>>;
  editorManifest: Awaited<
    ReturnType<LayoutWorkspace['readEditorManifest']>
  >;
  watermark: RenderWatermark;
  watermarkImage: {
    value: Buffer;
    contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  } | null;
  writeFrame(frame: number, body: Buffer): Promise<void>;
  complete(): void;
  fail(message: string, diagnostic?: unknown): void;
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
    renderProfile?: RenderProfile,
  ): Promise<FinalRenderBundle>;
  getStatus(
    projectId: string,
    generationId?: string,
  ): Promise<FinalRenderJobStatus | null>;
  getCompletedBundle(
    projectId: string,
    generationId: string,
  ): Promise<FinalRenderBundle | null>;
  resolveVideo(
    projectId: string,
    bundle: FinalRenderBundle,
  ): Promise<{filePath: string; size: number}>;
  close(): Promise<void>;
}

export class FinalRenderError extends Error {
  readonly code: string;
  readonly diagnostic: FinalRenderDiagnostic | null;

  constructor(
    code: string,
    message: string,
    options?: ErrorOptions & {diagnostic?: FinalRenderDiagnostic | null},
  ) {
    super(message, options);
    this.code = code;
    this.diagnostic = options?.diagnostic ?? null;
  }
}

type PendingRenderFrame<T> = {
  body: T;
  resolve: () => void;
  reject: (error: Error) => void;
};

/**
 * Canvas encoding completes asynchronously, so adjacent frames can arrive at
 * the bridge out of order even though Motion Canvas rendered them in order.
 * Keep the encoder input strictly ordered without dropping valid frames.
 */
export function createOrderedFrameWriter<T>(
  write: (frame: number, body: T) => Promise<void>,
  firstFrame = 0,
) {
  let nextFrame = firstFrame;
  let terminalError: Error | null = null;
  let draining: Promise<void> | null = null;
  const pending = new Map<number, PendingRenderFrame<T>>();

  function sequenceError(frame: number) {
    return new FinalRenderError(
      'FINAL_RENDER_FRAME_SEQUENCE_INVALID',
      `Frame ${frame} được gửi lặp hoặc đã quá thứ tự (đang chờ ${nextFrame}).`,
    );
  }

  function rejectPending(error: Error) {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  }

  async function drain() {
    while (!terminalError) {
      const entry = pending.get(nextFrame);
      if (!entry) return;
      pending.delete(nextFrame);
      try {
        await write(nextFrame, entry.body);
        entry.resolve();
        nextFrame += 1;
      } catch (error) {
        terminalError = error instanceof Error
          ? error
          : new Error('Không thể ghi frame render.');
        entry.reject(terminalError);
        rejectPending(terminalError);
        throw terminalError;
      }
    }
  }

  function scheduleDrain() {
    if (draining || terminalError) return;
    draining = drain().finally(() => {
      draining = null;
      if (!terminalError && pending.has(nextFrame)) scheduleDrain();
    });
    void draining.catch(() => {});
  }

  return {
    writeFrame(frame: number, body: T) {
      if (terminalError) return Promise.reject(terminalError);
      if (frame < nextFrame || pending.has(frame)) {
        return Promise.reject(sequenceError(frame));
      }
      return new Promise<void>((resolve, reject) => {
        pending.set(frame, {body, resolve, reject});
        scheduleDrain();
      });
    },
    get nextFrame() {
      return nextFrame;
    },
  };
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

function boundedText(value: unknown, maximumLength: number) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.replaceAll('\u0000', '').trim().slice(0, maximumLength);
}

function sanitizeDiagnosticText(
  value: string | null,
  replacements: string[],
) {
  if (!value) return null;
  let sanitized = value;
  for (const replacement of replacements) {
    if (!replacement) continue;
    sanitized = sanitized.replaceAll(replacement, '[render-workspace]');
    sanitized = sanitized.replaceAll(
      replacement.replaceAll('\\', '/'),
      '[render-workspace]',
    );
  }
  sanitized = sanitized.replace(
    /https?:\/\/127\.0\.0\.1:\d+/giu,
    '[render-runtime]',
  );
  return sanitized;
}

function sanitizeRenderDiagnostic(
  value: unknown,
  replacements: string[] = [],
) {
  const parsed = FinalRenderDiagnosticSchema.safeParse(value);
  if (!parsed.success) return null;
  return FinalRenderDiagnosticSchema.parse({
    ...parsed.data,
    sceneName: sanitizeDiagnosticText(parsed.data.sceneName, replacements),
    logs: parsed.data.logs.map(log => ({
      ...log,
      message: sanitizeDiagnosticText(log.message, replacements),
      remarks: sanitizeDiagnosticText(log.remarks, replacements),
      stack: sanitizeDiagnosticText(log.stack, replacements),
    })),
  });
}

function backendRenderDiagnostic(
  stage: FinalRenderDiagnostic['stage'],
  message: string,
  progress: {frame?: number | null; timeSeconds?: number | null} = {},
): FinalRenderDiagnostic {
  return FinalRenderDiagnosticSchema.parse({
    stage,
    frame: progress.frame ?? null,
    sceneFrame: null,
    sceneName: null,
    timeSeconds: progress.timeSeconds ?? null,
    logs: [
      {
        level: 'error',
        message: boundedText(message, 1_000) || 'Final render thất bại.',
        remarks: null,
        stack: null,
      },
    ],
  });
}

function diagnosticStageForErrorCode(
  code: string,
): FinalRenderDiagnostic['stage'] {
  if (code.includes('ENCODER') || code.includes('FFMPEG')) return 'encoder';
  if (code.includes('BROWSER')) return 'browser';
  if (
    code.includes('DURATION') ||
    code.includes('PROBE') ||
    code.includes('VALIDATION')
  ) {
    return 'finalizing';
  }
  if (code.includes('MOTION_CANVAS') || code.includes('FRAME')) {
    return 'motion-canvas';
  }
  return 'preparing';
}

export function findBrowserExecutable(configured?: string) {
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

export function resolveFinalRenderExecutables(options: {
  browserPath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
} = {}) {
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
  return {
    browserPath,
    ffmpegPath,
    ffprobePath: ffprobeExecutable(ffmpegPath, configuredFfprobe || undefined),
  };
}

function encodingForQuality(quality: RenderProfile['quality']) {
  if (quality === 'fast') return {crf: 23, preset: 'veryfast' as const};
  if (quality === 'high') return {crf: 16, preset: 'slow' as const};
  return {crf: 18, preset: 'medium' as const};
}

async function probeVideo(
  ffprobePath: string,
  videoPath: string,
  frame: RenderProfile['frame'],
) {
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
    result.width !== frame.width ||
    result.height !== frame.height ||
    result.videoCodec !== 'h264' ||
    result.audioCodec !== 'aac' ||
    result.pixelFormat !== 'yuv420p'
  ) {
    throw new FinalRenderError(
      'FINAL_RENDER_VALIDATION_FAILED',
      `Video cuối không đạt hợp đồng MP4 H.264/AAC ${frame.width}×${frame.height}.`,
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
    watermarkAssetStore?: WatermarkAssetStore;
    logger?: Pick<Console, 'error' | 'info'>;
  } = {},
): FinalRenderService {
  const artifactWorkspace =
    options.layoutWorkspace ?? createLayoutWorkspace(projectsDirectory);
  const watermarkAssets =
    options.watermarkAssetStore ?? createWatermarkAssetStore(projectsDirectory);
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
  const {browserPath, ffmpegPath, ffprobePath} = resolveFinalRenderExecutables(
    options,
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
    statuses.set(
      key,
      FinalRenderJobStatusSchema.parse({
        ...previous,
        ...patch,
        message:
          patch.message === undefined
            ? previous.message
            : boundedText(patch.message, 500),
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  async function resolveJobReportsDirectory(
    projectId: string,
    create: boolean,
  ) {
    const projectsRoot = await realpath(path.resolve(projectsDirectory));
    const projectDirectory = await realpath(
      path.resolve(projectsRoot, projectId),
    );
    if (!isInside(projectsRoot, projectDirectory)) {
      throw new FinalRenderError(
        'FINAL_RENDER_INVALID',
        'Thư mục project của render report không an toàn.',
      );
    }

    const rendersCandidate = path.join(projectDirectory, 'renders');
    let rendersEntry = await lstat(rendersCandidate).catch(error => {
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
    if (!rendersEntry && create) {
      await mkdir(rendersCandidate);
      rendersEntry = await lstat(rendersCandidate);
    }
    if (!rendersEntry) return null;
    const rendersDirectory = await realpath(rendersCandidate);
    if (
      rendersEntry.isSymbolicLink() ||
      !rendersEntry.isDirectory() ||
      !isInside(projectDirectory, rendersDirectory)
    ) {
      throw new FinalRenderError(
        'FINAL_RENDER_INVALID',
        'Thư mục lưu render report không an toàn.',
      );
    }

    const jobsCandidate = path.join(
      rendersDirectory,
      RENDER_JOBS_DIRECTORY,
    );
    let jobsEntry = await lstat(jobsCandidate).catch(error => {
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
    if (!jobsEntry && create) {
      await mkdir(jobsCandidate);
      jobsEntry = await lstat(jobsCandidate);
    }
    if (!jobsEntry) return null;
    const jobsDirectory = await realpath(jobsCandidate);
    if (
      jobsEntry.isSymbolicLink() ||
      !jobsEntry.isDirectory() ||
      !isInside(projectDirectory, jobsDirectory)
    ) {
      throw new FinalRenderError(
        'FINAL_RENDER_INVALID',
        'Thư mục render report không an toàn.',
      );
    }
    return jobsDirectory;
  }

  async function persistTerminalStatus(
    projectId: string,
    layoutBundle: LayoutBundle,
    status: FinalRenderJobStatus,
    bundle: FinalRenderBundle | null = null,
  ) {
    const report = FinalRenderJobReportSchema.parse({
      version: 1,
      projectId,
      sourceLayoutContentRevision: layoutBundle.contentRevision,
      sourceLayoutGenerationId: layoutBundle.generation.generationId,
      sourceLayoutSourceHash: layoutBundle.validation.sourceHash,
      status,
      bundle,
    });
    const jobsDirectory = await resolveJobReportsDirectory(projectId, true);
    if (!jobsDirectory) {
      throw new FinalRenderError(
        'FINAL_RENDER_REPORT_UNAVAILABLE',
        'Không thể mở thư mục lưu render report.',
      );
    }
    const target = path.join(jobsDirectory, `${status.generationId}.json`);
    const temporary = path.join(
      jobsDirectory,
      `.staging-${status.generationId}-${randomBytes(6).toString('hex')}.json`,
    );
    if (!isInside(jobsDirectory, target) || !isInside(jobsDirectory, temporary)) {
      throw new FinalRenderError(
        'FINAL_RENDER_INVALID',
        'Đường dẫn render report không an toàn.',
      );
    }
    try {
      await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      await rename(temporary, target);
    } finally {
      await rm(temporary, {force: true}).catch(() => undefined);
    }
  }

  async function readPersistedReport(
    projectId: string,
    generationId: string,
  ) {
    const jobsDirectory = await resolveJobReportsDirectory(projectId, false);
    if (!jobsDirectory) return null;
    const candidate = path.join(jobsDirectory, `${generationId}.json`);
    if (!isInside(jobsDirectory, candidate)) return null;
    try {
      const entry = await stat(candidate);
      if (!entry.isFile() || entry.size > MAX_JOB_REPORT_BYTES) return null;
      const parsed = FinalRenderJobReportSchema.safeParse(
        JSON.parse(await readFile(candidate, 'utf8')),
      );
      if (
        !parsed.success ||
        parsed.data.projectId !== projectId ||
        parsed.data.status.generationId !== generationId
      ) {
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  async function readPersistedStatus(
    projectId: string,
    generationId?: string,
  ) {
    if (generationId) {
      return (await readPersistedReport(projectId, generationId))?.status ?? null;
    }
    const jobsDirectory = await resolveJobReportsDirectory(projectId, false);
    if (!jobsDirectory) return null;
    const fileNames = (await readdir(jobsDirectory))
      .filter(fileName =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/iu.test(
          fileName,
        ),
      )
      .slice(0, 1_000);
    const reports = await Promise.all(
      fileNames.map(async fileName => {
        const candidate = path.join(jobsDirectory, fileName);
        if (!isInside(jobsDirectory, candidate)) return null;
        try {
          const entry = await stat(candidate);
          if (!entry.isFile() || entry.size > MAX_JOB_REPORT_BYTES) return null;
          const parsed = FinalRenderJobReportSchema.safeParse(
            JSON.parse(await readFile(candidate, 'utf8')),
          );
          if (!parsed.success || parsed.data.projectId !== projectId) return null;
          return parsed.data.status;
        } catch {
          return null;
        }
      }),
    );
    return reports
      .filter((status): status is FinalRenderJobStatus => Boolean(status))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
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
                rangeFrames: bridge.rangeFrames,
                fps: bridge.frame.fps,
                width: bridge.frame.width,
                height: bridge.frame.height,
                overrides: bridge.overrides,
                editorManifest: bridge.editorManifest,
                watermark: bridge.watermark,
              });
              return;
            }
            if (url.pathname === '/__pad-render/watermark') {
              if (request.method !== 'GET' || !bridge.watermarkImage) {
                sendJson(response, 404, {error: {code: 'WATERMARK_NOT_FOUND'}});
                return;
              }
              response.writeHead(200, {
                'Content-Type': bridge.watermarkImage.contentType,
                'Content-Length': String(bridge.watermarkImage.value.length),
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
              });
              response.end(bridge.watermarkImage.value);
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
              ) as {
                state?: string;
                message?: string;
                diagnostic?: unknown;
              };
              if (body.state === 'completed') bridge.complete();
              else if (body.state === 'failed') {
                bridge.fail(
                  String(body.message ?? 'Motion Canvas render thất bại.'),
                  body.diagnostic,
                );
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
            bridge.fail(
              error instanceof Error ? error.message : String(error),
            );
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
    frame: RenderProfile['frame'],
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
      await probeVideo(ffprobePath, videoPath, frame);
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
    renderProfile: RenderProfile,
  ) {
    const frame = renderProfile.frame;
    const encoding = encodingForQuality(renderProfile.quality);
    const browserSegmentFrames = frame.fps * 60;
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
    const targetDurationSeconds = layoutBundle.totalDurationSeconds;
    const sourceTimingToleranceSeconds = finalRenderTimingToleranceSeconds(
      frame.fps,
      layoutBundle.totalDurationSeconds,
    );
    const outputPaddingSeconds =
      sourceTimingToleranceSeconds + 2 / frame.fps;
    const watermark = layoutBundle.renderSettings.watermark;
    const watermarkImage =
      watermark.type === 'image'
        ? await watermarkAssets.read(
            projectId,
            watermark.assetId,
          ).then(asset => ({
            value: asset.value,
            contentType: asset.summary.contentType,
          }))
        : null;
    const requestHash = sha256(
      JSON.stringify(
        canonicalValue({
          sourceLayoutContentRevision: layoutBundle.contentRevision,
          sourceLayoutGenerationId: layoutBundle.generation.generationId,
          sourceLayoutSourceHash: layoutBundle.validation.sourceHash,
          sourceWorkspaceHash: verified.sourceWorkspaceHash,
          durationSeconds: layoutBundle.totalDurationSeconds,
          watermark,
          width: frame.width,
          height: frame.height,
          fps: frame.fps,
          crf: encoding.crf,
          preset: encoding.preset,
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
    const existing = await verifyExisting(
      targetDirectory,
      requestHash,
      generationId,
      frame,
    );
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
      frame.fps,
    );
    await mkdir(path.dirname(copiedWorkspace), {recursive: true});
    await mkdir(stagingDirectory, {recursive: true});

    let viteServer: RuntimeServer | null = null;
    let browser: ReturnType<typeof spawn> | null = null;
    let ffmpeg: ReturnType<typeof spawn> | null = null;
    let renderPhase: FinalRenderDiagnostic['stage'] = 'preparing';
    let segmentCompletion:
      | {resolve: () => void; reject: (error: Error) => void}
      | null = null;
    let terminalRenderError: Error | null = null;
    const beginSegment = () => {
      if (terminalRenderError) return Promise.reject(terminalRenderError);
      return new Promise<void>((resolve, reject) => {
        segmentCompletion = {resolve, reject};
      });
    };
    const completeRender = () => {
      const pending = segmentCompletion;
      if (!pending) return;
      segmentCompletion = null;
      pending.resolve();
    };
    const failRender = (error: Error) => {
      terminalRenderError ??= error;
      const pending = segmentCompletion;
      if (!pending) return;
      segmentCompletion = null;
      pending.reject(error);
    };
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
    const orderedFrameWriter = createOrderedFrameWriter(
      async (_frame, body: Buffer) => {
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
    );

    try {
      await copyPreviewWorkspace(
        verified.sourceWorkspaceDirectory,
        copiedWorkspace,
        {
          motionCanvasScenePaths: layoutBundle.scenes.map(
            (scene) => scene.filePath,
          ),
        },
      );
      const runtime = await loadRuntime();
      renderPhase = 'encoder';
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
          String(frame.fps),
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
          encoding.preset,
          '-crf',
          String(encoding.crf),
          '-pix_fmt',
          'yuv420p',
          '-vf',
          `tpad=stop_mode=clone:stop_duration=${outputPaddingSeconds.toFixed(6)}`,
          '-r',
          String(frame.fps),
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ar',
          '48000',
          '-t',
          targetDurationSeconds.toFixed(6),
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
              {
                cause: error,
                diagnostic: backendRenderDiagnostic(
                  'encoder',
                  error.message,
                  {frame: framesReceived > 0 ? framesReceived - 1 : null},
                ),
              },
            ),
          ),
        );
        ffmpeg?.once('exit', code => {
          if (code === 0) resolve();
          else {
            const details = ffmpegErrors.join('').slice(-4_000).trim();
            reject(
              new FinalRenderError(
                'FINAL_RENDER_ENCODER_FAILED',
                `FFmpeg dừng với mã ${String(code)} khi đang mã hóa video.`,
                {
                  diagnostic: backendRenderDiagnostic(
                    'encoder',
                    details || `FFmpeg dừng với mã ${String(code)}.`,
                    {frame: framesReceived > 0 ? framesReceived - 1 : null},
                  ),
                },
              ),
            );
          }
        });
      });
      ffmpegExit.catch(error => failRender(error));

      const bridge: RenderBridge = {
        token: randomBytes(32).toString('base64url'),
        name: `pad-studio-${projectId}`,
        durationSeconds: layoutBundle.totalDurationSeconds,
        rangeFrames: [0, Math.min(
          browserSegmentFrames - 1,
          estimatedTotalFrames - 1,
        )],
        frame,
        overrides: verified.overrides,
        editorManifest: verified.editorManifest,
        watermark,
        watermarkImage,
        async writeFrame(frame, body) {
          if (frame >= estimatedTotalFrames) {
            throw new FinalRenderError(
              'FINAL_RENDER_FRAME_SEQUENCE_INVALID',
              `Frame ${frame} vượt phạm vi render 0–${estimatedTotalFrames - 1}.`,
            );
          }
          await orderedFrameWriter.writeFrame(frame, body);
        },
        complete() {
          completeRender();
        },
        fail(message, diagnostic) {
          const normalizedDiagnostic = sanitizeRenderDiagnostic(
            diagnostic,
            [repositoryRoot, copiedWorkspace, bridge.token],
          );
          failRender(
            new FinalRenderError(
              'FINAL_RENDER_MOTION_CANVAS_FAILED',
              boundedText(message, 500) || 'Motion Canvas render thất bại.',
              {
                diagnostic:
                  normalizedDiagnostic ??
                  backendRenderDiagnostic(
                    'motion-canvas',
                    message,
                    {frame: framesReceived > 0 ? framesReceived - 1 : null},
                  ),
              },
            ),
          );
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
            '@motion-canvas/core',
            '@motion-canvas/2d',
            '@preact/signals-core',
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
          dedupe: [
            '@motion-canvas/core',
            '@motion-canvas/2d',
            '@preact/signals-core',
          ],
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
      renderPhase = 'motion-canvas';
      const timeoutMs = Math.min(
        2 * 60 * 60 * 1000,
        Math.max(5 * 60 * 1000, estimatedTotalFrames * 1_500),
      );
      const deadline = Date.now() + timeoutMs;
      let segmentIndex = 0;
      while (framesReceived < estimatedTotalFrames) {
        const segmentStartFrame = framesReceived;
        const segmentEndFrame = Math.min(
          segmentStartFrame + browserSegmentFrames - 1,
          estimatedTotalFrames - 1,
        );
        bridge.rangeFrames = [segmentStartFrame, segmentEndFrame];
        const completion = beginSegment();
        browserErrors.length = 0;
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
            `--user-data-dir=${path.join(cacheDirectory, `browser-profile-${segmentIndex}`)}`,
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
              {
                cause: error,
                diagnostic: backendRenderDiagnostic(
                  'browser',
                  error.message,
                  {frame: framesReceived > 0 ? framesReceived - 1 : null},
                ),
              },
            ),
          ),
        );
        browser.once('exit', code => {
          if (segmentCompletion) {
            const details = browserErrors.join('').slice(-4_000).trim();
            failRender(
              new FinalRenderError(
                'FINAL_RENDER_BROWSER_STOPPED',
                `Trình duyệt render dừng sớm với mã ${String(code)}.`,
                {
                  diagnostic: backendRenderDiagnostic(
                    'browser',
                    details || `Trình duyệt dừng với mã ${String(code)}.`,
                    {frame: framesReceived > 0 ? framesReceived - 1 : null},
                  ),
                },
              ),
            );
          }
        });

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new Error('Final render vượt quá thời gian cho phép.');
        }
        let timer: NodeJS.Timeout | null = null;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Final render vượt quá thời gian cho phép.')),
            remainingMs,
          );
          timer.unref();
        });
        try {
          await Promise.race([completion, timeout]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        await terminateChildProcess(browser);
        browser = null;
        if (framesReceived <= segmentStartFrame) {
          throw new FinalRenderError(
            'FINAL_RENDER_EMPTY_SEGMENT',
            `Motion Canvas không xuất frame cho segment bắt đầu tại ${segmentStartFrame}.`,
          );
        }
        if (framesReceived < segmentEndFrame + 1) {
          break;
        }
        segmentIndex += 1;
      }
      const renderedFrameTiming = inspectRenderFrameTiming(
        framesReceived,
        layoutBundle.totalDurationSeconds,
        frame.fps,
      );
      if (!renderedFrameTiming.matches) {
        throw new FinalRenderError(
          'FINAL_RENDER_FRAME_COUNT_MISMATCH',
          `Motion Canvas xuất ${framesReceived} frame (${renderedFrameTiming.encodedDurationSeconds.toFixed(3)} giây), lệch ${Math.abs(renderedFrameTiming.differenceSeconds).toFixed(3)} giây so với Layout ${layoutBundle.totalDurationSeconds.toFixed(3)} giây và vượt dung sai ${renderedFrameTiming.toleranceSeconds.toFixed(3)} giây.`,
        );
      }
      updateStatus(projectId, generationId, {
        state: 'finalizing',
        progress: 0.95,
        message: 'Đang hoàn tất MP4 và kiểm tra đầu ra…',
      });
      renderPhase = 'finalizing';
      ffmpeg.stdin?.end();
      await ffmpegExit;
      ffmpeg = null;
      const probe = await probeVideo(ffprobePath, outputVideo, frame);
      const outputTimingToleranceSeconds =
        finalRenderTimingToleranceSeconds(frame.fps, targetDurationSeconds);
      if (
        Math.abs(probe.durationSeconds - targetDurationSeconds) >
        outputTimingToleranceSeconds
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
        width: frame.width,
        height: frame.height,
        fps: frame.fps,
        watermark,
        durationSeconds: targetDurationSeconds,
        fileSizeBytes: videoStat.size,
        encoding: {
          container: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          pixelFormat: 'yuv420p',
          crf: encoding.crf,
          preset: encoding.preset,
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
        diagnostic: null,
      });
      return bundle;
    } catch (error) {
      const baseError =
        error instanceof FinalRenderError
          ? error
          : new FinalRenderError(
              'FINAL_RENDER_FAILED',
              error instanceof Error ? error.message : 'Final render thất bại.',
              {
                cause: error,
                diagnostic: backendRenderDiagnostic(
                  renderPhase,
                  error instanceof Error
                    ? error.message
                    : 'Final render thất bại.',
                  {frame: framesReceived > 0 ? framesReceived - 1 : null},
                ),
              },
            );
      const renderError = baseError.diagnostic
        ? baseError
        : new FinalRenderError(baseError.code, baseError.message, {
            cause: baseError,
            diagnostic: backendRenderDiagnostic(
              renderPhase,
              baseError.message,
              {frame: framesReceived > 0 ? framesReceived - 1 : null},
            ),
          });
      updateStatus(projectId, generationId, {
        state: 'failed',
        errorCode: renderError.code,
        message: renderError.message,
        diagnostic: renderError.diagnostic,
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
    render(
      projectId,
      generationId,
      contentRevision,
      syncBundle,
      layoutBundle,
      renderProfile = defaultRenderProfile,
    ) {
      assertProjectId(projectId);
      assertGenerationId(generationId);
      const key = jobKey(projectId, generationId);
      const active = activeRenders.get(key);
      if (active) return active;
      const now = new Date().toISOString();
      const totalFrames = estimateRenderFrameCount(
        layoutBundle.totalDurationSeconds,
        renderProfile.frame.fps,
      );
      statuses.set(
        key,
        FinalRenderJobStatusSchema.parse({
          generationId,
          state: 'queued',
          progress: 0,
          renderedFrames: 0,
          totalFrames,
          startedAt: null,
          updatedAt: now,
          message: 'Đã xếp hàng render.',
          errorCode: null,
          diagnostic: null,
        }),
      );
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
            renderProfile,
          ),
        )
        .then(async bundle => {
          const status = statuses.get(key);
          if (status?.state === 'completed') {
            await persistTerminalStatus(
              projectId,
              layoutBundle,
              status,
              bundle,
            ).catch(
              error => logger.error(error),
            );
          }
          return bundle;
        })
        .catch(async error => {
          const baseError =
            error instanceof FinalRenderError
              ? error
              : new FinalRenderError(
                  'FINAL_RENDER_FAILED',
                  error instanceof Error
                    ? error.message
                    : 'Final render thất bại.',
                  {cause: error},
                );
          const renderError = baseError.diagnostic
            ? baseError
            : new FinalRenderError(baseError.code, baseError.message, {
                cause: baseError,
                diagnostic: backendRenderDiagnostic(
                  diagnosticStageForErrorCode(baseError.code),
                  baseError.message,
                  {
                    frame:
                      (statuses.get(key)?.renderedFrames ?? 0) > 0
                        ? (statuses.get(key)?.renderedFrames ?? 1) - 1
                        : null,
                  },
                ),
              });
          if (
            statuses.get(key)?.state !== 'failed' ||
            !statuses.get(key)?.diagnostic
          ) {
            updateStatus(projectId, generationId, {
              state: 'failed',
              errorCode: renderError.code,
              message: renderError.message,
              diagnostic: renderError.diagnostic,
            });
          }
          const status = statuses.get(key);
          if (status?.state === 'failed') {
            await persistTerminalStatus(projectId, layoutBundle, status).catch(
              persistenceError => logger.error(persistenceError),
            );
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

    async getStatus(projectId, generationId) {
      assertProjectId(projectId);
      const resolvedGeneration = generationId ?? latestByProject.get(projectId);
      if (resolvedGeneration) {
        assertGenerationId(resolvedGeneration);
        const memoryStatus = statuses.get(
          jobKey(projectId, resolvedGeneration),
        );
        if (memoryStatus) return memoryStatus;
      }
      return readPersistedStatus(projectId, resolvedGeneration);
    },

    async getCompletedBundle(projectId, generationId) {
      assertProjectId(projectId);
      assertGenerationId(generationId);
      const report = await readPersistedReport(projectId, generationId);
      if (
        report?.status.state !== 'completed' ||
        !report.bundle ||
        report.bundle.generation.generationId !== generationId
      ) {
        return null;
      }
      return report.bundle;
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
