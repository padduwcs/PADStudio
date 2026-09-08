import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProjectInputNotFoundError,
  ProjectNotFoundError,
  ProjectReader,
  ProjectResultFileNotFoundError
} from "./project-reader.js";
import { ProjectPathError } from "../project/project-paths.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const applicationRoot = join(currentDirectory, "..", "..");
const uiDirectory = join(applicationRoot, "ui");
const projectRoot = join(applicationRoot, ".padstudio", "projects");

const staticFiles = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/production-view.js": { file: "production-view.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" }
};

const previewContentTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".flac": "audio/flac"
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function contentType(filePath) {
  return previewContentTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function sendMediaFile(request, response, input) {
  if (input.size === 0) {
    response.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Disposition": "inline",
      "Content-Length": 0,
      "Content-Type": contentType(input.filePath)
    });
    return response.end();
  }

  const range = request.headers.range;
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": contentType(input.filePath),
    "Content-Disposition": "inline"
  };

  let start = 0;
  let end = input.size - 1;
  let status = 200;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${input.size}` });
      return response.end();
    }

    const [, requestedStart, requestedEnd] = match;
    if (!requestedStart) {
      const suffixLength = Number(requestedEnd);
      if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
        response.writeHead(416, { "Content-Range": `bytes */${input.size}` });
        return response.end();
      }
      start = Math.max(input.size - suffixLength, 0);
      end = input.size - 1;
    } else {
      start = Number(requestedStart);
      end = requestedEnd ? Math.min(Number(requestedEnd), input.size - 1) : input.size - 1;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= input.size) {
      response.writeHead(416, { "Content-Range": `bytes */${input.size}` });
      return response.end();
    }

    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${input.size}`;
  }

  headers["Content-Length"] = end - start + 1;
  response.writeHead(status, headers);
  const stream = createReadStream(input.filePath, { start, end });
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

export function createPadStudioServer({ reader }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/projects") {
        return sendJson(response, 200, { projects: await reader.list() });
      }

      const projectMatch = /^\/api\/projects\/(.+)$/.exec(url.pathname);
      if (request.method === "GET" && projectMatch) {
        const projectId = decodeURIComponent(projectMatch[1]);
        return sendJson(response, 200, { context: await reader.readProject(projectId) });
      }

      const inputMatch = /^\/project-inputs\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (request.method === "GET" && inputMatch) {
        const projectId = decodeURIComponent(inputMatch[1]);
        const inputPath = decodeURIComponent(inputMatch[2]);
        return sendMediaFile(request, response, await reader.readInputFile(projectId, inputPath));
      }

      const resultMatch = /^\/project-results\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && resultMatch) {
        const projectId = decodeURIComponent(resultMatch[1]);
        const resultId = decodeURIComponent(resultMatch[2]);
        const fileId = decodeURIComponent(resultMatch[3]);
        return sendMediaFile(
          request,
          response,
          await reader.readResultFile(projectId, resultId, fileId)
        );
      }

      if (request.method === "GET" && staticFiles[url.pathname]) {
        const asset = staticFiles[url.pathname];
        const content = await readFile(join(uiDirectory, asset.file));
        response.writeHead(200, { "Content-Type": asset.type });
        return response.end(content);
      }

      return sendJson(response, 404, { error: "Không tìm thấy." });
    } catch (error) {
      if (
        error instanceof ProjectNotFoundError ||
        error instanceof ProjectInputNotFoundError ||
        error instanceof ProjectResultFileNotFoundError ||
        error instanceof ProjectPathError
      ) {
        return sendJson(response, 404, { error: error.message });
      }
      console.error(error);
      return sendJson(response, 500, { error: error.message || "Đã có lỗi không xác định." });
    }
  });
}

async function main() {
  const server = createPadStudioServer({ reader: new ProjectReader(projectRoot) });
  const port = Number(process.env.PORT || 7603);

  server.listen(port, "127.0.0.1", () => {
    console.log(`PADStudio đang chạy tại http://127.0.0.1:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
