import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CreateTopicProjectSchema,
  GenerateMotionCanvasSchema,
  GenerateTeachingOutlineSchema,
  GenerateVoiceVisualPlanSchema,
  TeachingOutlineContentSchema,
  UpdateProjectSchema,
  VoiceVisualPlanContentSchema,
  type ApiErrorPayload,
  type MotionCanvasBundle,
  type TeachingOutline,
  type TopicProject,
  type VoiceVisualPlan,
} from '../shared/topic.ts';
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
  createFileProjectRepository,
  ProjectConflictError,
  ProjectDataError,
  type ProjectRepository,
} from './projectRepository.ts';
import {
  createCodexVoiceVisualGenerator,
  VoiceVisualGenerationError,
  VOICE_VISUAL_PROMPT_VERSION,
  type VoiceVisualGenerationResult,
  type VoiceVisualGenerator,
} from './voiceVisualGenerator.ts';

const MAX_BODY_SIZE = 64 * 1024;

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
  outlineGenerator?: OutlineGenerator;
  voiceVisualGenerator?: VoiceVisualGenerator;
  motionCanvasGenerator?: MotionCanvasGenerator;
  motionCanvasWorkspace?: MotionCanvasWorkspace;
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

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;

    if (receivedBytes > MAX_BODY_SIZE) {
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

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
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
    sections: plan.sections,
  };
}

function voiceVisualMatchesOutline(
  plan: {sections: Array<{outlineSectionId: string}>},
  outline: TeachingOutline,
) {
  return (
    plan.sections.length === outline.sections.length &&
    plan.sections.every(
      (section, index) =>
        section.outlineSectionId === outline.sections[index]?.id,
    )
  );
}

function motionCanvasMatchesOutline(
  bundle: MotionCanvasBundle,
  outline: TeachingOutline,
) {
  return (
    bundle.scenes.length === outline.sections.length &&
    bundle.scenes.every(
      (scene, index) =>
        scene.outlineSectionId === outline.sections[index]?.id,
    )
  );
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
          'Yêu cầu tạo mạch giảng này đã được dùng với nội dung khác.',
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
        const fingerprint = JSON.stringify({
          topicInput: currentProject.topicInput,
          outline: outlineContent(outline),
          outlineContentRevision: outline.contentRevision,
          guidance: parsedRequest.data.guidance,
          currentPlan: currentPlan
            ? voiceVisualContent(currentPlan)
            : undefined,
        });
        const generation = await generateOnce(
          voiceVisualGenerations,
          generationKey,
          fingerprint,
          () =>
            voiceVisualGenerator.generate({
              topicInput: currentProject.topicInput,
              outline,
              guidance: parsedRequest.data.guidance,
              currentPlan,
            }),
        );
        const voiceVisualPlan: VoiceVisualPlan = {
          ...generation.result.content,
          status: 'draft',
          contentRevision:
            (currentProject.voiceVisualPlan?.contentRevision ?? 0) + 1,
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
        if (!voiceVisualMatchesOutline(parsedContent.data, outline)) {
          throw new RequestBodyError(
            422,
            'VOICE_VISUAL_OUTLINE_MISMATCH',
            'Kế hoạch voice–visual không bao phủ đúng mạch giảng hiện tại.',
          );
        }

        const unchanged = sameValue(
          voiceVisualContent(currentProject.voiceVisualPlan),
          parsedContent.data,
        );
        const voiceVisualPlan: VoiceVisualPlan = unchanged
          ? currentProject.voiceVisualPlan
          : {
              ...parsedContent.data,
              status: 'draft',
              contentRevision:
                currentProject.voiceVisualPlan.contentRevision + 1,
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
            currentStep: 'motionCanvas',
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

      logger.error(error);
      sendApiError(response, 500, {
        code: 'INTERNAL_ERROR',
        message: 'Không thể lưu dự án lúc này. Hãy thử lại.',
      });
    }
  });

  server.on('close', () => {
    codexConnection.close();
    if (options.codexConnection && sharedCodexClient) {
      sharedCodexClient.close();
    }
  });
  return server;
}
