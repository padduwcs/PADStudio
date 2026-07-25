import {createReadStream} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {
  ApproveLayoutSchema,
  CommitLayoutSchema,
  CreateTopicProjectSchema,
  GenerateTopicGuidanceSchema,
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
import {
  CreateOutlineCandidateSchema,
  CreateOutlineCheckpointSchema,
  type OutlineCandidateRecord,
} from '../shared/outlineHistory.ts';
import {
  CreateVoiceVisualCandidateSchema,
  CreateVoiceVisualCheckpointSchema,
  CreateVoiceVisualReviewSchema,
  type VoiceVisualCandidateRecord,
  type VoiceVisualReviewRecord,
} from '../shared/voiceVisualHistory.ts';
import {
  CreateMotionCanvasCandidateSchema,
  CreateMotionCanvasCheckpointSchema,
  type MotionCanvasCandidateRecord,
} from '../shared/motionCanvasHistory.ts';
import type {ElevenLabsUsagePreset} from '../shared/elevenLabs.ts';
import {
  CommitVisualDesignSchema,
  LayoutBundleSchema,
} from '../shared/layout.ts';
import {
  finalRenderIsReady,
  finalRenderPrerequisitesAreReady,
  layoutMatchesAnimationSync,
  layoutPrerequisitesAreReady,
  motionCanvasMatchesOutline,
  sameValue,
  visualDesignMatchesMotion,
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
  validateLayoutDocuments,
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
  createCodexTopicGuidanceGenerator,
  TOPIC_GUIDANCE_PROMPT_VERSION,
  TopicGuidanceGenerationError,
  type TopicGuidanceGenerationResult,
  type TopicGuidanceGenerator,
} from './topicGuidanceGenerator.ts';
import {
  createCodexOutlineGenerator,
  OutlineGenerationError,
  OUTLINE_PROMPT_VERSION,
  type OutlineGenerationResult,
  type OutlineGenerator,
} from './outlineGenerator.ts';
import {
  createCodexOutlineRevisionService,
  OUTLINE_REVISION_PROMPT_VERSION,
  OutlineRevisionError,
  type OutlineRevisionResult,
  type OutlineRevisionService,
} from './outlineRevisionService.ts';
import {
  createFileOutlineHistoryStore,
  hashJson,
  hashOutlineContent,
  OutlineHistoryStoreError,
  outlineContent as versionedOutlineContent,
  type OutlineHistoryStore,
} from './outlineHistoryStore.ts';
import {
  createCodexMotionCanvasGenerator,
  MOTION_CANVAS_FPS,
  MOTION_CANVAS_HEIGHT,
  MOTION_CANVAS_PROMPT_VERSION,
  MOTION_CANVAS_WIDTH,
  MotionCanvasGenerationError,
  type MotionCanvasGenerationResult,
  type MotionCanvasGenerator,
  type MotionCanvasSourceScene,
} from './motionCanvasGenerator.ts';
import {
  createFileMotionCanvasHistoryStore,
  hashMotionCanvasBundle,
  MotionCanvasHistoryStoreError,
  type MotionCanvasHistoryStore,
} from './motionCanvasHistoryStore.ts';
import {
  createCodexMotionCanvasRevisionReviewService,
  MOTION_CANVAS_COHERENCE_PROMPT_VERSION,
  MotionCanvasRevisionReviewError,
  type MotionCanvasRevisionReviewResult,
  type MotionCanvasRevisionReviewService,
} from './motionCanvasRevisionReview.ts';
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
  createCodexVoiceVisualRevisionService,
  VOICE_VISUAL_COHERENCE_PROMPT_VERSION,
  VOICE_VISUAL_REVISION_PROMPT_VERSION,
  VoiceVisualRevisionError,
  type VoiceVisualReviewResult,
  type VoiceVisualRevisionResult,
  type VoiceVisualRevisionService,
} from './voiceVisualRevisionService.ts';
import {
  createFileVoiceVisualHistoryStore,
  hashVoiceVisualContent,
  versionedVoiceVisualContent,
  VoiceVisualHistoryStoreError,
  type VoiceVisualHistoryStore,
} from './voiceVisualHistoryStore.ts';
import {
  createVoiceWorkspace,
  type PreparedVoiceWorkspace,
  VoiceWorkspaceError,
  type VoiceWorkspace,
} from './voiceWorkspace.ts';
import {plannedBeatDurationSeconds} from '../shared/narrationTiming.ts';
import {speechTextForBeat} from '../shared/vietnameseSpeech.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {
  createDefaultCredentialStore,
  type CredentialStore,
} from './credentialStore.ts';
import {
  createWatermarkAssetStore,
  WatermarkAssetError,
  type WatermarkAssetStore,
} from './watermarkAssetStore.ts';

// The body limit is a transport safety fuse sized for long-form plans (up to
// 512 beats), not a product preset. Schemas validate structure while this
// aggregate limit prevents an unbounded request from exhausting the process.
const MAX_JSON_BODY_SIZE = pipelineSafetyLimits.maximumJsonBodyBytes;
const MAX_WATERMARK_IMAGE_SIZE = 5 * 1024 * 1024;
const CodexApiKeyLoginSchema = z
  .object({apiKey: z.string().trim().min(1).max(512)})
  .strict();
const ElevenLabsApiKeySchema = z
  .object({apiKey: z.string().trim().min(1).max(512)})
  .strict();

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
  credentialStore?: CredentialStore;
  elevenLabsConnectionFactory?: (
    apiKey: string,
  ) => ElevenLabsConnectionService;
  outlineGenerator?: OutlineGenerator;
  topicGuidanceGenerator?: TopicGuidanceGenerator;
  outlineRevisionService?: OutlineRevisionService;
  outlineHistoryStore?: OutlineHistoryStore;
  voiceVisualGenerator?: VoiceVisualGenerator;
  voiceVisualRevisionService?: VoiceVisualRevisionService;
  voiceVisualHistoryStore?: VoiceVisualHistoryStore;
  motionCanvasGenerator?: MotionCanvasGenerator;
  motionCanvasWorkspace?: MotionCanvasWorkspace;
  motionCanvasHistoryStore?: MotionCanvasHistoryStore;
  motionCanvasRevisionReviewService?: MotionCanvasRevisionReviewService;
  voiceWorkspace?: VoiceWorkspace;
  animationSyncWorkspace?: AnimationSyncWorkspace;
  animationSyncPreviewService?: AnimationSyncPreviewService;
  layoutWorkspace?: LayoutWorkspace;
  layoutPreviewService?: LayoutPreviewService;
  finalRenderService?: FinalRenderService;
  watermarkAssetStore?: WatermarkAssetStore;
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

function assertSameCodexGenerationSelection(
  generation: {
    model: string;
    requestedModel?: string;
    reasoningEffort?: string;
  },
  requested: {model?: string; reasoningEffort?: string},
) {
  if (
    (requested.model &&
      requested.model !== (generation.requestedModel ?? generation.model)) ||
    (requested.reasoningEffort &&
      requested.reasoningEffort !== generation.reasoningEffort)
  ) {
    throw new RequestBodyError(
      409,
      'GENERATION_ID_REUSED',
      'Generation ID đã được dùng với model hoặc mức suy luận khác.',
    );
  }
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

async function readBinaryBody(request: IncomingMessage, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maximumBytes) {
      throw new RequestBodyError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Ảnh watermark vượt quá giới hạn 5 MB.',
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, receivedBytes);
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

function getProjectOutlineHistoryRoute(pathname: string) {
  const match =
    /^\/api\/projects\/([^/]+)\/outline\/(history|versions|candidates)(?:\/([^/]+)(?:\/(restore|apply|reject))?)?$/.exec(
      pathname,
    );
  if (!match?.[1] || !match[2]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId) return null;
  let recordId: string | null = null;
  if (match[3]) {
    try {
      recordId = decodeURIComponent(match[3]);
    } catch {
      return null;
    }
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) return null;
  }
  return {
    projectId,
    resource: match[2] as 'history' | 'versions' | 'candidates',
    recordId,
    action:
      (match[4] as 'restore' | 'apply' | 'reject' | undefined) ?? null,
  };
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

function getProjectVoiceVisualHistoryRoute(pathname: string) {
  const match =
    /^\/api\/projects\/([^/]+)\/voice-visual\/(history|versions|candidates|reviews)(?:\/([^/]+)(?:\/(restore|apply|reject))?)?$/.exec(
      pathname,
    );
  if (!match?.[1] || !match[2]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId) return null;
  let recordId: string | null = null;
  if (match[3]) {
    try {
      recordId = decodeURIComponent(match[3]);
    } catch {
      return null;
    }
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) return null;
  }
  return {
    projectId,
    resource: match[2] as
      | 'history'
      | 'versions'
      | 'candidates'
      | 'reviews',
    recordId,
    action:
      (match[4] as 'restore' | 'apply' | 'reject' | undefined) ?? null,
  };
}

