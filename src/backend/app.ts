import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CreateTopicProjectSchema,
  GenerateTeachingOutlineSchema,
  TeachingOutlineContentSchema,
  UpdateProjectSchema,
  type ApiErrorPayload,
  type TeachingOutline,
  type TopicProject,
} from '../shared/topic.ts';
import {
  CodexConnectionError,
  createCodexConnectionService,
  StdioCodexAppServerClient,
  type CodexAppServerClient,
  type CodexConnectionService,
} from './codexConnection.ts';
import {
  createCodexOutlineGenerator,
  OutlineGenerationError,
  OUTLINE_PROMPT_VERSION,
  type OutlineGenerationResult,
  type OutlineGenerator,
} from './outlineGenerator.ts';
import {
  createFileProjectRepository,
  ProjectConflictError,
  ProjectDataError,
  type ProjectRepository,
} from './projectRepository.ts';

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
  outlineGenerator?: OutlineGenerator;
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
    !options.codexConnection || !options.outlineGenerator
      ? new StdioCodexAppServerClient()
      : null;
  const codexConnection =
    options.codexConnection ??
    createCodexConnectionService(sharedCodexClient!);
  const outlineGenerator =
    options.outlineGenerator ??
    createCodexOutlineGenerator(sharedCodexClient!);
  const logger = options.logger ?? console;
  const outlineGenerations = new Map<
    string,
    {
      fingerprint: string;
      promise: Promise<{
        result: OutlineGenerationResult;
        generatedAt: string;
      }>;
    }
  >();

  function generateOutlineOnce(
    key: string,
    fingerprint: string,
    operation: () => Promise<OutlineGenerationResult>,
  ) {
    const existing = outlineGenerations.get(key);
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
    outlineGenerations.set(key, {fingerprint, promise});
    void promise.catch(() => {
      if (outlineGenerations.get(key)?.promise === promise) {
        outlineGenerations.delete(key);
      }
    });

    if (outlineGenerations.size > 50) {
      const oldestKey = outlineGenerations.keys().next().value;
      if (oldestKey) outlineGenerations.delete(oldestKey);
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
        const generation = await generateOutlineOnce(
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
