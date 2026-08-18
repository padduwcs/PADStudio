import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import path from 'node:path';
import {sendApiError} from './appErrors.ts';

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

export async function serveFrontend(
  request: IncomingMessage,
  response: ServerResponse,
  frontendDirectory: string,
) {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  let requestedPath: string;
  try {
    requestedPath = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendApiError(response, 404, {
      code: 'NOT_FOUND',
      message: 'Không tìm thấy tài nguyên.',
    });
    return;
  }
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
    // A SPA route has no extension.  Returning index.html for a missing
    // hashed JS/CSS asset produces a misleading 200 response and leaves the
    // browser with an opaque module MIME error after a deployment.
    if (path.extname(relativePath)) {
      sendApiError(response, 404, {
        code: 'NOT_FOUND',
        message: 'Không tìm thấy tài nguyên.',
      });
      return;
    }
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

    const stream = createReadStream(filePath);
    stream.on('error', error => response.destroy(error));
    stream.pipe(response);
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


