import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  ApproveLayoutSchema,
  CommitLayoutSchema,
  CreateTopicProjectSchema,
  GenerateFinalRenderSchema,
  GenerateAnimationSyncSchema,
  GenerateMotionCanvasSchema,
  GenerateTeachingOutlineSchema,
  GenerateVoiceSchema,
  GenerateVoiceVisualPlanSchema,
  TeachingOutlineContentSchema,
  UpdateProjectSchema,
  VoiceVisualPlanContentSchema,
  type ApiErrorPayload,
  type AnimationSyncBundle,
  type FinalRenderBundle,
  type LayoutBundle,
  type MotionCanvasBundle,
  type TeachingOutline,
  type TopicProject,
  type VoiceBundle,
  type VoiceVisualPlan,
  type VoiceVisualPlanContent,
} from '../shared/topic.ts';
import type {ElevenLabsUsagePreset} from '../shared/elevenLabs.ts';
import {LayoutBundleSchema} from '../shared/layout.ts';
import {
  finalRenderIsReady,
  finalRenderPrerequisitesAreReady,
  layoutMatchesAnimationSync,
  layoutPrerequisitesAreReady,
  motionCanvasMatchesOutline,
  sameValue,
  voiceVisualMatchesOutline,
} from '../shared/projectPipeline.ts';
import {
  AnimationSyncWorkspaceError,
  createAnimationSyncWorkspace,
  type AnimationSyncWorkspace,
  type PreparedAnimationSyncWorkspace,
} from './animationSyncWorkspace.ts';
import {
  AnimationSyncPreviewError,
  createAnimationSyncPreviewService,
  type AnimationSyncPreviewService,
} from './animationSyncPreviewService.ts';
import {
  createLayoutPreviewService,
  LayoutPreviewError,
  type LayoutPreviewService,
} from './layoutPreviewService.ts';
import {
  createLayoutWorkspace,
  LayoutWorkspaceError,
  type LayoutWorkspace,
  type PreparedLayoutWorkspace,
} from './layoutWorkspace.ts';
import {
  createFinalRenderService,
  FinalRenderError,
  type FinalRenderService,
} from './finalRenderService.ts';
import {
  CodexConnectionError,
  createCodexConnectionService,
  StdioCodexAppServerClient,
  type CodexAppServerClient,
  type CodexConnectionService,
} from './codexConnection.ts';
import {
  createElevenLabsConnectionService,
  type ElevenLabsConnectionService,
} from './elevenLabsConnection.ts';
import {
  createElevenLabsVoiceService,
  ElevenLabsVoiceError,
  type ElevenLabsSectionGeneration,
  type ElevenLabsVoiceService,
} from './elevenLabsVoiceService.ts';
import {
  createCodexOutlineGenerator,
  OutlineGenerationError,
  OUTLINE_PROMPT_VERSION,
  type OutlineGenerationResult,
  type OutlineGenerator,
} from './outlineGenerator.ts';
import {
  createCodexMotionCanvasGenerator,
  MOTION_CANVAS_FPS,
  MOTION_CANVAS_HEIGHT,
  MOTION_CANVAS_PROMPT_VERSION,
  MOTION_CANVAS_WIDTH,
  MotionCanvasGenerationError,
  type MotionCanvasGenerationResult,
  type MotionCanvasGenerator,
} from './motionCanvasGenerator.ts';
import {
  createMotionCanvasWorkspace,
  MotionCanvasWorkspaceError,
  type PreparedMotionCanvasWorkspace,
  type MotionCanvasWorkspace,
} from './motionCanvasWorkspace.ts';
import {
  buildNarrationSource,
  splitNarrationSource,
} from './narrationSource.ts';
import {
  createFileProjectRepository,
  ProjectConflictError,
  ProjectDataError,
  type ProjectRepository,
} from './projectRepository.ts';
import {
  animationSyncMatchesSources,
  voiceMatchesPlan,
} from './projectConsistency.ts';
import {
  createCodexVoiceVisualGenerator,
  VoiceVisualGenerationError,
  VOICE_VISUAL_PROMPT_VERSION,
  type VoiceVisualGenerationResult,
  type VoiceVisualGenerator,
} from './voiceVisualGenerator.ts';
import {
  createVoiceWorkspace,
  type PreparedVoiceWorkspace,
  VoiceWorkspaceError,
  type VoiceWorkspace,
} from './voiceWorkspace.ts';
import {plannedBeatDurationSeconds} from '../shared/narrationTiming.ts';

// A valid voice–visual plan can contain up to 80 narration/visual beats.
// Keep a bounded request size, but leave enough room for the strict schema's
// maximum UTF-8 payload instead of rejecting valid content before validation.
const MAX_JSON_BODY_SIZE = 1024 * 1024;

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

interface AppOptions {
  projectsDirectory?: string;
  frontendDirectory?: string;
  repository?: ProjectRepository;
  codexConnection?: CodexConnectionService;
  elevenLabsConnection?: ElevenLabsConnectionService;
  elevenLabsVoiceService?: ElevenLabsVoiceService;
  outlineGenerator?: OutlineGenerator;
  voiceVisualGenerator?: VoiceVisualGenerator;
  motionCanvasGenerator?: MotionCanvasGenerator;
  motionCanvasWorkspace?: MotionCanvasWorkspace;
  voiceWorkspace?: VoiceWorkspace;
  animationSyncWorkspace?: AnimationSyncWorkspace;
  animationSyncPreviewService?: AnimationSyncPreviewService;
  layoutWorkspace?: LayoutWorkspace;
  layoutPreviewService?: LayoutPreviewService;
  finalRenderService?: FinalRenderService;
  logger?: Pick<Console, 'error' | 'info'>;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function sendProject(
  response: ServerResponse,
  statusCode: number,
  project: TopicProject,
) {
  sendJson(
    response,
    statusCode,
    {project},
    {ETag: `"${project.revision}"`},
  );
}

function sendApiError(
  response: ServerResponse,
  statusCode: number,
  error: ApiErrorPayload['error'],
) {
  sendJson(response, statusCode, {error} satisfies ApiErrorPayload);
}

interface ByteRange {
  start: number;
  end: number;
}

function parseByteRange(
  rangeHeader: string,
  contentLength: number,
): ByteRange | null {
  if (
    contentLength <= 0 ||
    !rangeHeader.startsWith('bytes=') ||
    rangeHeader.includes(',')
  ) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader.trim());
  if (!match) return null;

  const [, rawStart = '', rawEnd = ''] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, contentLength - suffixLength),
      end: contentLength - 1,
    };
  }

  const start = Number(rawStart);
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start >= contentLength
  ) {
    return null;
  }

  const requestedEnd = rawEnd ? Number(rawEnd) : contentLength - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;

  return {
    start,
    end: Math.min(requestedEnd, contentLength - 1),
  };
}

function sendMediaBuffer(
  request: IncomingMessage,
  response: ServerResponse,
  buffer: Buffer,
  contentType: string,
  headers: Record<string, string>,
) {
  const sharedHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    ...headers,
  };
  const rangeHeader = request.headers.range;

  if (!rangeHeader) {
    response.writeHead(200, {
      ...sharedHeaders,
      'Content-Length': String(buffer.byteLength),
    });
    response.end(buffer);
    return;
  }

  const range = parseByteRange(rangeHeader, buffer.byteLength);
  if (!range) {
    response.writeHead(416, {
      ...sharedHeaders,
      'Content-Range': `bytes */${buffer.byteLength}`,
      'Content-Length': '0',
    });
    response.end();
    return;
  }

  const partialBuffer = buffer.subarray(range.start, range.end + 1);
  response.writeHead(206, {
    ...sharedHeaders,
    'Content-Length': String(partialBuffer.byteLength),
    'Content-Range': `bytes ${range.start}-${range.end}/${buffer.byteLength}`,
  });
  response.end(partialBuffer);
}

function sendMediaFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
  contentLength: number,
  contentType: string,
  headers: Record<string, string>,
) {
  const sharedHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    ...headers,
  };
  const rangeHeader = request.headers.range;
  if (!rangeHeader) {
    response.writeHead(200, {
      ...sharedHeaders,
      'Content-Length': String(contentLength),
    });
    if (request.method === 'HEAD') response.end();
    else {
      const stream = createReadStream(filePath);
      stream.on('error', error => response.destroy(error));
      stream.pipe(response);
    }
    return;
  }
  const range = parseByteRange(rangeHeader, contentLength);
  if (!range) {
    response.writeHead(416, {
      ...sharedHeaders,
      'Content-Range': `bytes */${contentLength}`,
      'Content-Length': '0',
    });
    response.end();
    return;
  }
  response.writeHead(206, {
    ...sharedHeaders,
    'Content-Length': String(range.end - range.start + 1),
    'Content-Range': `bytes ${range.start}-${range.end}/${contentLength}`,
  });
  if (request.method === 'HEAD') response.end();
  else {
    const stream = createReadStream(filePath, range);
    stream.on('error', error => response.destroy(error));
    stream.pipe(response);
  }
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;

    if (receivedBytes > MAX_JSON_BODY_SIZE) {
      throw new RequestBodyError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Dữ liệu gửi lên vượt quá giới hạn cho phép.',
      );
    }

    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestBodyError(
      400,
      'INVALID_JSON',
      'Dữ liệu JSON không hợp lệ.',
    );
  }
}