function getProjectMotionCanvasRoute(pathname: string) {
  const match =
    /^\/api\/projects\/([^/]+)\/motion-canvas(?:\/(generate|approve|files|preview|design))?$/.exec(
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

function getProjectMotionCanvasHistoryRoute(pathname: string) {
  const match =
    /^\/api\/projects\/([^/]+)\/motion-canvas\/(history|versions|candidates)(?:\/([^/]+)(?:\/(restore|apply|reject|preview|files))?)?$/.exec(
      pathname,
    );
  if (!match?.[1] || !match[2]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId) return null;
  let recordId: string | null = null;
  if (match[3]) {
    try {
      recordId = decodeURIComponent(match[3]);
    } catch {
      return null;
    }
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) return null;
  }
  return {
    projectId,
    resource: match[2] as 'history' | 'versions' | 'candidates',
    recordId,
    action:
      (match[4] as
        | 'restore'
        | 'apply'
        | 'reject'
        | 'preview'
        | 'files'
        | undefined) ?? null,
  };
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
    /^\/api\/projects\/([^/]+)\/render(?:\/(generate|status|video|watermark))?$/.exec(
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
      | 'watermark'
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

function outlineContextHash(
  topicInput: TopicProject['topicInput'],
  content: ReturnType<typeof outlineContent>,
  sourceInput: TeachingOutline['sourceInput'],
) {
  return hashJson({topicInput, content, sourceInput});
}

function voiceVisualContent(plan: VoiceVisualPlan) {
  return {
    voiceDirection: plan.voiceDirection,
    visualDirection: plan.visualDirection,
    timingCalibration: plan.timingCalibration,
    sections: plan.sections,
  };
}

function voiceVisualContextHash(
  project: Pick<TopicProject, 'topicInput' | 'outline'>,
  content: VoiceVisualPlanContent,
) {
  return hashJson({
    topicInput: project.topicInput,
    outline: project.outline
      ? {
          content: outlineContent(project.outline),
          contentRevision: project.outline.contentRevision,
          sourceInput: project.outline.sourceInput,
        }
      : null,
    content,
  });
}

function motionCanvasContextHash(
  project: Pick<
    TopicProject,
    'topicInput' | 'outline' | 'voiceVisualPlan' | 'visualDesignBundle'
  >,
  bundle: MotionCanvasBundle,
) {
  return hashJson({
    topicInput: project.topicInput,
    outline: project.outline
      ? {
          content: outlineContent(project.outline),
          contentRevision: project.outline.contentRevision,
        }
      : null,
    voiceVisualPlan: project.voiceVisualPlan
      ? {
          content: voiceVisualContent(project.voiceVisualPlan),
          contentRevision: project.voiceVisualPlan.contentRevision,
          narrationRevision: project.voiceVisualPlan.narrationRevision,
        }
      : null,
    visualDesignBundle: project.visualDesignBundle,
    bundle,
  });
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
            speechTextForBeat(beat),
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
  const credentialStore =
    options.credentialStore ??
    createDefaultCredentialStore(path.resolve(projectsDirectory, '..'));
  async function storedElevenLabsApiKey() {
    const stored = await credentialStore.get('elevenlabs');
    return stored ?? process.env.ELEVENLABS_API_KEY?.trim() ?? null;
  }
  const sharedCodexClient: CodexAppServerClient | null =
    !options.codexConnection ||
    !options.topicGuidanceGenerator ||
    !options.outlineGenerator ||
    !options.outlineRevisionService ||
    !options.voiceVisualGenerator ||
    !options.voiceVisualRevisionService ||
    !options.motionCanvasGenerator ||
    !options.motionCanvasRevisionReviewService
      ? new StdioCodexAppServerClient()
      : null;
  const codexConnection =
    options.codexConnection ??
    createCodexConnectionService(sharedCodexClient!);
  const elevenLabsConnection =
    options.elevenLabsConnection ??
    createElevenLabsConnectionService({apiKeyProvider: storedElevenLabsApiKey});
  const elevenLabsVoiceService =
    options.elevenLabsVoiceService ??
    createElevenLabsVoiceService({apiKeyProvider: storedElevenLabsApiKey});
  const elevenLabsConnectionFactory =
    options.elevenLabsConnectionFactory ??
    ((apiKey: string) => createElevenLabsConnectionService({apiKey}));
  const outlineGenerator =
    options.outlineGenerator ??
    createCodexOutlineGenerator(sharedCodexClient!);
  const topicGuidanceGenerator =
    options.topicGuidanceGenerator ??
    createCodexTopicGuidanceGenerator(sharedCodexClient!);
  const outlineRevisionService =
    options.outlineRevisionService ??
    createCodexOutlineRevisionService(sharedCodexClient!);
  const outlineHistoryStore =
    options.outlineHistoryStore ??
    createFileOutlineHistoryStore(projectsDirectory);
  const voiceVisualGenerator =
    options.voiceVisualGenerator ??
    createCodexVoiceVisualGenerator(sharedCodexClient!);
  const voiceVisualRevisionService =
    options.voiceVisualRevisionService ??
    createCodexVoiceVisualRevisionService(sharedCodexClient!);
  const voiceVisualHistoryStore =
    options.voiceVisualHistoryStore ??
    createFileVoiceVisualHistoryStore(projectsDirectory);
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
  const motionCanvasHistoryStore =
    options.motionCanvasHistoryStore ??
    createFileMotionCanvasHistoryStore(projectsDirectory);
  const motionCanvasRevisionReviewService =
    options.motionCanvasRevisionReviewService ??
    createCodexMotionCanvasRevisionReviewService(sharedCodexClient!);
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
  const watermarkAssetStore =
    options.watermarkAssetStore ??
    createWatermarkAssetStore(projectsDirectory);
  const finalRenderService =
    options.finalRenderService ??
    createFinalRenderService(projectsDirectory, {
      layoutWorkspace,
      watermarkAssetStore,
      logger: options.logger,
    });
  const logger = options.logger ?? console;
  type GenerationCacheEntry<Result> = {
    fingerprint: string;
    promise: Promise<{result: Result; generatedAt: string}>;
    settled: boolean;
  };
  const outlineGenerations = new Map<
    string,
    GenerationCacheEntry<OutlineGenerationResult>
  >();
  const topicGuidanceGenerations = new Map<
    string,
    GenerationCacheEntry<TopicGuidanceGenerationResult>
  >();
  const outlineCandidateGenerations = new Map<
    string,
    GenerationCacheEntry<OutlineRevisionResult>
  >();
  const voiceVisualGenerations = new Map<
    string,
    GenerationCacheEntry<VoiceVisualGenerationResult>
  >();
  const voiceVisualCandidateGenerations = new Map<
    string,
    GenerationCacheEntry<VoiceVisualRevisionResult>
  >();
  const voiceVisualReviewGenerations = new Map<
    string,
    GenerationCacheEntry<VoiceVisualReviewResult>
  >();
  const motionCanvasGenerations = new Map<
    string,
    GenerationCacheEntry<{
      generated: MotionCanvasGenerationResult;
      prepared: PreparedMotionCanvasWorkspace;
    }>
  >();
  const motionCanvasCandidateGenerations = new Map<
    string,
    GenerationCacheEntry<{
      generated: MotionCanvasGenerationResult;
      prepared: PreparedMotionCanvasWorkspace;
      review: MotionCanvasRevisionReviewResult;
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
  const finalRenderCommits = new Set<Promise<void>>();

  async function commitFinalRenderBundle(
    projectId: string,
    generationId: string,
    renderBundle: FinalRenderBundle,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latestProject = await repository.getProject(projectId);
      if (!latestProject) return false;
      if (
        latestProject.renderBundle?.generation.generationId === generationId
      ) {
        return true;
      }
      const latestLayout = latestProject.layoutBundle;
      if (
        !latestLayout ||
        !finalRenderPrerequisitesAreReady(latestProject) ||
        latestLayout.contentRevision !==
          renderBundle.sourceLayoutContentRevision ||
        latestLayout.generation.generationId !==
          renderBundle.sourceLayoutGenerationId ||
        latestLayout.validation.sourceHash !==
          renderBundle.sourceLayoutSourceHash
      ) {
        return false;
      }
      try {
        await repository.updateProject(
          latestProject.id,
          {renderBundle, currentStep: 'render'},
          latestProject.revision,
        );
        return true;
      } catch (error) {
        if (error instanceof ProjectConflictError && attempt < 2) continue;
        throw error;
      }
    }
    return false;
  }

  function trackFinalRenderCommit(operation: Promise<void>) {
    finalRenderCommits.add(operation);
    void operation
      .finally(() => finalRenderCommits.delete(operation))
      .catch(() => undefined);
  }

  function generateOnce<Result>(
    generations: Map<string, GenerationCacheEntry<Result>>,
    key: string,
    fingerprint: string,
    operation: () => Promise<Result>,
    retainFailure: (error: unknown) => boolean = () => false,
    maximumEntries = 50,
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
    const entry = {fingerprint, promise, settled: false};
    generations.set(key, entry);
    void promise.then(
      () => {
        entry.settled = true;
      },
      () => {
        entry.settled = true;
      },
    );
    void promise.catch((error) => {
      if (retainFailure(error)) return;
      if (generations.get(key)?.promise === promise) {
        generations.delete(key);
      }
    });

    if (generations.size > maximumEntries) {
      const oldestSettled = [...generations.entries()].find(
        ([candidateKey, candidate]) =>
          candidateKey !== key && candidate.settled,
      )?.[0];
      if (oldestSettled) generations.delete(oldestSettled);
    }

    return promise;
  }

  async function handleVoiceVisualHistoryRoute(
    route: NonNullable<ReturnType<typeof getProjectVoiceVisualHistoryRoute>>,
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ) {
    const currentProject = await repository.getProject(route.projectId);
    if (!currentProject) {
      sendApiError(response, 404, {
        code: 'PROJECT_NOT_FOUND',
        message: 'Không tìm thấy project.',
      });
      return true;
    }
    const plan = currentProject.voiceVisualPlan;
    const outline = currentProject.outline;
    if (!plan) {
      throw new RequestBodyError(
        409,
        'VOICE_VISUAL_NOT_READY',
        'Project chưa có kế hoạch voice–visual để quản lý phiên bản.',
      );
    }
    if (
      !outline ||
      outline.status !== 'approved' ||
      !sameValue(outline.sourceInput, currentProject.topicInput) ||
      plan.sourceOutlineContentRevision !== outline.contentRevision ||
      !voiceVisualMatchesOutline(plan, outline)
    ) {
      throw new RequestBodyError(
        409,
        'VOICE_VISUAL_OUTDATED',
        'Kế hoạch voice–visual không còn khớp mạch giảng hiện tại.',
      );
    }

    const currentContent = versionedVoiceVisualContent(plan);
    const currentContentHash = hashVoiceVisualContent(currentContent);
    const currentContextHash = voiceVisualContextHash(
      currentProject,
      currentContent,
    );

    if (
      route.resource === 'history' &&
      !route.recordId &&
      request.method === 'GET'
    ) {
      await voiceVisualHistoryStore.ensureVersion({
        projectId: currentProject.id,
        origin: 'baseline',
        label: 'Bản hiện tại',
        parentVersionId: null,
        restoredFromVersionId: null,
        candidateId: null,
        projectRevision: currentProject.revision,
        contentHash: currentContentHash,
        artifact: plan,
      });
      const [versions, candidates] = await Promise.all([
        voiceVisualHistoryStore.listVersions(currentProject.id),
        voiceVisualHistoryStore.listCandidates(currentProject.id),
      ]);
      const requestedLimit = Number(requestUrl.searchParams.get('limit') ?? '50');
      const limit = Number.isSafeInteger(requestedLimit)
        ? Math.max(1, Math.min(100, requestedLimit))
        : 50;
      sendJson(response, 200, {
        versions: versions.slice(0, limit),
        candidates: candidates.slice(0, limit),
        currentContentHash,
        currentContextHash,
      });
      return true;
    }
    const expectedRevision = readExpectedRevision(request);
    if (currentProject.revision !== expectedRevision) {
      throw new ProjectConflictError(currentProject);
    }

    if (
      route.resource === 'reviews' &&
      !route.recordId &&
      request.method === 'POST'
    ) {
      const body = await readJsonBody(request);
      const parsedRequest = CreateVoiceVisualReviewSchema.safeParse(body);
      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu review voice–visual chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }

      let targetContentHash = currentContentHash;
      let rootContextHash = currentContextHash;
      let reviewRequest: Parameters<VoiceVisualRevisionService['review']>[0] = {
        target: 'current',
        topicInput: currentProject.topicInput,
        outline,
        content: currentContent,
        model: parsedRequest.data.model,
        reasoningEffort: parsedRequest.data.reasoningEffort,
      };
      if (parsedRequest.data.candidateId) {
        const targetCandidate = await voiceVisualHistoryStore.getCandidate(
          currentProject.id,
          parsedRequest.data.candidateId,
        );
        if (!targetCandidate) {
          throw new RequestBodyError(
            404,
            'VOICE_VISUAL_CANDIDATE_NOT_FOUND',
            'Không tìm thấy candidate cần review.',
          );
        }
        if (targetCandidate.rootBaseContextHash !== currentContextHash) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_CONTEXT_CHANGED',
            'Candidate không còn dựa trên kế hoạch hiện tại.',
          );
        }
        let baseContent: VoiceVisualPlanContent | null = null;
        if (targetCandidate.parentCandidateId) {
          const parentCandidate = await voiceVisualHistoryStore.getCandidate(
            currentProject.id,
            targetCandidate.parentCandidateId,
          );
          baseContent = parentCandidate?.content ?? null;
        } else {
          const baseVersion = await voiceVisualHistoryStore.getVersion(
            currentProject.id,
            targetCandidate.baseVersionId,
          );
          baseContent = baseVersion
            ? versionedVoiceVisualContent(baseVersion.artifact)
            : null;
        }
        if (!baseContent) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_BASE_VERSION_MISSING',
            'Không còn dữ liệu nền để review candidate này.',
          );
        }
        targetContentHash = targetCandidate.candidateContentHash;
        rootContextHash = targetCandidate.rootBaseContextHash;
        reviewRequest = {
          target: 'candidate',
          topicInput: currentProject.topicInput,
          outline,
          baseContent,
          content: targetCandidate.content,
          scope: targetCandidate.scope,
          guidance: targetCandidate.guidance,
          patch: targetCandidate.patch,
          model: parsedRequest.data.model,
          reasoningEffort: parsedRequest.data.reasoningEffort,
        };
      }

      const requestFingerprint = hashJson({
        projectId: currentProject.id,
        targetContentHash,
        rootContextHash,
        request: parsedRequest.data,
      });
      const generation = await generateOnce(
        voiceVisualReviewGenerations,
        `${currentProject.id}:${parsedRequest.data.reviewId}`,
        requestFingerprint,
        () => voiceVisualRevisionService.review(reviewRequest),
      );
      const review: VoiceVisualReviewRecord = {
        reviewId: parsedRequest.data.reviewId,
        projectId: currentProject.id,
        createdAt: generation.generatedAt,
        target: parsedRequest.data.candidateId ? 'candidate' : 'current',
        targetCandidateId: parsedRequest.data.candidateId ?? null,
        targetContentHash,
        rootContextHash,
        reviewedProjectRevision: currentProject.revision,
        coherence: generation.result.coherence,
        generation: {
          provider: 'codex',
          model: generation.result.model,
          requestedModel: parsedRequest.data.model ?? null,
          reasoningEffort: parsedRequest.data.reasoningEffort ?? null,
          promptVersion: VOICE_VISUAL_COHERENCE_PROMPT_VERSION,
          generatedAt: generation.generatedAt,
          usage: generation.result.usage,
        },
      };
      sendJson(response, 201, {review});
      return true;
    }

    if (
      route.resource === 'versions' &&
      !route.recordId &&
      request.method === 'POST'
    ) {
      const body = await readJsonBody(request);
      const parsedRequest = CreateVoiceVisualCheckpointSchema.safeParse(body);
      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Thông tin phiên bản voice–visual chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }
      const versions = await voiceVisualHistoryStore.listVersions(
        currentProject.id,
      );
      const parent = versions.find(
        version => version.contentHash === currentContentHash,
      );
      const version = await voiceVisualHistoryStore.ensureVersion(
        {
          projectId: currentProject.id,
          origin: 'manual_checkpoint',
          label: parsedRequest.data.label ?? 'Phiên bản đã lưu',
          parentVersionId: parent?.versionId ?? null,
          restoredFromVersionId: null,
          candidateId: null,
          projectRevision: currentProject.revision,
          contentHash: currentContentHash,
          artifact: plan,
        },
        {force: true},
      );
      sendJson(response, 201, {version});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      !route.recordId &&
      request.method === 'POST'
    ) {
      const body = await readJsonBody(request);
      const parsedRequest = CreateVoiceVisualCandidateSchema.safeParse(body);
      if (!parsedRequest.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu chỉnh voice–visual chưa hợp lệ.',
          fields: validationFields(parsedRequest.error.issues),
        });
        return true;
      }

      let baseContent = currentContent;
      let baseVersion = await voiceVisualHistoryStore.ensureVersion({
        projectId: currentProject.id,
        origin: 'baseline',
        label: 'Trước chỉnh sửa AI',
        parentVersionId: null,
        restoredFromVersionId: null,
        candidateId: null,
        projectRevision: currentProject.revision,
        contentHash: currentContentHash,
        artifact: plan,
      });
      let parentCandidate: VoiceVisualCandidateRecord | null = null;
      if (parsedRequest.data.baseCandidateId) {
        parentCandidate = await voiceVisualHistoryStore.getCandidate(
          currentProject.id,
          parsedRequest.data.baseCandidateId,
        );
        if (!parentCandidate) {
          throw new RequestBodyError(
            404,
            'VOICE_VISUAL_CANDIDATE_NOT_FOUND',
            'Không tìm thấy đề xuất dùng làm nền chỉnh tiếp.',
          );
        }
        if (parentCandidate.decision !== 'pending') {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_CANDIDATE_ALREADY_DECIDED',
            'Chỉ có thể chỉnh tiếp một candidate đang chờ review.',
          );
        }
        if (parentCandidate.rootBaseContextHash !== currentContextHash) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_CONTEXT_CHANGED',
            'Mạch giảng hoặc kế hoạch nền đã thay đổi. Hãy tạo đề xuất mới.',
          );
        }
        const storedBaseVersion = await voiceVisualHistoryStore.getVersion(
          currentProject.id,
          parentCandidate.baseVersionId,
        );
        if (!storedBaseVersion) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_BASE_VERSION_MISSING',
            'Phiên bản nền của đề xuất không còn khả dụng.',
          );
        }
        baseVersion = storedBaseVersion;
        baseContent = parentCandidate.content;
      }

      const baseContextHash = voiceVisualContextHash(
        currentProject,
        baseContent,
      );
      const requestFingerprint = hashJson({
        projectId: currentProject.id,
        baseContentHash: hashVoiceVisualContent(baseContent),
        baseContextHash,
        request: parsedRequest.data,
      });
      const existingCandidate = await voiceVisualHistoryStore.getCandidate(
        currentProject.id,
        parsedRequest.data.generationId,
      );
      if (existingCandidate) {
        if (existingCandidate.requestFingerprint !== requestFingerprint) {
          throw new RequestBodyError(
            409,
            'GENERATION_ID_REUSED',
            'Generation ID đã được dùng với nội dung khác.',
          );
        }
        sendJson(response, 200, {candidate: existingCandidate});
        return true;
      }

      const generation = await generateOnce(
        voiceVisualCandidateGenerations,
        `${currentProject.id}:${parsedRequest.data.generationId}`,
        requestFingerprint,
        () =>
          voiceVisualRevisionService.revise({
            topicInput: currentProject.topicInput,
            outline,
            baseContent,
            scope: parsedRequest.data.scope,
            guidance: parsedRequest.data.guidance,
            model: parsedRequest.data.model,
            reasoningEffort: parsedRequest.data.reasoningEffort,
          }),
      );
      const coherence = generation.result.coherence;
      const status =
        coherence.verdict === 'needs_scope_expansion' ||
        coherence.issues.some(issue => issue.requiresScopeExpansion)
          ? 'scope_expansion_required'
          : coherence.issues.some(issue => issue.severity === 'error')
            ? 'coherence_blocked'
            : coherence.verdict === 'warning' || coherence.issues.length > 0
              ? 'coherence_warning'
              : 'ready';
      const candidate = await voiceVisualHistoryStore.saveCandidate({
        candidateId: parsedRequest.data.generationId,
        projectId: currentProject.id,
        createdAt: generation.generatedAt,
        status,
        decision: 'pending',
        decidedAt: null,
        appliedVersionId: null,
        baseVersionId: baseVersion.versionId,
        parentCandidateId: parentCandidate?.candidateId ?? null,
        rootBaseContentHash:
          parentCandidate?.rootBaseContentHash ?? currentContentHash,
        baseContentHash: hashVoiceVisualContent(baseContent),
        rootBaseContextHash:
          parentCandidate?.rootBaseContextHash ?? currentContextHash,
        baseContextHash,
        baseProjectRevision: currentProject.revision,
        candidateContentHash: hashVoiceVisualContent(generation.result.content),
        requestFingerprint,
        guidance: parsedRequest.data.guidance,
        scope: parsedRequest.data.scope,
        patch: generation.result.patch,
        content: generation.result.content,
        coherence,
        generation: {
          provider: 'codex',
          model: generation.result.model,
          requestedModel: parsedRequest.data.model ?? null,
          reasoningEffort: parsedRequest.data.reasoningEffort ?? null,
          promptVersion: VOICE_VISUAL_REVISION_PROMPT_VERSION,
          generatedAt: generation.generatedAt,
          editorUsage: generation.result.editorUsage,
          reviewerUsage: generation.result.reviewerUsage,
        },
      });
      sendJson(response, 201, {candidate});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      route.recordId &&
      route.action === 'reject' &&
      request.method === 'POST'
    ) {
      const candidate = await voiceVisualHistoryStore.setCandidateDecision(
        currentProject.id,
        route.recordId,
        'rejected',
      );
      sendJson(response, 200, {candidate});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      route.recordId &&
      route.action === 'apply' &&
      request.method === 'POST'
    ) {
      const candidate = await voiceVisualHistoryStore.getCandidate(
        currentProject.id,
        route.recordId,
      );
      if (!candidate) {
        throw new RequestBodyError(
          404,
          'VOICE_VISUAL_CANDIDATE_NOT_FOUND',
          'Không tìm thấy đề xuất chỉnh sửa.',
        );
      }
      if (candidate.decision === 'rejected') {
        throw new RequestBodyError(
          409,
          'VOICE_VISUAL_CANDIDATE_REJECTED',
          'Đề xuất này đã bị từ chối và chỉ còn trong lịch sử.',
        );
      }
      if (
        candidate.decision === 'accepted' &&
        currentContentHash === candidate.candidateContentHash
      ) {
        sendProject(response, 200, currentProject);
        return true;
      }
      if (candidate.decision === 'accepted') {
        throw new RequestBodyError(
          409,
          'VOICE_VISUAL_CANDIDATE_ALREADY_ACCEPTED',
          'Đề xuất này đã được áp dụng trước đó.',
        );
      }
      // Coherence review is advisory. Applying a reviewed candidate is an
      // explicit user decision; only structural and stale-context guards below
      // may prevent that decision from being persisted.
      if (candidate.rootBaseContextHash !== currentContextHash) {
        throw new RequestBodyError(
          409,
          'VOICE_VISUAL_CONTEXT_CHANGED',
          'Mạch giảng hoặc kế hoạch nền đã thay đổi kể từ lúc tạo đề xuất.',
        );
      }

      const nextContent = candidate.content;
      const nextPlan: VoiceVisualPlan = {
        ...nextContent,
        status: 'draft',
        contentRevision: plan.contentRevision + 1,
        narrationRevision: nextNarrationRevision(plan, nextContent),
        sourceOutlineContentRevision: outline.contentRevision,
        generation: {
          generationId: candidate.candidateId,
          provider: 'codex',
          model: candidate.generation.model,
          ...(candidate.generation.requestedModel
            ? {requestedModel: candidate.generation.requestedModel}
            : {}),
          ...(candidate.generation.reasoningEffort
            ? {reasoningEffort: candidate.generation.reasoningEffort}
            : {}),
          promptVersion: candidate.generation.promptVersion,
          generatedAt: candidate.generation.generatedAt,
          usage: candidate.generation.editorUsage,
        },
      };
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {voiceVisualPlan: nextPlan, currentStep: 'voiceVisual'},
        expectedRevision,
      );
      if (!updatedProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const version = await voiceVisualHistoryStore
        .ensureVersion(
          {
            projectId: updatedProject.id,
            origin: 'ai_candidate',
            label: candidate.patch.editSummary,
            parentVersionId: candidate.baseVersionId,
            restoredFromVersionId: null,
            candidateId: candidate.candidateId,
            projectRevision: updatedProject.revision,
            contentHash: hashVoiceVisualContent(nextPlan),
            artifact: nextPlan,
          },
          {force: true},
        )
        .catch(error => {
          logger.error(error);
          return null;
        });
      await voiceVisualHistoryStore
        .setCandidateDecision(
          updatedProject.id,
          candidate.candidateId,
          'accepted',
          version?.versionId ?? null,
        )
        .catch(error => logger.error(error));
      sendJson(
        response,
        200,
        {project: updatedProject, version},
        {ETag: `"${updatedProject.revision}"`},
      );
      return true;
    }

    if (
      route.resource === 'versions' &&
      route.recordId &&
      route.action === 'restore' &&
      request.method === 'POST'
    ) {
      const sourceVersion = await voiceVisualHistoryStore.getVersion(
        currentProject.id,
        route.recordId,
      );
      if (!sourceVersion) {
        throw new RequestBodyError(
          404,
          'VOICE_VISUAL_VERSION_NOT_FOUND',
          'Không tìm thấy phiên bản cần khôi phục.',
        );
      }
      if (
        sourceVersion.artifact.sourceOutlineContentRevision !==
        outline.contentRevision
      ) {
        throw new RequestBodyError(
          409,
          'VOICE_VISUAL_VERSION_OUTDATED',
          'Phiên bản này thuộc một mạch giảng cũ nên không thể khôi phục trực tiếp.',
        );
      }
      const currentVersion = await voiceVisualHistoryStore.ensureVersion({
        projectId: currentProject.id,
        origin: 'baseline',
        label: 'Trước khi khôi phục',
        parentVersionId: null,
        restoredFromVersionId: null,
        candidateId: null,
        projectRevision: currentProject.revision,
        contentHash: currentContentHash,
        artifact: plan,
      });
      const restoredContent = versionedVoiceVisualContent(
        sourceVersion.artifact,
      );
      const restoredPlan: VoiceVisualPlan = {
        ...sourceVersion.artifact,
        ...restoredContent,
        status: 'draft',
        contentRevision: plan.contentRevision + 1,
        narrationRevision: nextNarrationRevision(plan, restoredContent),
        sourceOutlineContentRevision: outline.contentRevision,
      };
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {voiceVisualPlan: restoredPlan, currentStep: 'voiceVisual'},
        expectedRevision,
      );
      if (!updatedProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const version = await voiceVisualHistoryStore.ensureVersion(
        {
          projectId: updatedProject.id,
          origin: 'restore',
          label: `Khôi phục từ ${sourceVersion.label ?? 'phiên bản cũ'}`,
          parentVersionId: currentVersion.versionId,
          restoredFromVersionId: sourceVersion.versionId,
          candidateId: null,
          projectRevision: updatedProject.revision,
          contentHash: hashVoiceVisualContent(restoredPlan),
          artifact: restoredPlan,
        },
        {force: true},
      );
      sendJson(
        response,
        200,
        {project: updatedProject, version},
        {ETag: `"${updatedProject.revision}"`},
      );
      return true;
    }

    return false;
  }

  async function handleMotionCanvasHistoryRoute(
    route: NonNullable<ReturnType<typeof getProjectMotionCanvasHistoryRoute>>,
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ) {
    const currentProject = await repository.getProject(route.projectId);
    if (!currentProject) {
      sendApiError(response, 404, {
        code: 'PROJECT_NOT_FOUND',
        message: 'Không tìm thấy project.',
      });
      return true;
    }
    const outline = currentProject.outline;
    const voiceVisualPlan = currentProject.voiceVisualPlan;
    const bundle = currentProject.motionCanvasBundle;
    if (!bundle) {
      throw new RequestBodyError(
        409,
        'MOTION_CANVAS_NOT_READY',
        'Project chưa có scene Motion Canvas để quản lý phiên bản.',
      );
    }
    if (
      !outline ||
      outline.status !== 'approved' ||
      !voiceVisualPlan ||
      voiceVisualPlan.status !== 'approved' ||
      !sameValue(outline.sourceInput, currentProject.topicInput) ||
      voiceVisualPlan.sourceOutlineContentRevision !== outline.contentRevision ||
      bundle.sourceVoiceVisualContentRevision !==
        voiceVisualPlan.contentRevision ||
      !motionCanvasMatchesOutline(bundle, outline)
    ) {
      throw new RequestBodyError(
        409,
        'MOTION_CANVAS_OUTDATED',
        'Workspace Motion Canvas không còn khớp đầu vào đã chốt.',
      );
    }
    await motionCanvasWorkspace.verify(currentProject.id, bundle);
    const currentContentHash = hashMotionCanvasBundle(bundle);
    const currentContextHash = motionCanvasContextHash(currentProject, bundle);

    if (
      route.resource === 'history' &&
      !route.recordId &&
      request.method === 'GET'
    ) {
      await motionCanvasHistoryStore.ensureVersion({
        projectId: currentProject.id,
        origin: 'baseline',
        label: 'Bản hiện tại',
        parentVersionId: null,
        restoredFromVersionId: null,
        candidateId: null,
        projectRevision: currentProject.revision,
        contentHash: currentContentHash,
        artifact: bundle,
      });
      const [versions, candidates] = await Promise.all([
        motionCanvasHistoryStore.listVersions(currentProject.id),
        motionCanvasHistoryStore.listCandidates(currentProject.id),
      ]);
      const requestedLimit = Number(requestUrl.searchParams.get('limit') ?? '50');
      const limit = Number.isSafeInteger(requestedLimit)
        ? Math.max(1, Math.min(100, requestedLimit))
        : 50;
      sendJson(response, 200, {
        versions: versions.slice(0, limit),
        candidates: candidates.slice(0, limit),
        currentContentHash,
        currentContextHash,
      });
      return true;
    }

    if (
      route.resource === 'candidates' &&
      route.recordId &&
      route.action === 'files' &&
      request.method === 'GET'
    ) {
      const candidate = await motionCanvasHistoryStore.getCandidate(
        currentProject.id,
        route.recordId,
      );
      if (!candidate) {
        throw new RequestBodyError(
          404,
          'MOTION_CANVAS_CANDIDATE_NOT_FOUND',
          'Không tìm thấy candidate scene.',
        );
      }
      await motionCanvasWorkspace.verify(currentProject.id, candidate.bundle);
      const files = await motionCanvasWorkspace.readFiles(
        currentProject.id,
        candidate.bundle,
      );
      sendJson(response, 200, {bundle: candidate.bundle, files});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      route.recordId &&
      route.action === 'preview' &&
      request.method === 'GET'
    ) {
      const candidate = await motionCanvasHistoryStore.getCandidate(
        currentProject.id,
        route.recordId,
      );
      if (!candidate) {
        throw new RequestBodyError(
          404,
          'MOTION_CANVAS_CANDIDATE_NOT_FOUND',
          'Không tìm thấy candidate scene.',
        );
      }
      await motionCanvasWorkspace.verify(currentProject.id, candidate.bundle);
      const preview = await layoutPreviewService.startMotion(
        currentProject.id,
        candidate.bundle,
        {parentOrigin: requestParentOrigin(request), initialOverrides: []},
      );
      sendJson(response, 200, {
        preview: {
          ...preview,
          sourceMotionCanvasGenerationId: preview.sourceSyncGenerationId,
        },
      });
      return true;
    }

    const expectedRevision = readExpectedRevision(request);
    if (currentProject.revision !== expectedRevision) {
      throw new ProjectConflictError(currentProject);
    }

    if (
      route.resource === 'versions' &&
      !route.recordId &&
      request.method === 'POST'
    ) {
      const body = await readJsonBody(request);
      const parsed = CreateMotionCanvasCheckpointSchema.safeParse(body);
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Thông tin phiên bản Motion Canvas chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const versions = await motionCanvasHistoryStore.listVersions(
        currentProject.id,
      );
      const parent = versions.find(
        version => version.contentHash === currentContentHash,
      );
      const version = await motionCanvasHistoryStore.ensureVersion(
        {
          projectId: currentProject.id,
          origin: 'manual_checkpoint',
          label: parsed.data.label ?? 'Phiên bản scene đã lưu',
          parentVersionId: parent?.versionId ?? null,
          restoredFromVersionId: null,
          candidateId: null,
          projectRevision: currentProject.revision,
          contentHash: currentContentHash,
          artifact: bundle,
        },
        {force: true},
      );
      sendJson(response, 201, {version});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      !route.recordId &&
      request.method === 'POST'
    ) {
      const body = await readJsonBody(request);
      const parsed = CreateMotionCanvasCandidateSchema.safeParse(body);
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu chỉnh scene Motion Canvas chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const generationId = parsed.data.generationId.toLowerCase();
      let baseBundle = bundle;
      let baseVersion = await motionCanvasHistoryStore.ensureVersion({
        projectId: currentProject.id,
        origin: 'baseline',
        label: 'Trước chỉnh sửa AI',
        parentVersionId: null,
        restoredFromVersionId: null,
        candidateId: null,
        projectRevision: currentProject.revision,
        contentHash: currentContentHash,
        artifact: bundle,
      });
      let parentCandidate: MotionCanvasCandidateRecord | null = null;
      if (parsed.data.baseCandidateId) {
        parentCandidate = await motionCanvasHistoryStore.getCandidate(
          currentProject.id,
          parsed.data.baseCandidateId,
        );
        if (!parentCandidate) {
          throw new RequestBodyError(
            404,
            'MOTION_CANVAS_CANDIDATE_NOT_FOUND',
            'Không tìm thấy candidate dùng làm nền chỉnh tiếp.',
          );
        }
        if (parentCandidate.decision !== 'pending') {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_CANDIDATE_ALREADY_DECIDED',
            'Chỉ có thể chỉnh tiếp candidate đang chờ review.',
          );
        }
        if (parentCandidate.rootBaseContextHash !== currentContextHash) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_CONTEXT_CHANGED',
            'Đầu vào hoặc workspace nền đã thay đổi. Hãy tạo candidate mới.',
          );
        }
        const storedBaseVersion = await motionCanvasHistoryStore.getVersion(
          currentProject.id,
          parentCandidate.baseVersionId,
        );
        if (!storedBaseVersion) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_BASE_VERSION_MISSING',
            'Phiên bản nền của candidate không còn khả dụng.',
          );
        }
        baseVersion = storedBaseVersion;
        baseBundle = parentCandidate.bundle;
        await motionCanvasWorkspace.verify(currentProject.id, baseBundle);
      }
      const sceneIds = new Set(baseBundle.scenes.map(scene => scene.id));
      if (parsed.data.scope.sceneIds.some(sceneId => !sceneIds.has(sceneId))) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_SCOPE_STALE',
          'Phạm vi scene không còn khớp workspace nền.',
        );
      }
      const baseContentHash = hashMotionCanvasBundle(baseBundle);
      const baseContextHash = motionCanvasContextHash(
        currentProject,
        baseBundle,
      );
      const requestFingerprint = hashJson({
        projectId: currentProject.id,
        baseContentHash,
        baseContextHash,
        request: parsed.data,
      });
      const existingCandidate = await motionCanvasHistoryStore.getCandidate(
        currentProject.id,
        generationId,
      );
      if (existingCandidate) {
        if (existingCandidate.requestFingerprint !== requestFingerprint) {
          throw new RequestBodyError(
            409,
            'GENERATION_ID_REUSED',
            'Generation ID đã được dùng với nội dung khác.',
          );
        }
        sendJson(response, 200, {candidate: existingCandidate});
        return true;
      }

      const generation = await generateOnce(
        motionCanvasCandidateGenerations,
        `${currentProject.id}:${generationId}`,
        requestFingerprint,
        async () => {
          const baseSources = await motionCanvasWorkspace.readSceneSources(
            currentProject.id,
            baseBundle,
          );
          const selectedSceneIds = new Set(parsed.data.scope.sceneIds);
          const sectionIndexes = baseBundle.scenes
            .map((scene, index) => selectedSceneIds.has(scene.id) ? index : -1)
            .filter(index => index >= 0);
          const generationRequest = {
            generationId,
            model: parsed.data.model,
            reasoningEffort: parsed.data.reasoningEffort,
            topicInput: currentProject.topicInput,
            outline,
            voiceVisualPlan,
            sectionIndexes,
            guidance: parsed.data.guidance,
            currentScenes: baseSources,
          };
          let generated = await motionCanvasGenerator.generate(
            generationRequest,
          );
          const mergeScenes = () => {
            const generatedBySection = new Map(
              generated.scenes.map(scene => [scene.outlineSectionId, scene]),
            );
            return baseSources.map(baseScene => {
              if (!selectedSceneIds.has(baseScene.id)) return baseScene;
              const replacement = generatedBySection.get(
                baseScene.outlineSectionId,
              );
              if (!replacement) {
                throw new MotionCanvasGenerationError(
                  'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
                  'Codex không trả đủ các scene đã chọn.',
                );
              }
              return {
                ...replacement,
                id: baseScene.id,
                filePath: baseScene.filePath,
                outlineSectionId: baseScene.outlineSectionId,
              };
            });
          };
          let mergedSources = mergeScenes();
          let prepared: PreparedMotionCanvasWorkspace | null = null;
          let repairAttempts = 0;
          let fallbackAttempted = false;
          while (!prepared) {
            try {
              prepared = await motionCanvasWorkspace.prepare(
                currentProject.id,
                generationId,
                mergedSources,
              );
            } catch (error) {
              if (
                error instanceof MotionCanvasWorkspaceError &&
                error.code === 'MOTION_CANVAS_VALIDATION_FAILED' &&
                error.details &&
                motionCanvasGenerator.repair &&
                repairAttempts < 1
              ) {
                repairAttempts += 1;
                try {
                  generated = await motionCanvasGenerator.repair(
                    generationRequest,
                    generated,
                    error.details,
                  );
                } catch (repairError) {
                  if (!motionCanvasGenerator.recover || fallbackAttempted) {
                    throw repairError;
                  }
                  fallbackAttempted = true;
                  generated = motionCanvasGenerator.recover(
                    generationRequest,
                    generated,
                    `${error.details}\n\nRepair failed: ${
                      repairError instanceof Error
                        ? repairError.message
                        : String(repairError)
                    }`,
                  );
                }
                mergedSources = mergeScenes();
                continue;
              }
              if (
                error instanceof MotionCanvasWorkspaceError &&
                error.code === 'MOTION_CANVAS_VALIDATION_FAILED' &&
                error.details &&
                motionCanvasGenerator.recover &&
                !fallbackAttempted
              ) {
                fallbackAttempted = true;
                generated = motionCanvasGenerator.recover(
                  generationRequest,
                  generated,
                  error.details,
                );
                mergedSources = mergeScenes();
                continue;
              }
              throw error;
            }
          }
          let review: MotionCanvasRevisionReviewResult;
          try {
            review = await motionCanvasRevisionReviewService.review({
              topicInput: currentProject.topicInput,
              outline,
              voiceVisualPlan,
              scope: parsed.data.scope,
              guidance: parsed.data.guidance,
              scenes: mergedSources.map(scene => {
                const changed = selectedSceneIds.has(scene.id);
                return {
                  sceneId: scene.id,
                  outlineSectionId: scene.outlineSectionId,
                  name: scene.name,
                  changed,
                  sourceExcerpt:
                    changed ? scene.source.slice(0, 24_000) : '',
                };
              }),
              model: parsed.data.model,
              reasoningEffort: parsed.data.reasoningEffort,
            });
          } catch (error) {
            if (!(error instanceof MotionCanvasRevisionReviewError)) {
              throw error;
            }
            logger.info(
              `Motion candidate ${generationId} đã compile nhưng reviewer không hoàn tất: ${error.code}`,
            );
            review = {
              coherence: {
                verdict: 'warning',
                summary:
                  'Các scene đã sinh qua kiểm tra TypeScript và timing; lượt review mạch lạc tự động chưa hoàn tất.',
                issues: [{
                  severity: 'warning',
                  category: 'scope',
                  message:
                    'Reviewer Codex tạm thời không phản hồi, nhưng workspace hợp lệ vẫn được giữ để tránh mất kết quả đã sinh.',
                  suggestedFix:
                    'Mở preview candidate và chạy lại review nếu bạn cần kiểm tra thêm trước khi áp dụng.',
                  affectedSceneIds: parsed.data.scope.sceneIds,
                  requiresScopeExpansion: false,
                }],
              },
              model: generated.model || 'unavailable',
              usage: null,
            };
          }
          return {generated, prepared, review};
        },
      );
      const prepared = generation.result.prepared;
      const candidateBundle: MotionCanvasBundle = {
        status: 'draft',
        contentRevision: bundle.contentRevision + 1,
        sourceVoiceVisualContentRevision: voiceVisualPlan.contentRevision,
        workspacePath: prepared.workspacePath,
        projectFile: prepared.projectFile,
        width: MOTION_CANVAS_WIDTH,
        height: MOTION_CANVAS_HEIGHT,
        fps: MOTION_CANVAS_FPS,
        ...(prepared.scenes.every(scene => scene.timingEvents?.length)
          ? {timingContractVersion: 1 as const}
          : {}),
        scenes: prepared.scenes,
        validation: prepared.validation,
        generation: {
          generationId,
          provider: 'codex',
          model: generation.result.generated.model,
          requestedModel: parsed.data.model,
          reasoningEffort: parsed.data.reasoningEffort,
          promptVersion: MOTION_CANVAS_PROMPT_VERSION,
          generatedAt: generation.generatedAt,
          usage: generation.result.generated.usage,
        },
      };
      const coherence = generation.result.review.coherence;
      const status =
        coherence.verdict === 'needs_scope_expansion' ||
        coherence.issues.some(issue => issue.requiresScopeExpansion)
          ? 'scope_expansion_required'
          : coherence.issues.some(issue => issue.severity === 'error')
            ? 'coherence_blocked'
            : coherence.verdict === 'warning' || coherence.issues.length > 0
              ? 'coherence_warning'
              : 'ready';
      const candidate = await motionCanvasHistoryStore.saveCandidate({
        candidateId: generationId,
        projectId: currentProject.id,
        createdAt: generation.generatedAt,
        status,
        decision: 'pending',
        decidedAt: null,
        appliedVersionId: null,
        baseVersionId: baseVersion.versionId,
        parentCandidateId: parentCandidate?.candidateId ?? null,
        rootBaseContentHash:
          parentCandidate?.rootBaseContentHash ?? currentContentHash,
        baseContentHash,
        rootBaseContextHash:
          parentCandidate?.rootBaseContextHash ?? currentContextHash,
        baseContextHash,
        baseProjectRevision: currentProject.revision,
        candidateContentHash: hashMotionCanvasBundle(candidateBundle),
        requestFingerprint,
        guidance: parsed.data.guidance,
        scope: parsed.data.scope,
        bundle: candidateBundle,
        coherence,
        generation: {
          provider: 'codex',
          model: generation.result.generated.model,
          requestedModel: parsed.data.model ?? null,
          reasoningEffort: parsed.data.reasoningEffort ?? null,
          promptVersion: `${MOTION_CANVAS_PROMPT_VERSION}+${MOTION_CANVAS_COHERENCE_PROMPT_VERSION}`.slice(0, 40),
          generatedAt: generation.generatedAt,
          generationUsage: generation.result.generated.usage,
          reviewerUsage: generation.result.review.usage,
        },
      });
      motionCanvasGenerator.discardGeneration?.(generationId);
      sendJson(response, 201, {candidate});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      route.recordId &&
      route.action === 'reject' &&
      request.method === 'POST'
    ) {
      const candidate = await motionCanvasHistoryStore.setCandidateDecision(
        currentProject.id,
        route.recordId,
        'rejected',
      );
      sendJson(response, 200, {candidate});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      route.recordId &&
      route.action === 'apply' &&
      request.method === 'POST'
    ) {
      const candidate = await motionCanvasHistoryStore.getCandidate(
        currentProject.id,
        route.recordId,
      );
      if (!candidate) {
        throw new RequestBodyError(
          404,
          'MOTION_CANVAS_CANDIDATE_NOT_FOUND',
          'Không tìm thấy candidate scene.',
        );
      }
      if (candidate.decision === 'rejected') {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_CANDIDATE_REJECTED',
          'Candidate này đã bị từ chối và chỉ còn trong lịch sử.',
        );
      }
      if (
        candidate.decision === 'accepted' &&
        currentContentHash === candidate.candidateContentHash
      ) {
        sendProject(response, 200, currentProject);
        return true;
      }
      if (candidate.decision === 'accepted') {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_CANDIDATE_ALREADY_ACCEPTED',
          'Candidate này đã được áp dụng trước đó.',
        );
      }
      if (
        candidate.status === 'scope_expansion_required' ||
        candidate.status === 'coherence_blocked'
      ) {
        throw new RequestBodyError(
          409,
          candidate.status === 'scope_expansion_required'
            ? 'MOTION_CANVAS_SCOPE_EXPANSION_REQUIRED'
            : 'MOTION_CANVAS_COHERENCE_BLOCKED',
          candidate.status === 'scope_expansion_required'
            ? 'Candidate cần mở rộng phạm vi trước khi áp dụng.'
            : 'Candidate còn lỗi mạch lạc nghiêm trọng.',
        );
      }
      if (candidate.rootBaseContextHash !== currentContextHash) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_CONTEXT_CHANGED',
          'Đầu vào hoặc workspace nền đã thay đổi kể từ lúc tạo candidate.',
        );
      }
      await motionCanvasWorkspace.verify(currentProject.id, candidate.bundle);
      const nextBundle: MotionCanvasBundle = {
        ...candidate.bundle,
        status: 'draft',
        contentRevision: bundle.contentRevision + 1,
        sourceVoiceVisualContentRevision: voiceVisualPlan.contentRevision,
      };
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {motionCanvasBundle: nextBundle, currentStep: 'motionCanvas'},
        expectedRevision,
      );
      if (!updatedProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const version = await motionCanvasHistoryStore
        .ensureVersion(
          {
            projectId: updatedProject.id,
            origin: 'ai_candidate',
            label: `Chỉnh ${candidate.scope.sceneIds.length} scene`,
            parentVersionId: candidate.baseVersionId,
            restoredFromVersionId: null,
            candidateId: candidate.candidateId,
            projectRevision: updatedProject.revision,
            contentHash: hashMotionCanvasBundle(nextBundle),
            artifact: nextBundle,
          },
          {force: true},
        )
        .catch(error => {
          logger.error(error);
          return null;
        });
      await motionCanvasHistoryStore
        .setCandidateDecision(
          updatedProject.id,
          candidate.candidateId,
          'accepted',
          version?.versionId ?? null,
        )
        .catch(error => logger.error(error));
      sendJson(
        response,
        200,
        {project: updatedProject, version},
        {ETag: `"${updatedProject.revision}"`},
      );
      return true;
    }

    if (
      route.resource === 'versions' &&
      route.recordId &&
      route.action === 'restore' &&
      request.method === 'POST'
    ) {
      const sourceVersion = await motionCanvasHistoryStore.getVersion(
        currentProject.id,
        route.recordId,
      );
      if (!sourceVersion) {
        throw new RequestBodyError(
          404,
          'MOTION_CANVAS_VERSION_NOT_FOUND',
          'Không tìm thấy phiên bản scene cần khôi phục.',
        );
      }
      if (
        sourceVersion.artifact.sourceVoiceVisualContentRevision !==
        voiceVisualPlan.contentRevision
      ) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_VERSION_OUTDATED',
          'Phiên bản scene này thuộc kế hoạch voice–visual cũ.',
        );
      }
      await motionCanvasWorkspace.verify(
        currentProject.id,
        sourceVersion.artifact,
      );
      const currentVersion = await motionCanvasHistoryStore.ensureVersion({
        projectId: currentProject.id,
        origin: 'baseline',
        label: 'Trước khi khôi phục',
        parentVersionId: null,
        restoredFromVersionId: null,
        candidateId: null,
        projectRevision: currentProject.revision,
        contentHash: currentContentHash,
        artifact: bundle,
      });
      const restoreGenerationId = randomUUID();
      const sources = await motionCanvasWorkspace.readSceneSources(
        currentProject.id,
        sourceVersion.artifact,
      );
      const prepared = await motionCanvasWorkspace.prepare(
        currentProject.id,
        restoreGenerationId,
        sources,
      );
      const restoredBundle: MotionCanvasBundle = {
        ...sourceVersion.artifact,
        status: 'draft',
        contentRevision: bundle.contentRevision + 1,
        sourceVoiceVisualContentRevision: voiceVisualPlan.contentRevision,
        workspacePath: prepared.workspacePath,
        projectFile: prepared.projectFile,
        scenes: prepared.scenes,
        validation: prepared.validation,
        generation: {
          ...sourceVersion.artifact.generation,
          generationId: restoreGenerationId,
          generatedAt: new Date().toISOString(),
          usage: null,
        },
      };
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {motionCanvasBundle: restoredBundle, currentStep: 'motionCanvas'},
        expectedRevision,
      );
      if (!updatedProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const version = await motionCanvasHistoryStore.ensureVersion(
        {
          projectId: updatedProject.id,
          origin: 'restore',
          label: `Khôi phục từ ${sourceVersion.label ?? 'phiên bản cũ'}`,
          parentVersionId: currentVersion.versionId,
          restoredFromVersionId: sourceVersion.versionId,
          candidateId: null,
          projectRevision: updatedProject.revision,
          contentHash: hashMotionCanvasBundle(restoredBundle),
          artifact: restoredBundle,
        },
        {force: true},
      );
      sendJson(
        response,
        200,
        {project: updatedProject, version},
        {ETag: `"${updatedProject.revision}"`},
      );
      return true;
    }
    return false;
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
        requestUrl.pathname === '/api/integrations/codex/api-key' &&
        request.method === 'POST'
      ) {
        const body = await readJsonBody(request);
        const parsed = CodexApiKeyLoginSchema.safeParse(body);
        if (!parsed.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'OpenAI API key chưa hợp lệ.',
            fields: validationFields(parsed.error.issues),
          });
          return;
        }
        await codexConnection.loginWithApiKey(parsed.data.apiKey);
        const status = await codexConnection.verifyConnection();
        if (status.state !== 'connected') {
          throw new CodexConnectionError(
            'CODEX_API_KEY_VERIFICATION_FAILED',
            status.message,
          );
        }
        response.setHeader('Cache-Control', 'no-store');
        sendJson(response, 200, {status});
        return;
      }

      if (
        requestUrl.pathname === '/api/integrations/codex/logout' &&
        request.method === 'POST'
      ) {
        await codexConnection.logout();
        response.setHeader('Cache-Control', 'no-store');
        sendJson(response, 200, {status: 'disconnected'});
        return;
      }

      if (
        requestUrl.pathname === '/api/integrations/codex/models' &&
        request.method === 'GET'
      ) {
        const models = await codexConnection.listModels();
        response.setHeader('Cache-Control', 'no-store');
        sendJson(response, 200, {models});
        return;
      }

      if (
        requestUrl.pathname === '/api/topic-guidance/generate' &&
        request.method === 'POST'
      ) {
        const body = await readJsonBody(request);
        const parsedRequest = GenerateTopicGuidanceSchema.safeParse(body);
        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Thông tin để đề xuất định hướng chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }

        const {
          generationId,
          topicInput,
          userGuidance,
          model,
          reasoningEffort,
        } = parsedRequest.data;
        const fingerprint = JSON.stringify({
          topicInput,
          userGuidance: userGuidance ?? null,
          model: model ?? null,
          reasoningEffort: reasoningEffort ?? null,
        });
        const generated = await generateOnce(
          topicGuidanceGenerations,
          generationId,
          fingerprint,
          () =>
            topicGuidanceGenerator.generate({
              topicInput,
              ...(userGuidance ? {userGuidance} : {}),
              ...(model ? {model} : {}),
              ...(reasoningEffort ? {reasoningEffort} : {}),
            }),
        );
        sendJson(response, 200, {
          suggestion: generated.result.suggestion,
          generation: {
            generationId,
            provider: 'codex',
            model: generated.result.model,
            ...(model ? {requestedModel: model} : {}),
            ...(reasoningEffort ? {reasoningEffort} : {}),
            promptVersion: TOPIC_GUIDANCE_PROMPT_VERSION,
            generatedAt: generated.generatedAt,
            usage: generated.result.usage,
          },
        });
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
        requestUrl.pathname === '/api/integrations/elevenlabs/credential' &&
        request.method === 'GET'
      ) {
        const stored = Boolean(await credentialStore.get('elevenlabs'));
        sendJson(response, 200, {
          credential: {
            configured: stored || Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
            source: stored
              ? 'secure-store'
              : process.env.ELEVENLABS_API_KEY?.trim()
                ? 'environment'
                : 'none',
            persistence: credentialStore.persistence,
          },
        });
        return;
      }

      if (
        requestUrl.pathname === '/api/integrations/elevenlabs/credential' &&
        request.method === 'PUT'
      ) {
        const body = await readJsonBody(request);
        const parsed = ElevenLabsApiKeySchema.safeParse(body);
        if (!parsed.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'ElevenLabs API key chưa hợp lệ.',
            fields: validationFields(parsed.error.issues),
          });
          return;
        }
        const status = await elevenLabsConnectionFactory(
          parsed.data.apiKey,
        ).verifyConnection();
        if (status.state !== 'connected') {
          sendApiError(response, 422, {
            code: 'ELEVENLABS_API_KEY_VERIFICATION_FAILED',
            message: status.message,
          });
          return;
        }
        await credentialStore.set('elevenlabs', parsed.data.apiKey);
        response.setHeader('Cache-Control', 'no-store');
        sendJson(response, 200, {
          status,
          credential: {
            configured: true,
            source: 'secure-store',
            persistence: credentialStore.persistence,
          },
        });
        return;
      }

      if (
        requestUrl.pathname === '/api/integrations/elevenlabs/credential' &&
        request.method === 'DELETE'
      ) {
        await credentialStore.delete('elevenlabs');
        response.setHeader('Cache-Control', 'no-store');
        sendJson(response, 200, {
          credential: {
            configured: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
            source: process.env.ELEVENLABS_API_KEY?.trim()
              ? 'environment'
              : 'none',
            persistence: credentialStore.persistence,
          },
        });
        return;
      }

      if (
        requestUrl.pathname === '/api/integrations/elevenlabs/catalog' &&
        request.method === 'GET'
      ) {
        const catalog = await elevenLabsVoiceService.getCatalog(
          requestUrl.searchParams.get('search')?.trim() ?? '',
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
          requestUrl.searchParams.get('search')?.trim() ?? '',
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

      const outlineHistoryRoute = getProjectOutlineHistoryRoute(
        requestUrl.pathname,
      );

      if (
        outlineHistoryRoute?.resource === 'history' &&
        !outlineHistoryRoute.recordId &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(
          outlineHistoryRoute.projectId,
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
            'Project chưa có mạch giảng để quản lý phiên bản.',
          );
        }
        await outlineHistoryStore.ensureVersion({
          projectId: currentProject.id,
          origin: 'baseline',
          label: 'Bản hiện tại',
          parentVersionId: null,
          restoredFromVersionId: null,
          candidateId: null,
          projectRevision: currentProject.revision,
          contentHash: hashOutlineContent(currentProject.outline),
          artifact: currentProject.outline,
        });
        const [versions, candidates] = await Promise.all([
          outlineHistoryStore.listVersions(currentProject.id),
          outlineHistoryStore.listCandidates(currentProject.id),
        ]);
        const requestedLimit = Number(
          requestUrl.searchParams.get('limit') ?? '50',
        );
        const historyLimit = Number.isSafeInteger(requestedLimit)
          ? Math.max(1, Math.min(100, requestedLimit))
          : 50;
        sendJson(response, 200, {
          versions: versions.slice(0, historyLimit),
          candidates: candidates.slice(0, historyLimit),
          currentContentHash: hashOutlineContent(currentProject.outline),
          currentContextHash: outlineContextHash(
            currentProject.topicInput,
            outlineContent(currentProject.outline),
            currentProject.outline.sourceInput,
          ),
        });
        return;
      }

      if (
        outlineHistoryRoute?.resource === 'versions' &&
        !outlineHistoryRoute.recordId &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = CreateOutlineCheckpointSchema.safeParse(body);
        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Thông tin phiên bản chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }
        const currentProject = await repository.getProject(
          outlineHistoryRoute.projectId,
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
        if (!currentProject.outline) {
          throw new RequestBodyError(
            409,
            'OUTLINE_NOT_READY',
            'Project chưa có mạch giảng để lưu phiên bản.',
          );
        }
        const currentVersions = await outlineHistoryStore.listVersions(
          currentProject.id,
        );
        const parent = currentVersions.find(
          version =>
            version.contentHash === hashOutlineContent(currentProject.outline!),
        );
        const version = await outlineHistoryStore.ensureVersion(
          {
            projectId: currentProject.id,
            origin: 'manual_checkpoint',
            label: parsedRequest.data.label ?? 'Phiên bản đã lưu',
            parentVersionId: parent?.versionId ?? null,
            restoredFromVersionId: null,
            candidateId: null,
            projectRevision: currentProject.revision,
            contentHash: hashOutlineContent(currentProject.outline),
            artifact: currentProject.outline,
          },
          {force: true},
        );
        sendJson(response, 201, {version});
        return;
      }

      if (
        outlineHistoryRoute?.resource === 'candidates' &&
        !outlineHistoryRoute.recordId &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = CreateOutlineCandidateSchema.safeParse(body);
        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Yêu cầu chỉnh mạch giảng chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }
        const currentProject = await repository.getProject(
          outlineHistoryRoute.projectId,
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
        if (!currentProject.outline) {
          throw new RequestBodyError(
            409,
            'OUTLINE_NOT_READY',
            'Project chưa có mạch giảng để chỉnh sửa.',
          );
        }

        const currentContentHash = hashOutlineContent(currentProject.outline);
        const currentContextHash = outlineContextHash(
          currentProject.topicInput,
          outlineContent(currentProject.outline),
          currentProject.outline.sourceInput,
        );
        let baseContent = versionedOutlineContent(currentProject.outline);
        let baseVersion = await outlineHistoryStore.ensureVersion({
          projectId: currentProject.id,
          origin: 'baseline',
          label: 'Trước chỉnh sửa AI',
          parentVersionId: null,
          restoredFromVersionId: null,
          candidateId: null,
          projectRevision: currentProject.revision,
          contentHash: currentContentHash,
          artifact: currentProject.outline,
        });
        let parentCandidate: OutlineCandidateRecord | null = null;
        if (parsedRequest.data.baseCandidateId) {
          parentCandidate = await outlineHistoryStore.getCandidate(
            currentProject.id,
            parsedRequest.data.baseCandidateId,
          );
          if (!parentCandidate) {
            throw new RequestBodyError(
              404,
              'OUTLINE_CANDIDATE_NOT_FOUND',
              'Không tìm thấy đề xuất dùng làm nền chỉnh tiếp.',
            );
          }
          if (parentCandidate.decision !== 'pending') {
            throw new RequestBodyError(
              409,
              'OUTLINE_CANDIDATE_ALREADY_DECIDED',
              'Chỉ có thể chỉnh tiếp một candidate đang chờ review.',
            );
          }
          if (
            !parentCandidate.rootBaseContextHash ||
            parentCandidate.rootBaseContextHash !== currentContextHash
          ) {
            throw new RequestBodyError(
              409,
              'OUTLINE_CONTEXT_CHANGED',
              'Chủ đề hoặc mạch giảng nền đã thay đổi. Hãy tạo đề xuất mới từ phiên bản hiện tại.',
            );
          }
          const storedBaseVersion = await outlineHistoryStore.getVersion(
            currentProject.id,
            parentCandidate.baseVersionId,
          );
          if (!storedBaseVersion) {
            throw new RequestBodyError(
              409,
              'OUTLINE_BASE_VERSION_MISSING',
              'Phiên bản nền của đề xuất không còn khả dụng.',
            );
          }
          baseVersion = storedBaseVersion;
          baseContent = parentCandidate.content;
        }

        const requestFingerprint = hashJson({
          projectId: currentProject.id,
          baseContentHash: hashOutlineContent(baseContent),
          baseContextHash: outlineContextHash(
            currentProject.topicInput,
            baseContent,
            currentProject.outline.sourceInput,
          ),
          request: parsedRequest.data,
        });
        const existingCandidate = await outlineHistoryStore.getCandidate(
          currentProject.id,
          parsedRequest.data.generationId,
        );
        if (existingCandidate) {
          if (existingCandidate.requestFingerprint !== requestFingerprint) {
            throw new RequestBodyError(
              409,
              'GENERATION_ID_REUSED',
              'Generation ID đã được dùng với nội dung khác.',
            );
          }
          sendJson(response, 200, {candidate: existingCandidate});
          return;
        }

        const generation = await generateOnce(
          outlineCandidateGenerations,
          `${currentProject.id}:${parsedRequest.data.generationId}`,
          requestFingerprint,
          () =>
            outlineRevisionService.revise({
              topicInput: currentProject.topicInput,
              baseContent,
              scope: parsedRequest.data.scope,
              guidance: parsedRequest.data.guidance,
              model: parsedRequest.data.model,
              reasoningEffort: parsedRequest.data.reasoningEffort,
            }),
        );
        const coherence = generation.result.coherence;
        const status =
          coherence.verdict === 'needs_scope_expansion' ||
          coherence.issues.some(issue => issue.requiresScopeExpansion)
            ? 'scope_expansion_required'
            : coherence.issues.some(issue => issue.severity === 'error')
              ? 'coherence_blocked'
              : coherence.verdict === 'warning' || coherence.issues.length > 0
                ? 'coherence_warning'
                : 'ready';
        const candidate = await outlineHistoryStore.saveCandidate({
          candidateId: parsedRequest.data.generationId,
          projectId: currentProject.id,
          createdAt: generation.generatedAt,
          status,
          decision: 'pending',
          decidedAt: null,
          appliedVersionId: null,
          baseVersionId: baseVersion.versionId,
          parentCandidateId: parentCandidate?.candidateId ?? null,
          rootBaseContentHash:
            parentCandidate?.rootBaseContentHash ?? currentContentHash,
          baseContentHash: hashOutlineContent(baseContent),
          rootBaseContextHash:
            parentCandidate?.rootBaseContextHash ?? currentContextHash,
          baseContextHash: outlineContextHash(
            currentProject.topicInput,
            baseContent,
            currentProject.outline.sourceInput,
          ),
          baseProjectRevision: currentProject.revision,
          candidateContentHash: hashOutlineContent(generation.result.content),
          requestFingerprint,
          guidance: parsedRequest.data.guidance,
          scope: parsedRequest.data.scope,
          patch: generation.result.patch,
          content: generation.result.content,
          coherence,
          generation: {
            provider: 'codex',
            model: generation.result.model,
            requestedModel: parsedRequest.data.model ?? null,
            reasoningEffort: parsedRequest.data.reasoningEffort ?? null,
            promptVersion: OUTLINE_REVISION_PROMPT_VERSION,
            generatedAt: generation.generatedAt,
            editorUsage: generation.result.editorUsage,
            reviewerUsage: generation.result.reviewerUsage,
          },
        });
        sendJson(response, 201, {candidate});
        return;
      }

      if (
        outlineHistoryRoute?.resource === 'candidates' &&
        outlineHistoryRoute.recordId &&
        outlineHistoryRoute.action === 'reject' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const currentProject = await repository.getProject(
          outlineHistoryRoute.projectId,
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
        const candidate = await outlineHistoryStore.setCandidateDecision(
          currentProject.id,
          outlineHistoryRoute.recordId,
          'rejected',
        );
        sendJson(response, 200, {candidate});
        return;
      }

      if (
        outlineHistoryRoute?.resource === 'candidates' &&
        outlineHistoryRoute.recordId &&
        outlineHistoryRoute.action === 'apply' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const currentProject = await repository.getProject(
          outlineHistoryRoute.projectId,
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
        if (!currentProject.outline) {
          throw new RequestBodyError(
            409,
            'OUTLINE_NOT_READY',
            'Project chưa có mạch giảng để áp dụng đề xuất.',
          );
        }
        const candidate = await outlineHistoryStore.getCandidate(
          currentProject.id,
          outlineHistoryRoute.recordId,
        );
        if (!candidate) {
          throw new RequestBodyError(
            404,
            'OUTLINE_CANDIDATE_NOT_FOUND',
            'Không tìm thấy đề xuất chỉnh sửa.',
          );
        }
        if (candidate.decision === 'rejected') {
          throw new RequestBodyError(
            409,
            'OUTLINE_CANDIDATE_REJECTED',
            'Đề xuất này đã được giữ lại trong lịch sử nhưng không còn chờ áp dụng.',
          );
        }
        const currentContentHash = hashOutlineContent(currentProject.outline);
        if (
          candidate.decision === 'accepted' &&
          currentContentHash === candidate.candidateContentHash
        ) {
          sendJson(response, 200, {project: currentProject});
          return;
        }
        if (candidate.decision === 'accepted') {
          throw new RequestBodyError(
            409,
            'OUTLINE_CANDIDATE_ALREADY_ACCEPTED',
            'Đề xuất này đã được áp dụng trước đó.',
          );
        }
        if (
          candidate.status === 'scope_expansion_required' ||
          candidate.status === 'coherence_blocked'
        ) {
          throw new RequestBodyError(
            409,
            candidate.status === 'scope_expansion_required'
              ? 'OUTLINE_SCOPE_EXPANSION_REQUIRED'
              : 'OUTLINE_COHERENCE_BLOCKED',
            candidate.status === 'scope_expansion_required'
              ? 'Đề xuất cần mở rộng phạm vi và chỉnh tiếp trước khi áp dụng.'
              : 'Đề xuất còn lỗi mạch lạc nghiêm trọng và cần chỉnh tiếp trước khi áp dụng.',
          );
        }
        const currentContextHash = outlineContextHash(
          currentProject.topicInput,
          outlineContent(currentProject.outline),
          currentProject.outline.sourceInput,
        );
        if (
          !candidate.rootBaseContextHash ||
          currentContextHash !== candidate.rootBaseContextHash
        ) {
          throw new RequestBodyError(
            409,
            candidate.rootBaseContextHash
              ? 'OUTLINE_CONTEXT_CHANGED'
              : 'OUTLINE_CANDIDATE_CONTEXT_UPGRADE_REQUIRED',
            candidate.rootBaseContextHash
              ? 'Chủ đề hoặc mạch giảng nền đã thay đổi kể từ lúc tạo đề xuất. Hãy tạo lại từ context hiện tại.'
              : 'Đề xuất cũ thiếu khóa context mới và cần được tạo lại trước khi áp dụng.',
          );
        }

        const outline: TeachingOutline = {
          ...candidate.content,
          status: 'draft',
          contentRevision: currentProject.outline.contentRevision + 1,
          sourceInput: currentProject.outline.sourceInput,
          generation: {
            generationId: candidate.candidateId,
            provider: 'codex',
            model: candidate.generation.model,
            ...(candidate.generation.requestedModel
              ? {requestedModel: candidate.generation.requestedModel}
              : {}),
            ...(candidate.generation.reasoningEffort
              ? {reasoningEffort: candidate.generation.reasoningEffort}
              : {}),
            promptVersion: candidate.generation.promptVersion,
            generatedAt: candidate.generation.generatedAt,
            usage: candidate.generation.editorUsage,
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
        const version = await outlineHistoryStore
          .ensureVersion(
            {
              projectId: updatedProject.id,
              origin: 'ai_candidate',
              label: candidate.patch.editSummary,
              parentVersionId: candidate.baseVersionId,
              restoredFromVersionId: null,
              candidateId: candidate.candidateId,
              projectRevision: updatedProject.revision,
              contentHash: hashOutlineContent(outline),
              artifact: outline,
            },
            {force: true},
          )
          .catch(error => {
            logger.error(error);
            return null;
          });
        await outlineHistoryStore
          .setCandidateDecision(
            updatedProject.id,
            candidate.candidateId,
            'accepted',
            version?.versionId ?? null,
          )
          .catch(error => logger.error(error));
        sendJson(
          response,
          200,
          {project: updatedProject, version},
          {ETag: `"${updatedProject.revision}"`},
        );
        return;
      }

      if (
        outlineHistoryRoute?.resource === 'versions' &&
        outlineHistoryRoute.recordId &&
        outlineHistoryRoute.action === 'restore' &&
        request.method === 'POST'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const currentProject = await repository.getProject(
          outlineHistoryRoute.projectId,
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
        if (!currentProject.outline) {
          throw new RequestBodyError(
            409,
            'OUTLINE_NOT_READY',
            'Project chưa có mạch giảng để khôi phục.',
          );
        }
        const sourceVersion = await outlineHistoryStore.getVersion(
          currentProject.id,
          outlineHistoryRoute.recordId,
        );
        if (!sourceVersion) {
          throw new RequestBodyError(
            404,
            'OUTLINE_VERSION_NOT_FOUND',
            'Không tìm thấy phiên bản cần khôi phục.',
          );
        }
        const currentVersion = await outlineHistoryStore.ensureVersion({
          projectId: currentProject.id,
          origin: 'baseline',
          label: 'Trước khi khôi phục',
          parentVersionId: null,
          restoredFromVersionId: null,
          candidateId: null,
          projectRevision: currentProject.revision,
          contentHash: hashOutlineContent(currentProject.outline),
          artifact: currentProject.outline,
        });
        const outline: TeachingOutline = {
          ...sourceVersion.artifact,
          status: 'draft',
          contentRevision: currentProject.outline.contentRevision + 1,
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
        const version = await outlineHistoryStore
          .ensureVersion(
            {
              projectId: updatedProject.id,
              origin: 'restore',
              label: `Khôi phục từ ${sourceVersion.label ?? 'phiên bản cũ'}`,
              parentVersionId: currentVersion.versionId,
              restoredFromVersionId: sourceVersion.versionId,
              candidateId: null,
              projectRevision: updatedProject.revision,
              contentHash: hashOutlineContent(outline),
              artifact: outline,
            },
            {force: true},
          )
          .catch(error => {
            logger.error(error);
            return null;
          });
        sendJson(
          response,
          200,
          {project: updatedProject, version},
          {ETag: `"${updatedProject.revision}"`},
        );
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
          assertSameCodexGenerationSelection(
            currentProject.outline.generation,
            parsedRequest.data,
          );
          sendProject(response, 200, currentProject);
          return;
        }

        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }

        if (currentProject.outline) {
          throw new RequestBodyError(
            409,
            'OUTLINE_CANDIDATE_REQUIRED',
            'Mạch giảng đã tồn tại. Hãy tạo candidate để so sánh thay vì ghi đè trực tiếp.',
          );
        }

        const generationKey = `${currentProject.id}:${parsedRequest.data.generationId}`;
        const fingerprint = JSON.stringify({
          topicInput: currentProject.topicInput,
          model: parsedRequest.data.model,
          reasoningEffort: parsedRequest.data.reasoningEffort,
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
              model: parsedRequest.data.model,
              reasoningEffort: parsedRequest.data.reasoningEffort,
              guidance: parsedRequest.data.guidance,
              currentOutline: currentProject.outline ?? undefined,
            }),
        );
        const outline: TeachingOutline = {
          ...generation.result.content,
          status: 'draft',
          contentRevision: 1,
          sourceInput: currentProject.topicInput,
          generation: {
            generationId: parsedRequest.data.generationId,
            provider: 'codex',
            model: generation.result.model,
            requestedModel: parsedRequest.data.model,
            reasoningEffort: parsedRequest.data.reasoningEffort,
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

        await outlineHistoryStore
          .ensureVersion(
            {
              projectId: updatedProject.id,
              origin: 'approval',
              label: 'Đã chốt mạch giảng',
              parentVersionId: null,
              restoredFromVersionId: null,
              candidateId: null,
              projectRevision: updatedProject.revision,
              contentHash: hashOutlineContent(outline),
              artifact: outline,
            },
            {force: true},
          )
          .catch(error => logger.error(error));

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

      const voiceVisualHistoryRoute = getProjectVoiceVisualHistoryRoute(
        requestUrl.pathname,
      );
      if (
        voiceVisualHistoryRoute &&
        (await handleVoiceVisualHistoryRoute(
          voiceVisualHistoryRoute,
          request,
          response,
          requestUrl,
        ))
      ) {
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
          assertSameCodexGenerationSelection(
            currentProject.voiceVisualPlan.generation,
            parsedRequest.data,
          );
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
        if (currentPlanUsable) {
          throw new RequestBodyError(
            409,
            'VOICE_VISUAL_CANDIDATE_REQUIRED',
            'Kế hoạch voice–visual đã tồn tại. Hãy tạo candidate có phạm vi để so sánh thay vì ghi đè trực tiếp.',
          );
        }
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
          model: parsedRequest.data.model,
          reasoningEffort: parsedRequest.data.reasoningEffort,
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
              model: parsedRequest.data.model,
              reasoningEffort: parsedRequest.data.reasoningEffort,
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
            requestedModel: parsedRequest.data.model,
            reasoningEffort: parsedRequest.data.reasoningEffort,
            promptVersion: VOICE_VISUAL_PROMPT_VERSION,
            generatedAt: generation.generatedAt,
            usage: generation.result.usage,
          },
        };
        if (currentProject.voiceVisualPlan) {
          await voiceVisualHistoryStore
            .ensureVersion({
              projectId: currentProject.id,
              origin: 'baseline',
              label: 'Trước khi tạo lại theo mạch giảng mới',
              parentVersionId: null,
              restoredFromVersionId: null,
              candidateId: null,
              projectRevision: currentProject.revision,
              contentHash: hashVoiceVisualContent(
                currentProject.voiceVisualPlan,
              ),
              artifact: currentProject.voiceVisualPlan,
            })
            .catch(error => logger.error(error));
        }
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

        await voiceVisualHistoryStore
          .ensureVersion({
            projectId: updatedProject.id,
            origin: 'baseline',
            label: 'Bản voice–visual vừa tạo',
            parentVersionId: null,
            restoredFromVersionId: null,
            candidateId: null,
            projectRevision: updatedProject.revision,
            contentHash: hashVoiceVisualContent(voiceVisualPlan),
            artifact: voiceVisualPlan,
          })
          .catch(error => logger.error(error));

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

        await voiceVisualHistoryStore
          .ensureVersion(
            {
              projectId: updatedProject.id,
              origin: 'approval',
              label: 'Đã chốt voice–visual',
              parentVersionId: null,
              restoredFromVersionId: null,
              candidateId: null,
              projectRevision: updatedProject.revision,
              contentHash: hashVoiceVisualContent(approvedPlan),
              artifact: approvedPlan,
            },
            {force: true},
          )
          .catch(error => logger.error(error));

        sendProject(response, 200, updatedProject);
        return;
      }

      const motionCanvasHistoryRoute = getProjectMotionCanvasHistoryRoute(
        requestUrl.pathname,
      );
      if (
        motionCanvasHistoryRoute &&
        (await handleMotionCanvasHistoryRoute(
          motionCanvasHistoryRoute,
          request,
          response,
          requestUrl,
        ))
      ) {
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
          assertSameCodexGenerationSelection(
            currentProject.motionCanvasBundle.generation,
            parsedRequest.data,
          );
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
        if (currentBundleUsable) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_CANDIDATE_REQUIRED',
            'Workspace scene đã tồn tại. Hãy chọn scene và tạo candidate để so sánh thay vì ghi đè trực tiếp.',
          );
        }
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
          model: parsedRequest.data.model,
          reasoningEffort: parsedRequest.data.reasoningEffort,
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
              model: parsedRequest.data.model,
              reasoningEffort: parsedRequest.data.reasoningEffort,
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
            let fallbackAttempted = false;
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
                  repairAttempts < 1
                ) {
                  repairAttempts += 1;
                  try {
                    generated = await motionCanvasGenerator.repair(
                      generationRequest,
                      generated,
                      error.details,
                    );
                  } catch (repairError) {
                    if (
                      !motionCanvasGenerator.recover ||
                      fallbackAttempted
                    ) {
                      throw repairError;
                    }
                    fallbackAttempted = true;
                    generated = motionCanvasGenerator.recover(
                      generationRequest,
                      generated,
                      `${error.details}\n\nRepair failed: ${
                        repairError instanceof Error
                          ? repairError.message
                          : String(repairError)
                      }`,
                    );
                  }
                  continue;
                }
                if (
                  error instanceof MotionCanvasWorkspaceError &&
                  error.code === 'MOTION_CANVAS_VALIDATION_FAILED' &&
                  error.details &&
                  motionCanvasGenerator.recover &&
                  !fallbackAttempted
                ) {
                  fallbackAttempted = true;
                  generated = motionCanvasGenerator.recover(
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
            requestedModel: parsedRequest.data.model,
            reasoningEffort: parsedRequest.data.reasoningEffort,
            promptVersion: MOTION_CANVAS_PROMPT_VERSION,
            generatedAt: generation.generatedAt,
            usage: generation.result.generated.usage,
          },
        };
        if (currentProject.motionCanvasBundle) {
          await motionCanvasHistoryStore
            .ensureVersion({
              projectId: currentProject.id,
              origin: 'baseline',
              label: 'Trước khi sinh lại theo voice–visual mới',
              parentVersionId: null,
              restoredFromVersionId: null,
              candidateId: null,
              projectRevision: currentProject.revision,
              contentHash: hashMotionCanvasBundle(
                currentProject.motionCanvasBundle,
              ),
              artifact: currentProject.motionCanvasBundle,
            })
            .catch(error => logger.error(error));
        }
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

        await motionCanvasHistoryStore
          .ensureVersion({
            projectId: updatedProject.id,
            origin: 'baseline',
            label: 'Workspace scene vừa sinh',
            parentVersionId: null,
            restoredFromVersionId: null,
            candidateId: null,
            projectRevision: updatedProject.revision,
            contentHash: hashMotionCanvasBundle(motionCanvasBundle),
            artifact: motionCanvasBundle,
          })
          .catch(error => logger.error(error));

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
        motionCanvasRoute?.action === 'preview' &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(
          motionCanvasRoute.projectId,
        );
        const motion = currentProject?.motionCanvasBundle;
        if (!currentProject || !motion) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_NOT_READY',
            'Project chưa có scene Motion Canvas để xem trước.',
          );
        }
        const requestedGeneration = requestUrl.searchParams.get('generation');
        if (
          requestedGeneration &&
          requestedGeneration !== motion.generation.generationId
        ) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_PREVIEW_OUTDATED',
            'Scene Motion Canvas đã có generation mới hơn.',
          );
        }
        const currentDesign =
          currentProject.visualDesignBundle &&
          visualDesignMatchesMotion(currentProject.visualDesignBundle, motion)
            ? currentProject.visualDesignBundle
            : null;
        const preview = await layoutPreviewService.startMotion(
          currentProject.id,
          motion,
          {
            parentOrigin: requestParentOrigin(request),
            initialOverrides: currentDesign?.overrides ?? [],
          },
        );
        sendJson(response, 200, {
          preview: {
            ...preview,
            sourceMotionCanvasGenerationId: preview.sourceSyncGenerationId,
          },
        });
        return;
      }

      if (
        motionCanvasRoute?.action === 'design' &&
        request.method === 'PUT'
      ) {
        const expectedRevision = readExpectedRevision(request);
        const body = await readJsonBody(request);
        const parsedRequest = CommitVisualDesignSchema.safeParse(body);
        if (!parsedRequest.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Chỉnh sửa visual scene chưa hợp lệ.',
            fields: validationFields(parsedRequest.error.issues),
          });
          return;
        }
        const currentProject = await repository.getProject(
          motionCanvasRoute.projectId,
        );
        const motion = currentProject?.motionCanvasBundle;
        if (!currentProject || !motion) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_NOT_READY',
            'Project chưa có scene Motion Canvas để chỉnh sửa.',
          );
        }
        if (currentProject.revision !== expectedRevision) {
          throw new ProjectConflictError(currentProject);
        }
        if (
          motion.generation.generationId !==
            parsedRequest.data.sourceMotionCanvasGenerationId
        ) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_PREVIEW_OUTDATED',
            'Scene Motion Canvas đã thay đổi. Hãy tải lại editor.',
          );
        }
        const manifest = layoutPreviewService.getManifest(
          currentProject.id,
          parsedRequest.data.sessionNonce,
          motion.generation.generationId,
        );
        const documents = validateLayoutDocuments(
          {
            contentRevision: motion.contentRevision,
            generation: {generationId: motion.generation.generationId},
            validation: {sourceHash: motion.validation.sourceHash},
            sections: motion.scenes.map((scene) => ({
              sceneId: scene.id,
              filePath: scene.filePath,
              durationSeconds: scene.durationSeconds,
            })),
          },
          parsedRequest.data.overrides,
          manifest,
        );
        const previousDesign = currentProject.visualDesignBundle;
        const sameSource = Boolean(
          previousDesign && visualDesignMatchesMotion(previousDesign, motion),
        );
        const visualDesignBundle = {
          contentRevision: sameSource
            ? previousDesign!.contentRevision + 1
            : 1,
          sourceMotionCanvasGenerationId: motion.generation.generationId,
          sourceMotionCanvasContentRevision: motion.contentRevision,
          sourceMotionCanvasSourceHash: motion.validation.sourceHash,
          overrides: documents.overridesDocument.overrides,
          updatedAt: new Date().toISOString(),
        };
        const updatedProject = await repository.updateProject(
          currentProject.id,
          {visualDesignBundle},
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

        await motionCanvasHistoryStore
          .ensureVersion(
            {
              projectId: updatedProject.id,
              origin: 'approval',
              label: 'Đã chốt Motion Canvas',
              parentVersionId: null,
              restoredFromVersionId: null,
              candidateId: null,
              projectRevision: updatedProject.revision,
              contentHash: hashMotionCanvasBundle(approvedBundle),
              artifact: approvedBundle,
            },
            {force: true},
          )
          .catch(error => logger.error(error));

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
                (error) =>
                  error instanceof ElevenLabsVoiceError &&
                  error.code === 'ELEVENLABS_TTS_RESULT_UNKNOWN',
                pipelineSafetyLimits.maximumVoiceChunks * 2,
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
            const chunkKeyPrefix = `${generationKey}:chunk:`;
            for (const key of voiceSectionGenerations.keys()) {
              if (key.startsWith(chunkKeyPrefix)) {
                voiceSectionGenerations.delete(key);
              }
            }
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
        const visualDesign =
          currentProject.visualDesignBundle &&
          visualDesignMatchesMotion(
            currentProject.visualDesignBundle,
            motion,
          )
            ? currentProject.visualDesignBundle
            : null;
        const fingerprint = JSON.stringify({
          motionContentRevision: motion.contentRevision,
          motionSourceHash: motion.validation.sourceHash,
          voiceContentRevision: voice.contentRevision,
          voiceGenerationId: voice.generation.generationId,
          voiceSections: voice.sections,
          visualDesignContentRevision: visualDesign?.contentRevision ?? null,
          visualDesignOverrides: visualDesign?.overrides ?? [],
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
          sourceVisualDesignContentRevision:
            visualDesign?.contentRevision ?? null,
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
        const previewMotion = currentProject.motionCanvasBundle;
        const previewVoice = currentProject.voiceBundle;
        if (
          !previewMotion ||
          !previewVoice ||
          !animationSyncMatchesSources(
            bundle,
            previewMotion,
            previewVoice,
            currentProject.visualDesignBundle,
          )
        ) {
          throw new RequestBodyError(
            409,
            'ANIMATION_SYNC_OUTDATED',
            'Scene, visual design hoặc voice đã thay đổi. Hãy đồng bộ lại trước khi mở preview.',
          );
        }
        const syncVisualDesign = currentProject.visualDesignBundle;
        const preview = await animationSyncPreviewService.start(
          currentProject.id,
          bundle,
          syncVisualDesign &&
          syncVisualDesign.contentRevision ===
            bundle.sourceVisualDesignContentRevision
            ? syncVisualDesign.overrides
            : [],
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
          !animationSyncMatchesSources(
            bundle,
            motion,
            voice,
            currentProject.visualDesignBundle,
          )
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
                overrides:
                  currentProject.motionCanvasBundle &&
                  currentProject.visualDesignBundle &&
                  visualDesignMatchesMotion(
                    currentProject.visualDesignBundle,
                    currentProject.motionCanvasBundle,
                  )
                    ? currentProject.visualDesignBundle.overrides
                    : [],
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
          {
            parentOrigin: requestParentOrigin(request),
            initialOverrides:
              !currentLayout &&
              currentProject.motionCanvasBundle &&
              currentProject.visualDesignBundle &&
              visualDesignMatchesMotion(
                currentProject.visualDesignBundle,
                currentProject.motionCanvasBundle,
              )
                ? currentProject.visualDesignBundle.overrides
                : [],
          },
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
            !sameValue(stored.overrides, normalizedOverrides) ||
            !sameValue(
              currentLayout.renderSettings,
              requestData.renderSettings,
            )
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
          renderSettings: requestData.renderSettings,
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
          renderSettings: requestData.renderSettings,
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
        renderRoute?.action === 'watermark' &&
        request.method === 'GET'
      ) {
        const currentProject = await repository.getProject(renderRoute.projectId);
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const assetId = requestUrl.searchParams.get('asset') ?? '';
        const asset = await watermarkAssetStore.read(
          currentProject.id,
          assetId,
        );
        sendMediaBuffer(
          request,
          response,
          asset.value,
          asset.summary.contentType,
          {
            'Cache-Control': 'private, max-age=31536000, immutable',
            ETag: `"${asset.summary.assetId}"`,
          },
        );
        return;
      }

      if (
        renderRoute?.action === 'watermark' &&
        request.method === 'POST'
      ) {
        const currentProject = await repository.getProject(renderRoute.projectId);
        if (!currentProject) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }
        const value = await readBinaryBody(request, MAX_WATERMARK_IMAGE_SIZE);
        const asset = await watermarkAssetStore.save(currentProject.id, value);
        response.setHeader('Cache-Control', 'no-store');
        sendJson(response, 201, {asset});
        return;
      }

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
          const existingStatus =
            (await finalRenderService.getStatus(
              currentProject.id,
              generationId,
            )) ?? {
              generationId,
              state: 'completed' as const,
              progress: 1,
              renderedFrames:
                existingRender.validation.renderedFrameCount,
              totalFrames: existingRender.validation.renderedFrameCount,
              startedAt: existingRender.generation.generatedAt,
              updatedAt: existingRender.generation.generatedAt,
              message: 'Video cuối đã sẵn sàng.',
              errorCode: null,
              diagnostic: null,
            };
          sendJson(response, 200, {status: existingStatus});
          return;
        }
        if (existingRender?.generation.generationId === generationId) {
          throw new RequestBodyError(
            409,
            'GENERATION_ID_REUSED',
            'Render generation ID đã thuộc về một Layout cũ. Hãy tạo generation mới từ Layout hiện hành.',
          );
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
        const renderOperation = finalRenderService.render(
          currentProject.id,
          generationId,
          (existingRender?.contentRevision ?? 0) + 1,
          sync,
          layout,
        );
        const commitOperation = renderOperation
          .then(async renderBundle => {
            const committed = await commitFinalRenderBundle(
              currentProject.id,
              generationId,
              renderBundle,
            );
            if (!committed) {
              logger.error(
                new FinalRenderError(
                  'FINAL_RENDER_SOURCE_CHANGED',
                  'Video đã dựng xong nhưng Layout hiện hành đã thay đổi; artifact được giữ riêng và không ghi đè project.',
                ),
              );
            }
          })
          .catch(error => {
            if (!(error instanceof FinalRenderError)) logger.error(error);
          });
        trackFinalRenderCommit(commitOperation);
        const status = await finalRenderService.getStatus(
          currentProject.id,
          generationId,
        );
        if (!status) {
          throw new FinalRenderError(
            'FINAL_RENDER_START_FAILED',
            'Không thể ghi nhận job render vừa tạo.',
          );
        }
        sendJson(response, 202, {status});
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
        const status = await finalRenderService.getStatus(
          currentProject.id,
          generationId,
        );
        if (
          status?.state === 'completed' &&
          currentProject.renderBundle?.generation.generationId !==
            status.generationId
        ) {
          const completedBundle = await finalRenderService.getCompletedBundle(
            currentProject.id,
            status.generationId,
          );
          if (completedBundle) {
            await commitFinalRenderBundle(
              currentProject.id,
              status.generationId,
              completedBundle,
            );
          }
        }
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

      if (error instanceof TopicGuidanceGenerationError) {
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

      if (error instanceof OutlineRevisionError) {
        const conflictCodes = new Set([
          'OUTLINE_SCOPE_STALE',
          'OUTLINE_BASE_CHANGED',
        ]);
        const validationCodes = new Set([
          'OUTLINE_PATCH_OUT_OF_SCOPE',
          'OUTLINE_PATCH_INVALID',
          'OUTLINE_PATCH_EMPTY',
          'CODEX_OUTLINE_REVISION_INVALID_RESPONSE',
          'CODEX_OUTLINE_COHERENCE_INVALID_RESPONSE',
        ]);
        sendApiError(
          response,
          conflictCodes.has(error.code)
            ? 409
            : validationCodes.has(error.code)
              ? 422
              : 503,
          {code: error.code, message: error.message},
        );
        return;
      }

      if (error instanceof OutlineHistoryStoreError) {
        const conflictCodes = new Set([
          'OUTLINE_CANDIDATE_ID_REUSED',
          'OUTLINE_CANDIDATE_ALREADY_DECIDED',
          'OUTLINE_HISTORY_IMMUTABLE_CONFLICT',
        ]);
        sendApiError(
          response,
          error.code === 'OUTLINE_CANDIDATE_NOT_FOUND'
            ? 404
            : conflictCodes.has(error.code)
              ? 409
              : 422,
          {code: error.code, message: error.message},
        );
        return;
      }

      if (error instanceof VoiceVisualGenerationError) {
        sendApiError(response, 503, {
          code: error.code,
          message: error.message,
        });
        return;
      }

      if (error instanceof VoiceVisualRevisionError) {
        const conflictCodes = new Set([
          'VOICE_VISUAL_SCOPE_STALE',
          'VOICE_VISUAL_BASE_CHANGED',
        ]);
        const validationCodes = new Set([
          'VOICE_VISUAL_PATCH_OUT_OF_SCOPE',
          'VOICE_VISUAL_PATCH_INVALID',
          'VOICE_VISUAL_PATCH_EMPTY',
          'CODEX_VOICE_VISUAL_REVISION_INVALID_RESPONSE',
          'CODEX_VOICE_VISUAL_COHERENCE_INVALID_RESPONSE',
        ]);
        sendApiError(
          response,
          conflictCodes.has(error.code)
            ? 409
            : validationCodes.has(error.code)
              ? 422
              : 503,
          {code: error.code, message: error.message},
        );
        return;
      }

      if (error instanceof VoiceVisualHistoryStoreError) {
        const conflictCodes = new Set([
          'VOICE_VISUAL_CANDIDATE_ID_REUSED',
          'VOICE_VISUAL_CANDIDATE_ALREADY_DECIDED',
          'VOICE_VISUAL_HISTORY_IMMUTABLE_CONFLICT',
        ]);
        sendApiError(
          response,
          error.code === 'VOICE_VISUAL_CANDIDATE_NOT_FOUND'
            ? 404
            : conflictCodes.has(error.code)
              ? 409
              : 422,
          {code: error.code, message: error.message},
        );
        return;
      }

      if (error instanceof MotionCanvasGenerationError) {
        sendApiError(response, 503, {
          code: error.code,
          message: error.message,
        });
        return;
      }

      if (error instanceof MotionCanvasRevisionReviewError) {
        sendApiError(
          response,
          error.code === 'CODEX_MOTION_CANVAS_COHERENCE_INVALID_RESPONSE'
            ? 422
            : 503,
          {code: error.code, message: error.message},
        );
        return;
      }

      if (error instanceof MotionCanvasHistoryStoreError) {
        const conflictCodes = new Set([
          'MOTION_CANVAS_CANDIDATE_ID_REUSED',
          'MOTION_CANVAS_CANDIDATE_ALREADY_DECIDED',
          'MOTION_CANVAS_HISTORY_IMMUTABLE_CONFLICT',
        ]);
        sendApiError(
          response,
          error.code === 'MOTION_CANVAS_CANDIDATE_NOT_FOUND'
            ? 404
            : conflictCodes.has(error.code)
              ? 409
              : 422,
          {code: error.code, message: error.message},
        );
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

      if (error instanceof WatermarkAssetError) {
        sendApiError(
          response,
          error.code === 'WATERMARK_ASSET_NOT_FOUND' ? 404 : 422,
          {code: error.code, message: error.message},
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
      Promise.resolve().then(async () => {
        await finalRenderService.close();
        await Promise.allSettled([...finalRenderCommits]);
      }),
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
