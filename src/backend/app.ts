import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  TopicInputSchema,
  UpdateTopicProjectSchema,
  type ApiErrorPayload,
} from '../shared/topic.ts';
import {
  createFileProjectRepository,
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
  logger?: Pick<Console, 'error' | 'info'>;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
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

function validationFields(
  issues: Array<{path: PropertyKey[]; message: string}>,
) {
  const fields: Record<string, string[]> = {};

  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'form');
    fields[field] ??= [];
    fields[field].push(issue.message);
  }

  return fields;
}

function getProjectId(pathname: string) {
  const match = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  if (!match?.[1]) return null;

  try {
    const projectId = decodeURIComponent(match[1]);
    return /^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId) ? projectId : null;
  } catch {
    return null;
  }
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
  const logger = options.logger ?? console;

  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');

      if (requestUrl.pathname === '/api/health' && request.method === 'GET') {
        sendJson(response, 200, {status: 'ok'});
        return;
      }

      if (requestUrl.pathname === '/api/projects' && request.method === 'GET') {
        const projects = await repository.listProjects();
        sendJson(response, 200, {projects});
        return;
      }

      if (requestUrl.pathname === '/api/projects' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const parsedInput = TopicInputSchema.safeParse(body);

        if (!parsedInput.success) {
          sendApiError(response, 422, {
            code: 'VALIDATION_ERROR',
            message: 'Một vài thông tin cần được kiểm tra lại.',
            fields: validationFields(parsedInput.error.issues),
          });
          return;
        }

        const project = await repository.createTopicProject(parsedInput.data);
        sendJson(response, 201, {project});
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

        sendJson(response, 200, {project});
        return;
      }

      if (projectId && request.method === 'PUT') {
        const body = await readJsonBody(request);
        const parsedUpdate = UpdateTopicProjectSchema.safeParse(body);

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
        );

        if (!project) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

        sendJson(response, 200, {project});
        return;
      }

      if (projectId && request.method === 'DELETE') {
        const deleted = await repository.deleteProject(projectId);

        if (!deleted) {
          sendApiError(response, 404, {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy project.',
          });
          return;
        }

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

      logger.error(error);
      sendApiError(response, 500, {
        code: 'INTERNAL_ERROR',
        message: 'Không thể lưu dự án lúc này. Hãy thử lại.',
      });
    }
  });
}