class RequestBodyError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(
    statusCode: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function readExpectedRevision(request: IncomingMessage) {
  const header = request.headers['if-match'];
  const value = Array.isArray(header) ? header[0] : header;

  if (!value) {
    throw new RequestBodyError(
      428,
      'PRECONDITION_REQUIRED',
      'Cần gửi revision hiện tại của project trước khi thay đổi.',
    );
  }

  const match = /^(?:"([1-9]\d*)"|([1-9]\d*))$/.exec(value.trim());
  const revisionValue = match?.[1] ?? match?.[2];
  if (!revisionValue) {
    throw new RequestBodyError(
      400,
      'INVALID_PRECONDITION',
      'Revision của project không hợp lệ.',
    );
  }

  const revision = Number(revisionValue);
  if (!Number.isSafeInteger(revision)) {
    throw new RequestBodyError(
      400,
      'INVALID_PRECONDITION',
      'Revision của project không hợp lệ.',
    );
  }

  return revision;
}

function requestParentOrigin(request: IncomingMessage) {
  const declaredOriginHeader =
    request.headers['x-pad-parent-origin'];
  const declaredOriginValue = Array.isArray(declaredOriginHeader)
    ? declaredOriginHeader[0]
    : declaredOriginHeader;
  const originHeader = request.headers.origin;
  const originValue = Array.isArray(originHeader)
    ? originHeader[0]
    : originHeader;
  const fallbackHost = request.headers.host;
  const candidate =
    declaredOriginValue?.trim() ||
    originValue?.trim() ||
    (fallbackHost ? `http://${fallbackHost}` : 'http://127.0.0.1');

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    const loopback =
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '::1' ||
      hostname.startsWith('127.');
    const sameRequestHost =
      typeof fallbackHost === 'string' &&
      url.host.toLowerCase() === fallbackHost.toLowerCase();
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.origin.length > 240 ||
      url.origin !== candidate ||
      (!loopback && !sameRequestHost)
    ) {
      throw new Error('Invalid parent origin');
    }
    return url.origin;
  } catch {
    throw new RequestBodyError(
      400,
      'LAYOUT_PREVIEW_PARENT_ORIGIN_INVALID',
      'Origin của Layout Editor không hợp lệ.',
    );
  }
}

function validationFields(
  issues: Array<{path: PropertyKey[]; message: string}>,
) {
  const fields: Record<string, string[]> = {};

  for (const issue of issues) {
    const field = String(
      issue.path[0] === 'topicInput'
        ? (issue.path[1] ?? 'form')
        : (issue.path[0] ?? 'form'),
    );
    fields[field] ??= [];
    fields[field].push(issue.message);
  }

  return fields;
}

function getProjectId(pathname: string) {
  const match = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  if (!match?.[1]) return null;

  return decodeProjectId(match[1]);
}

function decodeProjectId(value: string) {
  try {
    const projectId = decodeURIComponent(value);
    return /^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId) ? projectId : null;
  } catch {
    return null;
  }
}

function getProjectOutlineRoute(pathname: string) {
  const match =
    /^\/api\/projects\/([^/]+)\/outline(?:\/(generate|approve))?$/.exec(
      pathname,
    );
  if (!match?.[1]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId) return null;

  return {
    projectId,
    action: match[2] ?? 'update',
  } as const;
}

function getProjectVoiceVisualRoute(pathname: string) {
  const match =
    /^\/api\/projects\/([^/]+)\/voice-visual(?:\/(generate|approve))?$/.exec(
      pathname,
    );
  if (!match?.[1]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId) return null;

  return {
    projectId,
    action: match[2] ?? 'update',
  } as const;
}

function getProjectMotionCanvasRoute(pathname: string) {
  const match =
    /^\/api\/projects\/([^/]+)\/motion-canvas(?:\/(generate|approve|files))?$/.exec(
      pathname,
    );
  if (!match?.[1]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId) return null;

  return {
    projectId,
    action: match[2] ?? 'read',
  } as const;
}

function getProjectVoiceRoute(pathname: string) {
  const audioMatch =
    /^\/api\/projects\/([^/]+)\/voice\/audio\/([^/]+)$/.exec(pathname);
  if (audioMatch?.[1] && audioMatch[2]) {
    const projectId = decodeProjectId(audioMatch[1]);
    if (!projectId) return null;
    try {
      return {
        projectId,
        action: 'audio' as const,
        outlineSectionId: decodeURIComponent(audioMatch[2]),
      };
    } catch {
      return null;
    }
  }

  const match =
    /^\/api\/projects\/([^/]+)\/voice(?:\/(generate|approve))?$/.exec(
      pathname,
    );
  if (!match?.[1]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId) return null;
  return {
    projectId,
    action: (match[2] ?? 'read') as 'generate' | 'approve' | 'read',
    outlineSectionId: null,
  };
}

function getProjectAnimationSyncRoute(pathname: string) {
  const match =
    /^\/api\/projects\/([^/]+)\/sync(?:\/(generate|approve|files|audio|preview))?$/.exec(
      pathname,
    );
  if (!match?.[1]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId) return null;

  return {
    projectId,
    action: (match[2] ?? 'read') as
      | 'generate'
      | 'approve'
      | 'files'
      | 'audio'
      | 'preview'
      | 'read',
  };
}

function getProjectLayoutRoute(pathname: string) {
  const match =
    /^\/api\/projects\/([^/]+)\/layout(?:\/(commit|approve|files|preview))?$/.exec(
      pathname,
    );
  if (!match?.[1]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId) return null;

  return {
    projectId,
    action: (match[2] ?? 'read') as
      | 'commit'
      | 'approve'
      | 'files'
      | 'preview'
      | 'read',
  };
}

function getProjectRenderRoute(pathname: string) {
  const match =
    /^\/api\/projects\/([^/]+)\/render(?:\/(generate|status|video))?$/.exec(
      pathname,
    );
  if (!match?.[1]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId) return null;
  return {
    projectId,
    action: (match[2] ?? 'read') as
      | 'generate'
      | 'status'
      | 'video'
      | 'read',
  };
}

function outlineContent(outline: TeachingOutline) {
  return {
    brief: outline.brief,
    centralMessage: outline.centralMessage,
    sections: outline.sections,
  };
}

function voiceVisualContent(plan: VoiceVisualPlan) {
  return {
    voiceDirection: plan.voiceDirection,
    visualDirection: plan.visualDirection,
    timingCalibration: plan.timingCalibration,
    sections: plan.sections,
  };
}

function normalizedVoiceVisualContent(
  content: VoiceVisualPlanContent,
) {
  return {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      beats: section.beats.map((beat) => {
        const visualHoldSeconds = Math.max(
          0,
          Math.min(30, Math.round(beat.visualHoldSeconds)),
        );
        return {
          ...beat,
          visualHoldSeconds,
          durationSeconds: plannedBeatDurationSeconds(
            beat.voiceover,
            visualHoldSeconds,
            content.timingCalibration,
          ),
        };
      }),
    })),
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

async function preferredNarrationCalibration(
  repository: ProjectRepository,
): Promise<VoiceVisualPlanContent['timingCalibration'] | undefined> {
  const {projects} = await repository.listProjects();
  const bundles = projects
    .map((project) => project.voiceBundle)
    .filter((bundle): bundle is VoiceBundle => bundle !== null)
    .sort((left, right) =>
      right.generation.generatedAt.localeCompare(left.generation.generatedAt),
    );
  const latest = bundles[0];
  if (!latest) return undefined;
  const matching = bundles.filter(
    (bundle) =>
      bundle.configuration.voiceId === latest.configuration.voiceId &&
      bundle.configuration.modelId === latest.configuration.modelId &&
      bundle.configuration.settings.speed ===
        latest.configuration.settings.speed,
  );
  return {
    source: 'voice-history',
    voiceId: latest.configuration.voiceId,
    modelId: latest.configuration.modelId,
    voiceName: latest.configuration.voiceName,
    sampleCount: matching.length,
    whitespaceTokensPerMinute: median(
      matching.map(
        (bundle) =>
          bundle.track.calibration.whitespaceTokensPerMinute,
      ),
    ),
    charactersPerSecond: median(
      matching.map(
        (bundle) => bundle.track.calibration.charactersPerSecond,
      ),
    ),
  };
}

function narrationIdentity(plan: {
  sections: Array<{
    outlineSectionId: string;
    beats: Array<{id: string; voiceover: string}>;
  }>;
}) {
  return plan.sections.map((section) => ({
    outlineSectionId: section.outlineSectionId,
    beats: section.beats.map((beat) => ({
      id: beat.id,
      voiceover: beat.voiceover.trim(),
    })),
  }));
}

function nextNarrationRevision(
  currentPlan: VoiceVisualPlan | null,
  nextPlan: VoiceVisualPlanContent,
) {
  if (!currentPlan) return 1;
  return sameValue(
    narrationIdentity(currentPlan),
    narrationIdentity(nextPlan),
  )
    ? currentPlan.narrationRevision
    : currentPlan.narrationRevision + 1;
}

async function localVoicePresets(
  repository: ProjectRepository,
): Promise<ElevenLabsUsagePreset[]> {
  const {projects} = await repository.listProjects();
  const grouped = new Map<string, ElevenLabsUsagePreset>();
  for (const project of projects) {
    const bundle = project.voiceBundle;
    if (!bundle) continue;
    const configuration = bundle.configuration;
    const key = JSON.stringify({
      voiceId: configuration.voiceId,
      modelId: configuration.modelId,
      settings: configuration.settings,
    });
    const current = grouped.get(key);
    if (current) {
      current.successfulGenerations += 1;
      if (bundle.generation.generatedAt > current.usedAt) {
        current.usedAt = bundle.generation.generatedAt;
        current.timingCalibration = {
          whitespaceTokensPerMinute:
            bundle.track.calibration.whitespaceTokensPerMinute,
          charactersPerSecond:
            bundle.track.calibration.charactersPerSecond,
        };
      }
      continue;
    }
    grouped.set(key, {
      id: `pad-studio:${configuration.voiceId}:${configuration.modelId}:${grouped.size}`,
      source: 'pad-studio',
      voiceId: configuration.voiceId,
      voiceName: configuration.voiceName,
      modelId: configuration.modelId,
      modelName: configuration.modelName,
      usedAt: bundle.generation.generatedAt,
      successfulGenerations: 1,
      settings: configuration.settings,
      timingCalibration: {
        whitespaceTokensPerMinute:
          bundle.track.calibration.whitespaceTokensPerMinute,
        charactersPerSecond:
          bundle.track.calibration.charactersPerSecond,
      },
    });
  }
  return [...grouped.values()];
}

