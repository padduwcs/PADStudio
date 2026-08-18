import {createReadStream} from 'node:fs';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import type {TopicProject} from '../shared/topic.ts';
import {RequestBodyError} from './appErrors.ts';

const MAX_JSON_BODY_SIZE = pipelineSafetyLimits.maximumJsonBodyBytes;
interface ByteRange {start: number; end: number;}

export function sendJson(
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

export function sendProject(
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

export function parseByteRange(
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

export function sendMediaBuffer(
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

export function sendMediaFile(
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

export async function readJsonBody(request: IncomingMessage) {
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

export async function readBinaryBody(request: IncomingMessage, maximumBytes: number) {
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

export function readExpectedRevision(request: IncomingMessage) {
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

export function requestParentOrigin(request: IncomingMessage) {
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

export function validationFields(
  issues: Array<{path: PropertyKey[]; message: string;}>,
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