async function serveFrontend(
  request: IncomingMessage,
  response: ServerResponse,
  frontendDirectory: string,
) {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  const requestedPath = decodeURIComponent(requestUrl.pathname);
  const relativePath =
    requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  const candidatePath = path.resolve(frontendDirectory, relativePath);
  const frontendRoot = path.resolve(frontendDirectory);
  const isInsideFrontend =
    candidatePath === frontendRoot ||
    candidatePath.startsWith(`${frontendRoot}${path.sep}`);

  let filePath = candidatePath;

  if (!isInsideFrontend) {
    sendApiError(response, 404, {
      code: 'NOT_FOUND',
      message: 'Không tìm thấy tài nguyên.',
    });
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error('Not a file');
  } catch {
    filePath = path.join(frontendRoot, 'index.html');
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error('Not a file');

    response.writeHead(200, {
      'Content-Type':
        contentTypes[path.extname(filePath).toLowerCase()] ??
        'application/octet-stream',
      'Content-Length': fileStats.size,
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch {
    const fallback = await readFile(
      new URL('../../README.md', import.meta.url),
      'utf8',
    ).catch(() => '');

    sendApiError(response, 404, {
      code: 'FRONTEND_NOT_BUILT',
      message: fallback
        ? 'Frontend chưa được build. Hãy chạy npm run dev hoặc npm run build.'
        : 'Frontend chưa sẵn sàng.',
    });
  }
}

const serverCleanupTasks = new WeakMap<Server, () => Promise<void>>();

export function closePadStudioServerServices(server: Server): Promise<void> {
  return serverCleanupTasks.get(server)?.() ?? Promise.resolve();
}

export function createPadStudioServer(options: AppOptions = {}) {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectsDirectory =
    options.projectsDirectory ?? path.resolve(moduleDirectory, '../../projects');
  const frontendDirectory =
    options.frontendDirectory ??
    path.resolve(moduleDirectory, '../../dist/frontend');
  const repository =
    options.repository ?? createFileProjectRepository(projectsDirectory);
  const sharedCodexClient: CodexAppServerClient | null =
    !options.codexConnection ||
    !options.outlineGenerator ||
    !options.voiceVisualGenerator ||
    !options.motionCanvasGenerator
      ? new StdioCodexAppServerClient()
      : null;
  const codexConnection =
    options.codexConnection ??
    createCodexConnectionService(sharedCodexClient!);
  const elevenLabsConnection =
    options.elevenLabsConnection ??
    createElevenLabsConnectionService();
  const elevenLabsVoiceService =
    options.elevenLabsVoiceService ??
    createElevenLabsVoiceService();
  const outlineGenerator =
    options.outlineGenerator ??
    createCodexOutlineGenerator(sharedCodexClient!);
  const voiceVisualGenerator =
    options.voiceVisualGenerator ??
    createCodexVoiceVisualGenerator(sharedCodexClient!);
  const motionCanvasGenerator =
    options.motionCanvasGenerator ??
    createCodexMotionCanvasGenerator(sharedCodexClient!, {
      ...(process.env.PAD_MOTION_CANVAS_MODEL?.trim()
        ? {model: process.env.PAD_MOTION_CANVAS_MODEL.trim()}
        : {}),
      ...(process.env.PAD_MOTION_CANVAS_REASONING_EFFORT?.trim()
        ? {
            reasoningEffort:
              process.env.PAD_MOTION_CANVAS_REASONING_EFFORT.trim(),
          }
        : {}),
    });
  const motionCanvasWorkspace =
    options.motionCanvasWorkspace ??
    createMotionCanvasWorkspace(projectsDirectory);
  const voiceWorkspace =
    options.voiceWorkspace ?? createVoiceWorkspace(projectsDirectory);
  const animationSyncWorkspace =
    options.animationSyncWorkspace ??
    createAnimationSyncWorkspace(projectsDirectory);
  const animationSyncPreviewService =
    options.animationSyncPreviewService ??
    createAnimationSyncPreviewService(projectsDirectory);
  const layoutWorkspace =
    options.layoutWorkspace ?? createLayoutWorkspace(projectsDirectory);
  const layoutPreviewService =
    options.layoutPreviewService ??
    createLayoutPreviewService(projectsDirectory);
  const finalRenderService =
    options.finalRenderService ??
    createFinalRenderService(projectsDirectory, {layoutWorkspace, logger: options.logger});
  const logger = options.logger ?? console;
  type GenerationCacheEntry<Result> = {
    fingerprint: string;
    promise: Promise<{result: Result; generatedAt: string}>;
  };
  const outlineGenerations = new Map<
    string,
    GenerationCacheEntry<OutlineGenerationResult>
  >();
  const voiceVisualGenerations = new Map<
    string,
    GenerationCacheEntry<VoiceVisualGenerationResult>
  >();
  const motionCanvasGenerations = new Map<
    string,
    GenerationCacheEntry<{
      generated: MotionCanvasGenerationResult;
      prepared: PreparedMotionCanvasWorkspace;
    }>
  >();
  const voiceGenerations = new Map<
    string,
    GenerationCacheEntry<{
      configuration: VoiceBundle['configuration'];
      prepared: PreparedVoiceWorkspace;
    }>
  >();
  const voiceSectionGenerations = new Map<
    string,
    GenerationCacheEntry<ElevenLabsSectionGeneration>
  >();
  const animationSyncGenerations = new Map<
    string,
    GenerationCacheEntry<PreparedAnimationSyncWorkspace>
  >();
  const layoutGenerations = new Map<
    string,
    GenerationCacheEntry<PreparedLayoutWorkspace>
  >();

  function generateOnce<Result>(
    generations: Map<string, GenerationCacheEntry<Result>>,
    key: string,
    fingerprint: string,
    operation: () => Promise<Result>,
  ) {
    const existing = generations.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new RequestBodyError(
          409,
          'GENERATION_ID_REUSED',
          'Generation ID đã được dùng với nội dung khác.',
        );
      }
      return existing.promise;
    }

    const promise = operation().then((result) => ({
      result,
      generatedAt: new Date().toISOString(),
    }));
    generations.set(key, {fingerprint, promise});
    void promise.catch(() => {
      if (generations.get(key)?.promise === promise) {
        generations.delete(key);
      }
    });

    if (generations.size > 50) {
      const oldestKey = generations.keys().next().value;
      if (oldestKey) generations.delete(oldestKey);
    }

    return promise;
  }

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');

      if (requestUrl.pathname === '/api/health' && request.method === 'GET') {
        sendJson(response, 200, {status: 'ok'});
        return;
      }

      if (
        requestUrl.pathname === '/api/integrations/codex/status' &&
        request.method === 'GET'
      ) {
        const status = await codexConnection.verifyConnection();
        sendJson(response, 200, {status});
        return;
      }

      if (
        requestUrl.pathname === '/api/integrations/codex/login' &&
        request.method === 'POST'
      ) {
        const login = await codexConnection.startChatGptLogin();
        sendJson(response, 200, {login});
        return;
      }

      if (
        requestUrl.pathname === '/api/integrations/elevenlabs/status' &&
        request.method === 'GET'
      ) {
        const status = await elevenLabsConnection.verifyConnection();
        sendJson(response, 200, {status});
        return;
      }

      if (
        requestUrl.pathname === '/api/integrations/elevenlabs/catalog' &&
        request.method === 'GET'
      ) {
        const catalog = await elevenLabsVoiceService.getCatalog(
          requestUrl.searchParams.get('search')?.trim().slice(0, 120) ?? '',
          await localVoicePresets(repository),
        );
        sendJson(response, 200, {catalog});
        return;
      }

      if (
        requestUrl.pathname ===
          '/api/integrations/elevenlabs/shared-voices' &&
        request.method === 'GET'
      ) {
        const result = await elevenLabsVoiceService.searchSharedVoices(
          requestUrl.searchParams.get('search')?.trim().slice(0, 120) ?? '',
        );
        sendJson(response, 200, {result});
        return;
      }

      if (requestUrl.pathname === '/api/projects' && request.method === 'GET') {
        const projectList = await repository.listProjects();
        sendJson(response, 200, projectList);
        return;
      }

      if (requestUrl.pathname === '/api/projects' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const parsedInput = CreateTopicProjectSchema.safeParse(body);

        if (!parsedInput.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Một vài thông tin cần được kiểm tra lại.',
            fields: validationFields(parsedInput.error.issues),
          });
          return;
        }

        const project = await repository.createTopicProject(parsedInput.data);
        sendProject(response, 201, project);
        return;
      }

      const outlineRoute = getProjectOutlineRoute(requestUrl.pathname);

      if (
        outlineRoute?.action === 'generate' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = GenerateTeachingOutlineSchema.safeParse(body);

        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Yêu cầu tạo mạch giảng chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }
        const currentProject = await repository.getProject(
          outlineRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        if (
          currentProject.outline?.generation.generationId ===
          parsedRequest.data.generationId
        ) {
          sendProject(response, 200, currentProject);
          return;
        }

        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }

        const generationKey = `${currentProject.id}:${parsedRequest.data.generationId}`;
        const fingerprint = JSON.stringify({
          topicInput: currentProject.topicInput,
          guidance: parsedRequest.data.guidance,
          currentOutline: parsedRequest.data.guidance
            ? currentProject.outline
            : undefined,
        });
        const generation = await generateOnce(
          outlineGenerations,
          generationKey,
          fingerprint,
          () =>
            outlineGenerator.generate({
              topicInput: currentProject.topicInput,
              guidance: parsedRequest.data.guidance,
              currentOutline: currentProject.outline ?? undefined,
            }),
        );
        const outline: TeachingOutline = {
          ...generation.result.content,
          status: 'draft',
          contentRevision:
            (currentProject.outline?.contentRevision ?? 0) + 1,
          sourceInput: currentProject.topicInput,
          generation: {
            generationId: parsedRequest.data.generationId,
            provider: 'codex',
            model: generation.result.model,
            promptVersion: OUTLINE_PROMPT_VERSION,
            generatedAt: generation.generatedAt,
            usage: generation.result.usage,
          },
        };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {outline},
          expectedRevision,
        );

        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        sendProject(response, 200, updatedProject);
        return;
      }

      if (
        outlineRoute?.action === 'update' &&
        request.method === 'PUT'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedContent = TeachingOutlineContentSchema.safeParse(body);

        if (!parsedContent.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Mạch giảng chưa hợp lệ.',
            fields: validationFields(parsedContent.error.issues),
          });
          return;
        }

        const currentProject = await repository.getProject(
          outlineRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (!currentProject.outline) {
          throw new RequestBodyError(
            409,
            'OUTLINE_NOT_READY',
            'Project chưa có mạch giảng để chỉnh sửa.',
          );
        }

        const unchanged = sameValue(
          outlineContent(currentProject.outline),
          parsedContent.data,
        );
        const outline: TeachingOutline = unchanged
          ? currentProject.outline
          : {
              ...parsedContent.data,
              status: 'draft',
              contentRevision: currentProject.outline.contentRevision + 1,
              sourceInput: currentProject.outline.sourceInput,
              generation: currentProject.outline.generation,
            };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {outline},
          expectedRevision,
        );

        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        sendProject(response, 200, updatedProject);
        return;
      }

      if (
        outlineRoute?.action === 'approve' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const currentProject = await repository.getProject(
          outlineRoute.projectId,
        );

        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (!currentProject.outline) {
          throw new RequestBodyError(
            409,
            'OUTLINE_NOT_READY',
            'Hãy tạo mạch giảng trước khi chốt.',
          );
        }
        if (
          !sameValue(
            currentProject.outline.sourceInput,
            currentProject.topicInput,
          )
        ) {
          throw new RequestBodyError(
            409,
            'OUTLINE_OUTDATED',
            'Đầu vào đã thay đổi. Hãy tạo lại mạch giảng trước khi chốt.',
          );
        }

        const outline: TeachingOutline = {
          ...currentProject.outline,
          status: 'approved',
        };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {outline, currentStep: 'voiceVisual'},
          expectedRevision,
        );

        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        sendProject(response, 200, updatedProject);
        return;
      }

      const voiceVisualRoute = getProjectVoiceVisualRoute(
        requestUrl.pathname,
      );

      if (
        voiceVisualRoute?.action === 'generate' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = GenerateVoiceVisualPlanSchema.safeParse(body);

        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Yêu cầu tạo kế hoạch voice–visual chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }

        const currentProject = await repository.getProject(
          voiceVisualRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        if (
          currentProject.voiceVisualPlan?.generation.generationId ===
          parsedRequest.data.generationId
        ) {
          sendProject(response, 200, currentProject);
          return;
        }

        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }

        const outline = currentProject.outline;
        if (!outline || outline.status !== 'approved') {
          throw new RequestBodyError(
            409,
            'OUTLINE_NOT_APPROVED',
            'Hãy chốt mạch giảng trước khi tạo kế hoạch voice–visual.',
          );
        }
        if (!sameValue(outline.sourceInput, currentProject.topicInput)) {
          throw new RequestBodyError(
            409,
            'OUTLINE_OUTDATED',
            'Đầu vào đã thay đổi. Hãy tạo lại và chốt mạch giảng trước.',
          );
        }

        const currentPlanUsable = Boolean(
          currentProject.voiceVisualPlan &&
            currentProject.voiceVisualPlan.sourceOutlineContentRevision ===
              outline.contentRevision &&
            voiceVisualMatchesOutline(
              currentProject.voiceVisualPlan,
              outline,
            ),
        );
        if (
          parsedRequest.data.guidance &&
          currentProject.voiceVisualPlan &&
          !currentPlanUsable
        ) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_OUTDATED',
            'Mạch giảng đã thay đổi. Hãy tạo lại kế hoạch trước khi góp ý.',
          );
        }

        const generationKey = `${currentProject.id}:${parsedRequest.data.generationId}`;
        const currentPlan =
          parsedRequest.data.guidance && currentPlanUsable
            ? currentProject.voiceVisualPlan ?? undefined
            : undefined;
        const timingCalibration =
          currentPlan?.timingCalibration ??
          (await preferredNarrationCalibration(repository));
        const fingerprint = JSON.stringify({
          topicInput: currentProject.topicInput,
          outline: outlineContent(outline),
          outlineContentRevision: outline.contentRevision,
          guidance: parsedRequest.data.guidance,
          currentPlan: currentPlan
            ? voiceVisualContent(currentPlan)
            : undefined,
          timingCalibration,
        });
        const generation = await generateOnce(
          voiceVisualGenerations,
          generationKey,
          fingerprint,
          () =>
            voiceVisualGenerator.generate({
              topicInput: currentProject.topicInput,
              outline,
              timingCalibration,
              guidance: parsedRequest.data.guidance,
              currentPlan,
            }),
        );
        const generatedContent = normalizedVoiceVisualContent(
          generation.result.content,
        );
        const voiceVisualPlan: VoiceVisualPlan = {
          ...generatedContent,
          status: 'draft',
          contentRevision:
            (currentProject.voiceVisualPlan?.contentRevision ?? 0) + 1,
          narrationRevision: nextNarrationRevision(
            currentProject.voiceVisualPlan,
            generatedContent,
          ),
          sourceOutlineContentRevision: outline.contentRevision,
          generation: {
            generationId: parsedRequest.data.generationId,
            provider: 'codex',
            model: generation.result.model,
            promptVersion: VOICE_VISUAL_PROMPT_VERSION,
            generatedAt: generation.generatedAt,
            usage: generation.result.usage,
          },
        };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {voiceVisualPlan, currentStep: 'voiceVisual'},
          expectedRevision,
        );

        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        sendProject(response, 200, updatedProject);
        return;
      }

      if (
        voiceVisualRoute?.action === 'update' &&
        request.method === 'PUT'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedContent = VoiceVisualPlanContentSchema.safeParse(body);

        if (!parsedContent.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Kế hoạch voice–visual chưa hợp lệ.',
            fields: validationFields(parsedContent.error.issues),
          });
          return;
        }

        const currentProject = await repository.getProject(
          voiceVisualRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (!currentProject.voiceVisualPlan) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_NOT_READY',
            'Project chưa có kế hoạch voice–visual để chỉnh sửa.',
          );
        }
        const outline = currentProject.outline;
        if (
          !outline ||
          outline.status !== 'approved' ||
          !sameValue(outline.sourceInput, currentProject.topicInput) ||
          currentProject.voiceVisualPlan.sourceOutlineContentRevision !==
            outline.contentRevision
        ) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_OUTDATED',
            'Mạch giảng đã thay đổi. Hãy tạo lại kế hoạch voice–visual.',
          );
        }
        const normalizedContent = normalizedVoiceVisualContent(
          parsedContent.data,
        );
        if (!voiceVisualMatchesOutline(normalizedContent, outline)) {
          throw new RequestBodyError(
            422,
            'VOICE_VISUAL_OUTLINE_MISMATCH',
            'Kế hoạch voice–visual không bao phủ đúng mạch giảng hiện tại.',
          );
        }

        const unchanged = sameValue(
          voiceVisualContent(currentProject.voiceVisualPlan),
          normalizedContent,
        );
        const voiceVisualPlan: VoiceVisualPlan = unchanged
          ? currentProject.voiceVisualPlan
          : {
              ...normalizedContent,
              status: 'draft',
              contentRevision:
                currentProject.voiceVisualPlan.contentRevision + 1,
              narrationRevision: nextNarrationRevision(
                currentProject.voiceVisualPlan,
                normalizedContent,
              ),
              sourceOutlineContentRevision:
                currentProject.voiceVisualPlan
                  .sourceOutlineContentRevision,
              generation: currentProject.voiceVisualPlan.generation,
            };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {voiceVisualPlan, currentStep: 'voiceVisual'},
          expectedRevision,
        );

        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        sendProject(response, 200, updatedProject);
        return;
      }

      if (
        voiceVisualRoute?.action === 'approve' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const currentProject = await repository.getProject(
          voiceVisualRoute.projectId,
        );

        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const outline = currentProject.outline;
        const voiceVisualPlan = currentProject.voiceVisualPlan;
        if (!voiceVisualPlan) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_NOT_READY',
            'Hãy tạo kế hoạch voice–visual trước khi chốt.',
          );
        }
        if (
          !outline ||
          outline.status !== 'approved' ||
          !sameValue(outline.sourceInput, currentProject.topicInput) ||
          voiceVisualPlan.sourceOutlineContentRevision !==
            outline.contentRevision ||
          !voiceVisualMatchesOutline(voiceVisualPlan, outline)
        ) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_OUTDATED',
            'Mạch giảng đã thay đổi. Hãy tạo lại kế hoạch voice–visual trước khi chốt.',
          );
        }

        const approvedPlan: VoiceVisualPlan = {
          ...voiceVisualPlan,
          status: 'approved',
        };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {voiceVisualPlan: approvedPlan, currentStep: 'motionCanvas'},
          expectedRevision,
        );

        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        sendProject(response, 200, updatedProject);
        return;
      }

      const motionCanvasRoute = getProjectMotionCanvasRoute(
        requestUrl.pathname,
      );

      if (
        motionCanvasRoute?.action === 'generate' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = GenerateMotionCanvasSchema.safeParse(body);

        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Yêu cầu sinh scene Motion Canvas chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }
        const generationId =
          parsedRequest.data.generationId.toLowerCase();

        const currentProject = await repository.getProject(
          motionCanvasRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        if (
          currentProject.motionCanvasBundle?.generation.generationId ===
          generationId
        ) {
          sendProject(response, 200, currentProject);
          return;
        }

        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }

        const outline = currentProject.outline;
        const voiceVisualPlan = currentProject.voiceVisualPlan;
        if (
          !outline ||
          outline.status !== 'approved' ||
          !sameValue(outline.sourceInput, currentProject.topicInput) ||
          !voiceVisualPlan ||
          voiceVisualPlan.status !== 'approved' ||
          voiceVisualPlan.sourceOutlineContentRevision !==
            outline.contentRevision ||
          !voiceVisualMatchesOutline(voiceVisualPlan, outline)
        ) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_NOT_APPROVED',
            'Hãy chốt kế hoạch voice–visual hiện tại trước khi sinh scene.',
          );
        }

        const currentBundleUsable = Boolean(
          currentProject.motionCanvasBundle &&
            currentProject.motionCanvasBundle
              .sourceVoiceVisualContentRevision ===
              voiceVisualPlan.contentRevision &&
            motionCanvasMatchesOutline(
              currentProject.motionCanvasBundle,
              outline,
            ),
        );
        if (
          parsedRequest.data.guidance &&
          currentProject.motionCanvasBundle &&
          !currentBundleUsable
        ) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_OUTDATED',
            'Kế hoạch voice–visual đã thay đổi. Hãy sinh lại toàn bộ scene trước khi góp ý.',
          );
        }

        const currentScenes =
          parsedRequest.data.guidance &&
          currentBundleUsable &&
          currentProject.motionCanvasBundle
            ? await motionCanvasWorkspace.readSceneSources(
                currentProject.id,
                currentProject.motionCanvasBundle,
              )
            : undefined;
        const generationKey = `${currentProject.id}:${generationId}`;
        const fingerprint = JSON.stringify({
          topicInput: currentProject.topicInput,
          outline: outlineContent(outline),
          outlineContentRevision: outline.contentRevision,
          voiceVisual: voiceVisualContent(voiceVisualPlan),
          voiceVisualContentRevision: voiceVisualPlan.contentRevision,
          guidance: parsedRequest.data.guidance,
          currentScenes,
        });
        const generation = await generateOnce(
          motionCanvasGenerations,
          generationKey,
          fingerprint,
          async () => {
            const generationRequest = {
              generationId,
              topicInput: currentProject.topicInput,
              outline,
              voiceVisualPlan,
              guidance: parsedRequest.data.guidance,
              currentScenes,
            };
            let generated =
              await motionCanvasGenerator.generate(generationRequest);
            let prepared: PreparedMotionCanvasWorkspace | null = null;
            let repairAttempts = 0;
            while (!prepared) {
              try {
                prepared = await motionCanvasWorkspace.prepare(
                  currentProject.id,
                  generationId,
                  generated.scenes,
                );
              } catch (error) {
                if (
                  error instanceof MotionCanvasWorkspaceError &&
                  error.code === 'MOTION_CANVAS_VALIDATION_FAILED' &&
                  error.details &&
                  motionCanvasGenerator.repair &&
                  repairAttempts < 2
                ) {
                  repairAttempts += 1;
                  generated = await motionCanvasGenerator.repair(
                    generationRequest,
                    generated,
                    error.details,
                  );
                  continue;
                }
                throw error;
              }
            }
            return {generated, prepared};
          },
        );
        const preparedWorkspace = generation.result.prepared;
        const motionCanvasBundle: MotionCanvasBundle = {
          status: 'draft',
          contentRevision:
            (currentProject.motionCanvasBundle?.contentRevision ?? 0) + 1,
          sourceVoiceVisualContentRevision:
            voiceVisualPlan.contentRevision,
          workspacePath: preparedWorkspace.workspacePath,
          projectFile: preparedWorkspace.projectFile,
          width: MOTION_CANVAS_WIDTH,
          height: MOTION_CANVAS_HEIGHT,
          fps: MOTION_CANVAS_FPS,
          ...(preparedWorkspace.scenes.every(
            (scene) => scene.timingEvents?.length,
          )
            ? {timingContractVersion: 1 as const}
            : {}),
          scenes: preparedWorkspace.scenes,
          validation: preparedWorkspace.validation,
          generation: {
            generationId,
            provider: 'codex',
            model: generation.result.generated.model,
            promptVersion: MOTION_CANVAS_PROMPT_VERSION,
            generatedAt: generation.generatedAt,
            usage: generation.result.generated.usage,
          },
        };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {motionCanvasBundle, currentStep: 'motionCanvas'},
          expectedRevision,
        );

        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        motionCanvasGenerator.discardGeneration?.(generationId);
        sendProject(response, 200, updatedProject);
        return;
      }

      if (
        motionCanvasRoute?.action === 'files' &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(
          motionCanvasRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (!currentProject.motionCanvasBundle) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_NOT_READY',
            'Project chưa có scene Motion Canvas.',
          );
        }

        const files = await motionCanvasWorkspace.readFiles(
          currentProject.id,
          currentProject.motionCanvasBundle,
        );
        sendJson(response, 200, {
          bundle: currentProject.motionCanvasBundle,
          files,
          serveCommand: `npm run motion:serve -- --project ${currentProject.id}`,
        });
        return;
      }

      if (
        motionCanvasRoute?.action === 'approve' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const currentProject = await repository.getProject(
          motionCanvasRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }

        const outline = currentProject.outline;
        const voiceVisualPlan = currentProject.voiceVisualPlan;
        const motionCanvasBundle = currentProject.motionCanvasBundle;
        if (!motionCanvasBundle) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_NOT_READY',
            'Hãy sinh scene Motion Canvas trước khi chốt.',
          );
        }
        if (
          !outline ||
          outline.status !== 'approved' ||
          !voiceVisualPlan ||
          voiceVisualPlan.status !== 'approved' ||
          !sameValue(outline.sourceInput, currentProject.topicInput) ||
          voiceVisualPlan.sourceOutlineContentRevision !==
            outline.contentRevision ||
          motionCanvasBundle.sourceVoiceVisualContentRevision !==
            voiceVisualPlan.contentRevision ||
          !motionCanvasMatchesOutline(motionCanvasBundle, outline)
        ) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_OUTDATED',
            'Kế hoạch voice–visual đã thay đổi. Hãy sinh lại scene trước khi chốt.',
          );
        }

        const approvedBundle: MotionCanvasBundle = {
          ...motionCanvasBundle,
          status: 'approved',
        };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {
            motionCanvasBundle: approvedBundle,
            currentStep: 'voice',
          },
          expectedRevision,
        );

        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        sendProject(response, 200, updatedProject);
        return;
      }

      const voiceRoute = getProjectVoiceRoute(requestUrl.pathname);

      if (
        voiceRoute?.action === 'generate' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = GenerateVoiceSchema.safeParse(body);
        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Cấu hình tạo voice chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }
        const generationId = parsedRequest.data.generationId.toLowerCase();
        const currentProject = await repository.getProject(
          voiceRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (
          currentProject.voiceBundle?.generation.generationId === generationId
        ) {
          sendProject(response, 200, currentProject);
          return;
        }
        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }

        const outline = currentProject.outline;
        const plan = currentProject.voiceVisualPlan;
        const motionBundle = currentProject.motionCanvasBundle;
        if (
          !outline ||
          outline.status !== 'approved' ||
          !plan ||
          plan.status !== 'approved' ||
          !motionBundle ||
          motionBundle.status !== 'approved' ||
          !sameValue(outline.sourceInput, currentProject.topicInput) ||
          plan.sourceOutlineContentRevision !== outline.contentRevision ||
          motionBundle.sourceVoiceVisualContentRevision !==
            plan.contentRevision ||
          !voiceVisualMatchesOutline(plan, outline) ||
          !motionCanvasMatchesOutline(motionBundle, outline)
        ) {
          throw new RequestBodyError(
            409,
            'VOICE_PREREQUISITES_NOT_APPROVED',
            'Hãy chốt voice–visual và Motion Canvas hiện tại trước khi tạo voice.',
          );
        }

        const narrationSource = buildNarrationSource(plan);
        const generationKey = `${currentProject.id}:${generationId}`;
        const fingerprint = JSON.stringify({
          narrationRevision: plan.narrationRevision,
          narrationSource,
          configuration: parsedRequest.data,
        });
        const generation = await generateOnce(
          voiceGenerations,
          generationKey,
          fingerprint,
          async () => {
            const resolved =
              await elevenLabsVoiceService.resolveConfiguration({
                voiceId: parsedRequest.data.voiceId,
                modelId: parsedRequest.data.modelId,
                outputFormat: parsedRequest.data.outputFormat,
                settings: parsedRequest.data.settings,
                seed: parsedRequest.data.seed,
              });
            const maximumCharacters =
              resolved.model.maximumTextLengthPerRequest;
            let sourceChunks;
            try {
              sourceChunks = splitNarrationSource(
                narrationSource,
                maximumCharacters,
              );
            } catch (error) {
              throw new RequestBodyError(
                422,
                'VOICE_BEAT_TOO_LONG',
                error instanceof Error
                  ? error.message
                  : 'Một beat narration vượt giới hạn của model đã chọn.',
              );
            }

            const generatedChunks = [];
            const previousRequestIds: string[] = [];
            for (const [index, chunk] of sourceChunks.entries()) {
              const chunkRequest = {
                  voiceId: resolved.configuration.voiceId,
                  modelId: resolved.configuration.modelId,
                  outputFormat: resolved.configuration.outputFormat,
                  text: chunk.text,
                  settings: resolved.configuration.settings,
                  seed: resolved.configuration.seed,
                  canUseStyle: resolved.model.canUseStyle,
                  canUseSpeakerBoost:
                    resolved.model.canUseSpeakerBoost,
                  ...(resolved.configuration.modelId === 'eleven_v3'
                    ? {}
                    : {
                        previousText:
                          Array.from(narrationSource.text)
                            .slice(
                              Math.max(0, chunk.textStartIndex - 1_000),
                              chunk.textStartIndex,
                            )
                            .join(''),
                        nextText:
                          Array.from(narrationSource.text)
                            .slice(
                              chunk.textEndIndex,
                              chunk.textEndIndex + 1_000,
                            )
                            .join(''),
                        previousRequestIds: [...previousRequestIds],
                      }),
                };
              const chunkGeneration = await generateOnce(
                voiceSectionGenerations,
                `${generationKey}:chunk:${index + 1}`,
                JSON.stringify(chunkRequest),
                () =>
                  elevenLabsVoiceService.generateSection(chunkRequest),
              );
              if (chunkGeneration.result.requestId) {
                previousRequestIds.push(chunkGeneration.result.requestId);
              }
              generatedChunks.push({
                ...chunk,
                outputFormat: resolved.configuration.outputFormat,
                generated: chunkGeneration.result,
              });
            }
            const prepared = await voiceWorkspace.prepare(
              currentProject.id,
              generationId,
              {
                ...narrationSource,
                chunks: generatedChunks,
              },
            );
            return {
              configuration: resolved.configuration,
              prepared,
            };
          },
        );

        const voiceBundle: VoiceBundle = {
          status: 'draft',
          contentRevision:
            (currentProject.voiceBundle?.contentRevision ?? 0) + 1,
          sourceNarrationRevision: plan.narrationRevision,
          workspacePath: generation.result.prepared.workspacePath,
          configuration: generation.result.configuration,
          track: generation.result.prepared.track,
          sections: generation.result.prepared.sections,
          totalDurationSeconds:
            generation.result.prepared.totalDurationSeconds,
          generation: {
            generationId,
            provider: 'elevenlabs',
            generatedAt: generation.generatedAt,
            characterCost: generation.result.prepared.characterCost,
            requestIds: generation.result.prepared.requestIds,
          },
        };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {voiceBundle, currentStep: 'voice'},
          expectedRevision,
        );
        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        sendProject(response, 200, updatedProject);
        return;
      }

      if (voiceRoute?.action === 'audio' && request.method === 'GET') {
        const currentProject = await repository.getProject(
          voiceRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (
          !currentProject.voiceBundle ||
          !voiceRoute.outlineSectionId
        ) {
          throw new RequestBodyError(
            404,
            'VOICE_AUDIO_NOT_FOUND',
            'Project chưa có audio voice này.',
          );
        }
        const requestedGeneration =
          requestUrl.searchParams.get('generation');
        if (
          requestedGeneration &&
          requestedGeneration !==
            currentProject.voiceBundle.generation.generationId
        ) {
          throw new RequestBodyError(
            404,
            'VOICE_GENERATION_NOT_FOUND',
            'Generation voice được yêu cầu không còn là bản hiện tại.',
          );
        }
        const result = await voiceWorkspace.readAudio(
          currentProject.id,
          currentProject.voiceBundle,
          voiceRoute.outlineSectionId,
        );
        sendMediaBuffer(
          request,
          response,
          result.audio,
          result.contentType,
          {
            'Cache-Control': 'private, max-age=31536000, immutable',
            ETag: `"${currentProject.voiceBundle.generation.generationId}:${voiceRoute.outlineSectionId}"`,
          },
        );
        return;
      }

      if (
        voiceRoute?.action === 'approve' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const currentProject = await repository.getProject(
          voiceRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }
        const plan = currentProject.voiceVisualPlan;
        const bundle = currentProject.voiceBundle;
        if (
          !plan ||
          plan.status !== 'approved' ||
          !bundle ||
          !voiceMatchesPlan(bundle, plan)
        ) {
          throw new RequestBodyError(
            409,
            'VOICE_OUTDATED',
            'Voice chưa có hoặc không còn khớp với lời đọc đã chốt.',
          );
        }
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {
            voiceBundle: {...bundle, status: 'approved'},
            currentStep: 'sync',
          },
          expectedRevision,
        );
        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        sendProject(response, 200, updatedProject);
        return;
      }

      const animationSyncRoute = getProjectAnimationSyncRoute(
        requestUrl.pathname,
      );

      if (
        animationSyncRoute?.action === 'generate' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = GenerateAnimationSyncSchema.safeParse(body);
        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Yêu cầu đồng bộ animation chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }
        const generationId = parsedRequest.data.generationId.toLowerCase();
        const currentProject = await repository.getProject(
          animationSyncRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (
          currentProject.animationSyncBundle?.generation.generationId ===
          generationId
        ) {
          sendProject(response, 200, currentProject);
          return;
        }
        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }

        const outline = currentProject.outline;
        const plan = currentProject.voiceVisualPlan;
        const motion = currentProject.motionCanvasBundle;
        const voice = currentProject.voiceBundle;
        if (
          !outline ||
          outline.status !== 'approved' ||
          !plan ||
          plan.status !== 'approved' ||
          !motion ||
          motion.status !== 'approved' ||
          !voice ||
          voice.status !== 'approved' ||
          !sameValue(outline.sourceInput, currentProject.topicInput) ||
          plan.sourceOutlineContentRevision !== outline.contentRevision ||
          motion.sourceVoiceVisualContentRevision !==
            plan.contentRevision ||
          !voiceVisualMatchesOutline(plan, outline) ||
          !motionCanvasMatchesOutline(motion, outline) ||
          !voiceMatchesPlan(voice, plan)
        ) {
          throw new RequestBodyError(
            409,
            'ANIMATION_SYNC_PREREQUISITES_NOT_APPROVED',
            'Hãy chốt Motion Canvas và voice hiện tại trước khi đồng bộ.',
          );
        }
        if (motion.timingContractVersion !== 1) {
          throw new RequestBodyError(
            409,
            'ANIMATION_SYNC_TIMING_CONTRACT_REQUIRED',
            'Scene hiện tại là bản legacy. Hãy sinh lại và chốt Motion Canvas trước khi đồng bộ.',
          );
        }

        const generationKey = `${currentProject.id}:${generationId}`;
        const fingerprint = JSON.stringify({
          motionContentRevision: motion.contentRevision,
          motionSourceHash: motion.validation.sourceHash,
          voiceContentRevision: voice.contentRevision,
          voiceGenerationId: voice.generation.generationId,
          voiceSections: voice.sections,
        });
        const generation = await generateOnce(
          animationSyncGenerations,
          generationKey,
          fingerprint,
          () =>
            animationSyncWorkspace.prepare(
              currentProject.id,
              generationId,
              motion,
              voice,
            ),
        );
        const prepared = generation.result;
        const animationSyncBundle: AnimationSyncBundle = {
          status: 'draft',
          contentRevision:
            (currentProject.animationSyncBundle?.contentRevision ?? 0) + 1,
          sourceMotionCanvasContentRevision: motion.contentRevision,
          sourceVoiceContentRevision: voice.contentRevision,
          workspacePath: prepared.workspacePath,
          projectFile: prepared.projectFile,
          audioFile: prepared.audioFile,
          totalDurationSeconds: prepared.totalDurationSeconds,
          sections: prepared.sections,
          validation: prepared.validation,
          generation: {
            generationId,
            provider: 'local',
            tool: 'ffmpeg',
            generatedAt: generation.generatedAt,
          },
        };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {animationSyncBundle, currentStep: 'sync'},
          expectedRevision,
        );
        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        sendProject(response, 200, updatedProject);
        return;
      }

      if (
        animationSyncRoute?.action === 'preview' &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(
          animationSyncRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const bundle = currentProject.animationSyncBundle;
        if (!bundle) {
          throw new RequestBodyError(
            409,
            'ANIMATION_SYNC_NOT_READY',
            'Hãy đồng bộ animation trước khi mở bản nháp.',
          );
        }
        const requestedGeneration =
          requestUrl.searchParams.get('generation');
        if (
          requestedGeneration &&
          requestedGeneration !== bundle.generation.generationId
        ) {
          throw new RequestBodyError(
            404,
            'ANIMATION_SYNC_GENERATION_NOT_FOUND',
            'Generation bản nháp được yêu cầu không còn là bản hiện tại.',
          );
        }
        const preview = await animationSyncPreviewService.start(
          currentProject.id,
          bundle,
        );
        response.setHeader('Cache-Control', 'no-store');
        sendJson(response, 200, {preview});
        return;
      }

      if (
        animationSyncRoute?.action === 'files' &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(
          animationSyncRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (!currentProject.animationSyncBundle) {
          throw new RequestBodyError(
            409,
            'ANIMATION_SYNC_NOT_READY',
            'Project chưa có workspace đồng bộ.',
          );
        }
        const files = await animationSyncWorkspace.readFiles(
          currentProject.id,
          currentProject.animationSyncBundle,
        );
        sendJson(response, 200, {
          bundle: currentProject.animationSyncBundle,
          files,
          serveCommand: `npm run sync:serve -- --project ${currentProject.id}`,
        });
        return;
      }

      if (
        animationSyncRoute?.action === 'audio' &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(
          animationSyncRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const bundle = currentProject.animationSyncBundle;
        if (!bundle) {
          throw new RequestBodyError(
            404,
            'ANIMATION_SYNC_AUDIO_NOT_FOUND',
            'Project chưa có narration đã đồng bộ.',
          );
        }
        const requestedGeneration =
          requestUrl.searchParams.get('generation');
        if (
          requestedGeneration &&
          requestedGeneration !== bundle.generation.generationId
        ) {
          throw new RequestBodyError(
            404,
            'ANIMATION_SYNC_GENERATION_NOT_FOUND',
            'Generation đồng bộ được yêu cầu không còn là bản hiện tại.',
          );
        }
        const audio = await animationSyncWorkspace.readAudio(
          currentProject.id,
          bundle,
        );
        sendMediaBuffer(request, response, audio, 'audio/wav', {
          'Cache-Control': 'private, max-age=31536000, immutable',
          ETag: `"${bundle.generation.generationId}"`,
        });
        return;
      }

      if (
        animationSyncRoute?.action === 'approve' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const currentProject = await repository.getProject(
          animationSyncRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }
        const motion = currentProject.motionCanvasBundle;
        const voice = currentProject.voiceBundle;
        const bundle = currentProject.animationSyncBundle;
        if (
          !motion ||
          motion.status !== 'approved' ||
          !voice ||
          voice.status !== 'approved' ||
          !bundle ||
          !animationSyncMatchesSources(bundle, motion, voice)
        ) {
          throw new RequestBodyError(
            409,
            'ANIMATION_SYNC_OUTDATED',
            'Bản đồng bộ chưa có hoặc không còn khớp với scene và voice hiện tại.',
          );
        }
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {
            animationSyncBundle: {...bundle, status: 'approved'},
            currentStep: 'layout',
          },
          expectedRevision,
        );
        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        sendProject(response, 200, updatedProject);
        return;
      }

      const layoutRoute = getProjectLayoutRoute(requestUrl.pathname);

      if (
        layoutRoute?.action === 'read' &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(
          layoutRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const sync = currentProject.animationSyncBundle;
        if (!sync || !layoutPrerequisitesAreReady(currentProject)) {
          throw new RequestBodyError(
            409,
            'LAYOUT_PREREQUISITES_NOT_APPROVED',
            'Hãy chốt bản đồng bộ hiện hành trước khi mở Layout Editor.',
          );
        }

        const bundle = currentProject.layoutBundle;
        const bundleIsCurrent = Boolean(
          bundle && layoutMatchesAnimationSync(bundle, sync),
        );
        const overrides =
          bundle && bundleIsCurrent
            ? await layoutWorkspace.readOverrides(
                currentProject.id,
                bundle,
              )
            : {
                version: 1 as const,
                sourceAnimationSyncGenerationId:
                  sync.generation.generationId,
                sourceAnimationSyncContentRevision:
                  sync.contentRevision,
                sourceAnimationSyncSourceHash:
                  sync.validation.sourceHash,
                overrides: [],
              };
        const manifest =
          bundle && bundleIsCurrent
            ? await layoutWorkspace.readEditorManifest(
                currentProject.id,
                bundle,
              )
            : null;
        sendJson(response, 200, {bundle, overrides, manifest});
        return;
      }

      if (
        layoutRoute?.action === 'preview' &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(
          layoutRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const sync = currentProject.animationSyncBundle;
        if (!sync || !layoutPrerequisitesAreReady(currentProject)) {
          throw new RequestBodyError(
            409,
            'LAYOUT_PREREQUISITES_NOT_APPROVED',
            'Hãy chốt bản đồng bộ hiện hành trước khi mở Layout Editor.',
          );
        }
        const requestedGeneration =
          requestUrl.searchParams.get('generation');
        if (!requestedGeneration) {
          throw new RequestBodyError(
            400,
            'LAYOUT_SOURCE_GENERATION_REQUIRED',
            'Cần chỉ rõ generation đồng bộ nguồn của Layout Editor.',
          );
        }
        if (requestedGeneration !== sync.generation.generationId) {
          throw new RequestBodyError(
            404,
            'LAYOUT_SOURCE_GENERATION_NOT_FOUND',
            'Generation đồng bộ được yêu cầu không còn là bản hiện hành.',
          );
        }
        const currentLayout =
          currentProject.layoutBundle &&
          layoutMatchesAnimationSync(
            currentProject.layoutBundle,
            sync,
          )
            ? currentProject.layoutBundle
            : null;
        const preview = await layoutPreviewService.start(
          currentProject.id,
          sync,
          currentLayout,
          {parentOrigin: requestParentOrigin(request)},
        );
        sendJson(response, 200, {preview});
        return;
      }

      if (
        layoutRoute?.action === 'commit' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = CommitLayoutSchema.safeParse(body);
        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Danh sách chỉnh sửa Layout chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }
        const requestData = parsedRequest.data;
        const generationId = requestData.generationId.toLowerCase();
        const currentProject = await repository.getProject(
          layoutRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const normalizedOverrides = [...requestData.overrides].sort(
          (left, right) =>
            left.sceneId.localeCompare(right.sceneId) ||
            left.nodeKey.localeCompare(right.nodeKey),
        );
        const currentLayout = currentProject.layoutBundle;
        if (
          currentLayout?.generation.generationId === generationId
        ) {
          const stored = await layoutWorkspace.readOverrides(
            currentProject.id,
            currentLayout,
          );
          if (
            currentLayout.sourceAnimationSyncGenerationId !==
              requestData.sourceAnimationSyncGenerationId ||
            !sameValue(stored.overrides, normalizedOverrides)
          ) {
            throw new RequestBodyError(
              409,
              'GENERATION_ID_REUSED',
              'Generation ID đã được dùng với một Layout khác.',
            );
          }
          sendProject(response, 200, currentProject);
          return;
        }
        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }
        const sync = currentProject.animationSyncBundle;
        if (!sync || !layoutPrerequisitesAreReady(currentProject)) {
          throw new RequestBodyError(
            409,
            'LAYOUT_PREREQUISITES_NOT_APPROVED',
            'Hãy chốt bản đồng bộ hiện hành trước khi lưu Layout.',
          );
        }
        if (
          requestData.sourceAnimationSyncGenerationId !==
          sync.generation.generationId
        ) {
          throw new RequestBodyError(
            409,
            'LAYOUT_SOURCE_OUTDATED',
            'Bản đồng bộ nguồn đã thay đổi. Hãy tải lại Layout Editor.',
          );
        }
        if (
          requestData.baseGenerationId !==
          (currentLayout?.generation.generationId ?? null)
        ) {
          throw new RequestBodyError(
            409,
            'LAYOUT_BASE_GENERATION_CONFLICT',
            'Layout nền đã thay đổi. Hãy tải lại trước khi lưu.',
          );
        }

        const editorManifest = layoutPreviewService.getManifest(
          currentProject.id,
          requestData.sessionNonce,
          sync.generation.generationId,
        );
        const sourceWorkspaceHash =
          layoutPreviewService.getSourceWorkspaceHash(
            currentProject.id,
            requestData.sessionNonce,
            sync.generation.generationId,
          );
        const generationKey = `${currentProject.id}:${generationId}`;
        const fingerprint = JSON.stringify({
          sourceAnimationSyncGenerationId:
            sync.generation.generationId,
          sourceAnimationSyncContentRevision: sync.contentRevision,
          sourceAnimationSyncSourceHash: sync.validation.sourceHash,
          sourceWorkspaceHash,
          baseGenerationId: requestData.baseGenerationId,
          overrides: normalizedOverrides,
          editorManifest,
        });
        const generation = await generateOnce(
          layoutGenerations,
          generationKey,
          fingerprint,
          () =>
            layoutWorkspace.prepare(
              currentProject.id,
              generationId,
              sync,
              normalizedOverrides,
              editorManifest,
              requestData.baseGenerationId,
              sourceWorkspaceHash,
            ),
        );
        const prepared = generation.result;
        const layoutBundleValue: LayoutBundle = {
          status: 'draft',
          contentRevision:
            (currentLayout?.contentRevision ?? 0) + 1,
          sourceAnimationSyncContentRevision: sync.contentRevision,
          sourceAnimationSyncGenerationId:
            sync.generation.generationId,
          sourceAnimationSyncSourceHash: sync.validation.sourceHash,
          workspacePath: prepared.workspacePath,
          sourceWorkspacePath: prepared.sourceWorkspacePath,
          projectFile: prepared.projectFile,
          audioFile: prepared.audioFile,
          overridesFile: prepared.overridesFile,
          manifestFile: prepared.manifestFile,
          overrideContractVersion:
            prepared.overrideContractVersion,
          totalDurationSeconds: prepared.totalDurationSeconds,
          scenes: prepared.scenes,
          validation: prepared.validation,
          generation: {
            generationId,
            provider: 'local',
            tool: 'layout-editor',
            generatedAt: prepared.validation.validatedAt,
          },
        };
        const parsedLayoutBundle =
          LayoutBundleSchema.safeParse(layoutBundleValue);
        if (!parsedLayoutBundle.success) {
          throw new LayoutWorkspaceError(
            'LAYOUT_WORKSPACE_INTEGRITY_FAILED',
            'Layout workspace đã chuẩn bị không tạo được bundle hợp lệ.',
            {cause: parsedLayoutBundle.error},
          );
        }
        const layoutBundle = parsedLayoutBundle.data;
        await layoutWorkspace.verify(
          currentProject.id,
          sync,
          layoutBundle,
        );
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {layoutBundle, currentStep: 'layout'},
          expectedRevision,
        );
        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        sendProject(response, 200, updatedProject);
        return;
      }

      if (
        layoutRoute?.action === 'files' &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(
          layoutRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (!currentProject.layoutBundle) {
          throw new RequestBodyError(
            409,
            'LAYOUT_NOT_READY',
            'Project chưa có Layout workspace.',
          );
        }
        const files = await layoutWorkspace.readFiles(
          currentProject.id,
          currentProject.layoutBundle,
        );
        sendJson(response, 200, {
          bundle: currentProject.layoutBundle,
          files,
        });
        return;
      }

      if (
        layoutRoute?.action === 'approve' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = ApproveLayoutSchema.safeParse(body);
        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Yêu cầu chốt Layout chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }
        const currentProject = await repository.getProject(
          layoutRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const requestedGenerationId =
          parsedRequest.data.generationId.toLowerCase();
        const sync = currentProject.animationSyncBundle;
        const bundle = currentProject.layoutBundle;
        const alreadyApproved =
          currentProject.revision > expectedRevision &&
          currentProject.currentStep === 'layout' &&
          bundle?.status === 'approved' &&
          bundle.generation.generationId === requestedGenerationId;
        if (
          currentProject.revision !== expectedRevision &&
          !alreadyApproved
        ) {
          throw new ProjectConflictError(currentProject);
        }
        if (
          !sync ||
          !bundle ||
          !layoutPrerequisitesAreReady(currentProject) ||
          !layoutMatchesAnimationSync(bundle, sync)
        ) {
          throw new RequestBodyError(
            409,
            'LAYOUT_OUTDATED',
            'Layout chưa có hoặc không còn khớp bản đồng bộ hiện hành.',
          );
        }
        if (
          requestedGenerationId !==
          bundle.generation.generationId
        ) {
          throw new RequestBodyError(
            409,
            'LAYOUT_GENERATION_OUTDATED',
            'Layout generation cần chốt không còn là bản hiện hành.',
          );
        }
        await layoutWorkspace.verify(
          currentProject.id,
          sync,
          bundle,
        );
        if (alreadyApproved) {
          sendProject(response, 200, currentProject);
          return;
        }
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {
            layoutBundle: {...bundle, status: 'approved'},
            currentStep: 'layout',
          },
          expectedRevision,
        );
        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        sendProject(response, 200, updatedProject);
        return;
      }

      const renderRoute = getProjectRenderRoute(requestUrl.pathname);

      if (
        renderRoute?.action === 'generate' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = GenerateFinalRenderSchema.safeParse(body);
        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Yêu cầu render video cuối chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }
        const currentProject = await repository.getProject(
          renderRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const generationId = parsedRequest.data.generationId;
        const existingRender = currentProject.renderBundle;
        if (
          existingRender?.generation.generationId === generationId &&
          finalRenderIsReady(currentProject)
        ) {
          sendProject(response, 200, currentProject);
          return;
        }
        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }
        const sync = currentProject.animationSyncBundle;
        const layout = currentProject.layoutBundle;
        if (
          !sync ||
          !layout ||
          !finalRenderPrerequisitesAreReady(currentProject)
        ) {
          throw new RequestBodyError(
            409,
            'FINAL_RENDER_PREREQUISITES_NOT_APPROVED',
            'Hãy duyệt Layout hiện hành trước khi render video cuối.',
          );
        }
        const renderBundle: FinalRenderBundle =
          await finalRenderService.render(
            currentProject.id,
            generationId,
            (existingRender?.contentRevision ?? 0) + 1,
            sync,
            layout,
          );
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {renderBundle, currentStep: 'render'},
          expectedRevision,
        );
        if (!updatedProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        sendProject(response, 200, updatedProject);
        return;
      }

      if (
        renderRoute?.action === 'status' &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(
          renderRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const generationId =
          requestUrl.searchParams.get('generationId') ?? undefined;
        const status = finalRenderService.getStatus(
          currentProject.id,
          generationId,
        );
        sendJson(response, 200, {status});
        return;
      }

      if (
        renderRoute?.action === 'video' &&
        (request.method === 'GET' || request.method === 'HEAD')
      ) {
        const currentProject = await repository.getProject(
          renderRoute.projectId,
        );
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        if (!currentProject.renderBundle || !finalRenderIsReady(currentProject)) {
          throw new RequestBodyError(
            409,
            'FINAL_RENDER_NOT_READY',
            'Video cuối chưa sẵn sàng hoặc đã cũ so với Layout hiện hành.',
          );
        }
        const video = await finalRenderService.resolveVideo(
          currentProject.id,
          currentProject.renderBundle,
        );
        sendMediaFile(
          request,
          response,
          video.filePath,
          video.size,
          'video/mp4',
          {
            'Cache-Control': 'private, no-cache',
            'Content-Disposition': `inline; filename="${currentProject.id}.mp4"`,
            ETag: `"${currentProject.renderBundle.validation.videoHash}"`,
          },
        );
        return;
      }

      const projectId = getProjectId(requestUrl.pathname);

      if (projectId && request.method === 'GET') {
        const project = await repository.getProject(projectId);

        if (!project) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        sendProject(response, 200, project);
        return;
      }

      if (projectId && request.method === 'PUT') {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedUpdate = UpdateProjectSchema.safeParse(body);

        if (!parsedUpdate.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Dữ liệu cập nhật chưa hợp lệ.',
            fields: validationFields(parsedUpdate.error.issues),
          });
          return;
        }

        const project = await repository.updateProject(
          projectId,
          parsedUpdate.data,
          expectedRevision,
        );

        if (!project) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        sendProject(response, 200, project);
        return;
      }

      if (projectId && request.method === 'DELETE') {
        const expectedRevision = readExpectedRevision(request);
        await repository.deleteProject(projectId, expectedRevision);

        response.writeHead(204, {'Cache-Control': 'no-store'});
        response.end();
        return;
      }

      if (requestUrl.pathname.startsWith('/api/')) {
        sendApiError(response, 404, {
          code: 'NOT_FOUND',
          message: 'API không tồn tại.',
        });
        return;
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        await serveFrontend(request, response, frontendDirectory);
        return;
      }

      sendApiError(response, 405, {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Phương thức không được hỗ trợ.',
      });
    } catch (error) {
      if (error instanceof RequestBodyError) {
        sendApiError(response, error.statusCode, {
          code: error.code,
          message: error.message,
        });
        return;
      }

      if (error instanceof ProjectConflictError) {
        sendApiError(response, 409, {
          code: 'PROJECT_CONFLICT',
          message:
            'Project vừa được thay đổi ở nơi khác. Hãy kiểm tra dữ liệu mới trước khi thử lại.',
          currentProject: error.currentProject,
        });
        return;
      }

      if (error instanceof ProjectDataError) {
        sendApiError(response, 422, {
          code: error.code,
          message: error.message,
        });
        return;
      }

      if (error instanceof CodexConnectionError) {
        sendApiError(response, 503, {
          code: error.code,
          message: error.message,
        });
        return;
      }

      if (error instanceof OutlineGenerationError) {
        sendApiError(response, 503, {
          code: error.code,
          message: error.message,
        });
        return;
      }

      if (error instanceof VoiceVisualGenerationError) {
        sendApiError(response, 503, {
          code: error.code,
          message: error.message,
        });
        return;
      }

      if (error instanceof MotionCanvasGenerationError) {
        sendApiError(response, 503, {
          code: error.code,
          message: error.message,
        });
        return;
      }

      if (error instanceof MotionCanvasWorkspaceError) {
        sendApiError(
          response,
          error.code === 'MOTION_CANVAS_WORKSPACE_CONFLICT'
            ? 409
            : error.code === 'MOTION_CANVAS_VALIDATION_FAILED'
              ? 422
              : 500,
          {
            code: error.code,
            message: error.message,
          },
        );
        return;
      }

      if (error instanceof ElevenLabsVoiceError) {
        sendApiError(response, error.statusCode, {
          code: error.code,
          message: error.message,
        });
        return;
      }

      if (error instanceof VoiceWorkspaceError) {
        sendApiError(
          response,
          error.code === 'VOICE_WORKSPACE_CONFLICT'
            ? 409
            : error.code === 'VOICE_ALIGNMENT_INVALID'
              ? 422
              : error.code === 'VOICE_AUDIO_NOT_FOUND'
                ? 404
                : 500,
          {
            code: error.code,
            message: error.message,
          },
        );
        return;
      }

      if (error instanceof AnimationSyncWorkspaceError) {
        sendApiError(
          response,
          error.code === 'ANIMATION_SYNC_WORKSPACE_CONFLICT' ||
            error.code === 'ANIMATION_SYNC_TIMING_CONTRACT_REQUIRED' ||
            error.code === 'ANIMATION_SYNC_SOURCE_MISMATCH'
            ? 409
            : error.code === 'ANIMATION_SYNC_VALIDATION_FAILED' ||
                error.code === 'ANIMATION_SYNC_AUDIO_INVALID' ||
                error.code === 'ANIMATION_SYNC_AUDIO_DURATION_MISMATCH'
              ? 422
              : error.code === 'FFMPEG_NOT_AVAILABLE'
                ? 503
                : 500,
          {
            code: error.code,
            message: error.message,
          },
        );
        return;
      }

      if (error instanceof AnimationSyncPreviewError) {
        sendApiError(
          response,
          error.code === 'ANIMATION_SYNC_PREVIEW_INVALID'
            ? 422
            : 503,
          {
            code: error.code,
            message: error.message,
          },
        );
        return;
      }

      if (error instanceof LayoutWorkspaceError) {
        const conflictCodes = new Set([
          'LAYOUT_WORKSPACE_CONFLICT',
          'LAYOUT_SOURCE_NOT_APPROVED',
          'LAYOUT_SOURCE_MANIFEST_MISMATCH',
          'LAYOUT_MANIFEST_SOURCE_MISMATCH',
          'LAYOUT_OVERRIDE_TARGET_MISMATCH',
          'LAYOUT_OVERRIDE_PROPERTY_LOCKED',
        ]);
        const validationCodes = new Set([
          'LAYOUT_WORKSPACE_INVALID',
          'LAYOUT_SOURCE_INVALID',
          'LAYOUT_MANIFEST_INVALID',
          'LAYOUT_OVERRIDES_INVALID',
        ]);
        sendApiError(
          response,
          conflictCodes.has(error.code)
            ? 409
            : validationCodes.has(error.code)
              ? 422
              : 500,
          {
            code: error.code,
            message: error.message,
          },
        );
        return;
      }

      if (error instanceof LayoutPreviewError) {
        const conflictCodes = new Set([
          'LAYOUT_PREVIEW_SOURCE_NOT_APPROVED',
          'LAYOUT_PREVIEW_SOURCE_MISMATCH',
          'LAYOUT_PREVIEW_LAYOUT_STALE',
          'LAYOUT_PREVIEW_SESSION_MISMATCH',
          'LAYOUT_PREVIEW_MANIFEST_UNAVAILABLE',
          'LAYOUT_PREVIEW_MANIFEST_CHANGED',
          'LAYOUT_PREVIEW_MANIFEST_SOURCE_MISMATCH',
        ]);
        const validationCodes = new Set([
          'LAYOUT_PREVIEW_INVALID',
          'LAYOUT_PREVIEW_PARENT_ORIGIN_INVALID',
          'LAYOUT_PREVIEW_MANIFEST_INVALID',
          'LAYOUT_PREVIEW_MANIFEST_TOO_LARGE',
        ]);
        sendApiError(
          response,
          conflictCodes.has(error.code)
            ? 409
            : validationCodes.has(error.code)
              ? 422
              : 503,
          {
            code: error.code,
            message: error.message,
          },
        );
        return;
      }

      if (error instanceof FinalRenderError) {
        const conflictCodes = new Set([
          'FINAL_RENDER_SOURCE_INVALID',
          'FINAL_RENDER_GENERATION_CONFLICT',
          'FINAL_RENDER_FRAME_COUNT_MISMATCH',
          'FINAL_RENDER_DURATION_MISMATCH',
        ]);
        const validationCodes = new Set([
          'FINAL_RENDER_INVALID',
          'FINAL_RENDER_FRAME_TOO_LARGE',
          'FINAL_RENDER_FRAME_SEQUENCE_INVALID',
        ]);
        sendApiError(
          response,
          error.code === 'FINAL_RENDER_VIDEO_MISSING'
            ? 404
            : conflictCodes.has(error.code)
              ? 409
              : validationCodes.has(error.code)
                ? 422
                : 503,
          {code: error.code, message: error.message},
        );
        return;
      }

      logger.error(error);
      sendApiError(response, 500, {
        code: 'INTERNAL_ERROR',
        message: 'Không thể lưu dự án lúc này. Hãy thử lại.',
      });
    }
  });

  let cleanupPromise: Promise<void> | null = null;
  const closeServices = () => {
    if (cleanupPromise) return cleanupPromise;
    const tasks: Array<Promise<unknown>> = [
      Promise.resolve().then(() => codexConnection.close()),
      Promise.resolve().then(() => animationSyncPreviewService.close()),
      Promise.resolve().then(() => layoutPreviewService.close()),
      Promise.resolve().then(() => finalRenderService.close()),
    ];
    if (options.codexConnection && sharedCodexClient) {
      tasks.push(Promise.resolve().then(() => sharedCodexClient.close()));
    }
    cleanupPromise = Promise.allSettled(tasks).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') logger.error(result.reason);
      }
    });
    return cleanupPromise;
  };
  serverCleanupTasks.set(server, closeServices);
  server.on('close', () => void closeServices());
  return server;
}
