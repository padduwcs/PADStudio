import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProjectInputNotFoundError,
  ProjectNotFoundError,
  ProjectReader,
  ProjectResultFileNotFoundError
} from "./project-reader.js";
import { ProjectPathError } from "../project/project-paths.js";
import { AnalysisReaderError } from "../analysis/analysis-reader.js";
import { AnalysisValidationError } from "../analysis/contracts.js";
import { etagMatches, quotedEtag } from "./project-generation.js";
import { resolveProjectRoot } from "../config/project-root.js";
import { buildStaticAssets, sendStaticAsset } from "./static-assets.js";
import { LocalConfigError } from "../config/local-config.js";
import { createSettingsService, SettingsError } from "./settings-service.js";
import { observerBuild } from "./observer-build.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const applicationRoot = join(currentDirectory, "..", "..");
const uiDirectory = join(applicationRoot, "ui");
const projectRoot = resolveProjectRoot();

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

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(value));
}

function sendNotModified(response, etag) {
  response.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
  response.end();
}

// The observer only ever serves the local browser. Refusing other Host headers stops a web page on another origin
// from reading project data through DNS rebinding (the name resolves to 127.0.0.1 but the Host stays the attacker's).
const LOCAL_HOST_NAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLocalHostHeader(header) {
  const host = String(header ?? "").trim().toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return LOCAL_HOST_NAMES.has(name);
}

// The web never changes a project. The one thing it may change is this machine's settings (API keys and the
// services the user has), and only from the PADStudio page itself: the browser must send our own Origin, a JSON
// body and a custom header. A page on another site can do none of these without a CORS preflight, which this
// server never answers, so it cannot write settings even while the user has PADStudio open.
const SETTINGS_INTENT = "settings";
const MAX_SETTINGS_BODY = 16 * 1024;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assertSettingsWrite(request) {
  const origin = String(request.headers.origin ?? "").toLowerCase();
  if (!origin || origin !== "http://" + String(request.headers.host ?? "").toLowerCase()) {
    throw new RequestError(403, "Chỉ trang PADStudio trên máy này mới được đổi cài đặt.");
  }
  const site = request.headers["sec-fetch-site"];
  if (site && site !== "same-origin") throw new RequestError(403, "Chỉ trang PADStudio trên máy này mới được đổi cài đặt.");
  if (request.headers["x-padstudio-intent"] !== SETTINGS_INTENT) throw new RequestError(403, "Thiếu xác nhận thao tác cài đặt.");
  if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new RequestError(415, "Cài đặt phải gửi dạng JSON.");
  }
}

// A body over the limit is still read to the end before answering 413. Stopping early would destroy the socket
// while the browser is still sending, and on Windows the reset can arrive before the 413 does. Only a body far
// beyond any settings payload is cut off.
const MAX_DRAINED_BODY = 1024 * 1024;

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_DRAINED_BODY) throw new RequestError(413, "Nội dung cài đặt quá lớn.");
    if (size <= MAX_SETTINGS_BODY) chunks.push(chunk);
  }
  if (size > MAX_SETTINGS_BODY) throw new RequestError(413, "Nội dung cài đặt quá lớn.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new RequestError(400, "Nội dung cài đặt không phải JSON hợp lệ.");
  }
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

export function createPadStudioServer({ reader, staticDirectory = uiDirectory, settings = createSettingsService(), build = observerBuild() }) {
  const staticAssets = buildStaticAssets(staticDirectory);
  // Who this server is and which code it started with, so observer:ensure can replace a server left running
  // from before an update instead of silently reusing it.
  const identity = { app: "padstudio-observer", pid: process.pid, startedAt: new Date().toISOString(), build };
  const server = createServer(async (request, response) => {
    try {
      if (!isLocalHostHeader(request.headers.host)) {
        return sendJson(response, 403, { error: "Observer chỉ phục vụ địa chỉ localhost." });
      }
      const url = new URL(request.url, "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/projects") {
        const projects = await reader.listObserverProjects();
        const digest = createHash("sha256").update(JSON.stringify(projects)).digest("hex");
        const etag = quotedEtag(`projects-${digest}`);
        if (etagMatches(request.headers["if-none-match"], etag)) return sendNotModified(response, etag);
        return sendJson(response, 200, { projects }, { ETag: etag, "Cache-Control": "no-cache" });
      }

      if (url.pathname === "/api/observer" && request.method === "GET") {
        return sendJson(response, 200, identity, { "Cache-Control": "no-store" });
      }

      if (url.pathname === "/api/tools" && request.method === "GET") {
        const overview = await settings.overview({ refresh: url.searchParams.get("refresh") === "1" });
        return sendJson(response, 200, overview, { "Cache-Control": "no-store" });
      }

      if (url.pathname === "/api/settings") {
        if (request.method === "GET") return sendJson(response, 200, { settings: await settings.settings() }, { "Cache-Control": "no-store" });
        if (request.method === "PUT") {
          assertSettingsWrite(request);
          const updated = await settings.update(await readJsonBody(request));
          return sendJson(response, 200, { settings: updated }, { "Cache-Control": "no-store" });
        }
      }

      // Read-only lookups in the user's ElevenLabs account for the voice and model pickers. They are POSTs behind the
      // same guard as settings writes, so no other page can make this server call ElevenLabs with the saved key.
      const catalogMatch = /^\/api\/settings\/elevenlabs\/(models|voices|voice)$/.exec(url.pathname);
      if (catalogMatch && request.method === "POST") {
        assertSettingsWrite(request);
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError(400, "Yêu cầu không hợp lệ.");
        const language = body.language === undefined ? "vi" : body.language;
        if (typeof language !== "string" || !/^[a-z]{2}$/.test(language)) throw new RequestError(400, "Mã ngôn ngữ phải gồm hai chữ cái thường, ví dụ vi.");
        if (catalogMatch[1] === "models") return sendJson(response, 200, await settings.elevenLabsModels({ language }), { "Cache-Control": "no-store" });
        if (catalogMatch[1] === "voice") {
          if (typeof body.voiceId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(body.voiceId.trim())) {
            throw new RequestError(400, "Mã giọng không hợp lệ. Mã giọng chỉ gồm chữ, số, dấu chấm, gạch dưới và gạch ngang.");
          }
          return sendJson(response, 200, await settings.elevenLabsVoice({ voiceId: body.voiceId.trim() }), { "Cache-Control": "no-store" });
        }
        const search = body.search ?? "";
        const pageToken = body.pageToken ?? null;
        if (typeof search !== "string" || search.length > 100 || (pageToken !== null && (typeof pageToken !== "string" || pageToken.length > 500))) {
          throw new RequestError(400, "Từ khóa tìm giọng tối đa 100 ký tự.");
        }
        return sendJson(response, 200, await settings.elevenLabsVoices({ language, search, pageToken }), { "Cache-Control": "no-store" });
      }

      if (url.pathname === "/api/settings/elevenlabs/check" && request.method === "POST") {
        assertSettingsWrite(request);
        await readJsonBody(request);
        return sendJson(response, 200, await settings.checkElevenLabs(), { "Cache-Control": "no-store" });
      }

      const observerMatch = /^\/api\/projects\/([^/]+)\/observer\/(card|summary|source|creative|animation|production|delivery|health|activity)$/.exec(url.pathname);
      if (request.method === "GET" && observerMatch) {
        const projectId = decodeURIComponent(observerMatch[1]);
        const section = observerMatch[2];
        const generation = await reader.generation(projectId);
        const etag = quotedEtag(`${generation}-${section}`);
        if (etagMatches(request.headers["if-none-match"], etag)) return sendNotModified(response, etag);
        const context = await reader.readObserverSection(projectId, section, generation);
        const stableEtag = quotedEtag(`${context.generation}-${section}`);
        return sendJson(response, 200, { context }, { ETag: stableEtag, "Cache-Control": "no-cache" });
      }

      const analysisQueryMatch = /^\/api\/projects\/([^/]+)\/analysis\/query$/.exec(url.pathname);
      if (request.method === "GET" && analysisQueryMatch) {
        const projectId = decodeURIComponent(analysisQueryMatch[1]);
        const query = Object.fromEntries(url.searchParams.entries());
        if (query.limit !== undefined) query.limit = Number(query.limit);
        if (query.diacriticInsensitive !== undefined) {
          if (!["true", "false"].includes(query.diacriticInsensitive)) {
            return sendJson(response, 400, { error: "diacriticInsensitive must be true or false." });
          }
          query.diacriticInsensitive = query.diacriticInsensitive === "true";
        }
        if (query.startSeconds !== undefined || query.endSeconds !== undefined) {
          query.range = { startSeconds: Number(query.startSeconds), endSeconds: Number(query.endSeconds) };
          delete query.startSeconds;
          delete query.endSeconds;
        }
        return sendJson(response, 200, await reader.readAnalysis(projectId, query));
      }

      const analysisMatch = /^\/api\/projects\/([^/]+)\/analysis$/.exec(url.pathname);
      if (request.method === "GET" && analysisMatch) {
        const projectId = decodeURIComponent(analysisMatch[1]);
        return sendJson(response, 200, await reader.readAnalysis(projectId, { view: "summary" }));
      }

      const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && projectMatch) {
        const projectId = decodeURIComponent(projectMatch[1]);
        const view = url.searchParams.get("view") === "summary" ? "summary" : "full";
        const generation = await reader.generation(projectId);
        const etag = quotedEtag(`${generation}-${view}`);
        if (etagMatches(request.headers["if-none-match"], etag)) return sendNotModified(response, etag);
        const snapshot = await reader.readProjectSnapshot(projectId, view, generation);
        const stableEtag = quotedEtag(`${snapshot.generation}-${view}`);
        return sendJson(response, 200, { context: snapshot.context },
          { ETag: stableEtag, "Cache-Control": "no-cache" });
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

      if (request.method === "GET" && staticAssets.has(url.pathname)) {
        return await sendStaticAsset(request, response, staticAssets.get(url.pathname));
      }

      return sendJson(response, 404, { error: "Không tìm thấy." });
    } catch (error) {
      if (error instanceof RequestError) return sendJson(response, error.status, { error: error.message });
      if (error instanceof LocalConfigError) return sendJson(response, 400, { error: error.message });
      if (error instanceof SettingsError) return sendJson(response, error.status, { error: error.message });
      if (error instanceof URIError) {
        return sendJson(response, 400, { error: "Địa chỉ yêu cầu không hợp lệ." });
      }
      if (
        error instanceof AnalysisValidationError
      ) {
        return sendJson(response, 400, { error: error.message, code: error.code });
      }
      if (error instanceof AnalysisReaderError) {
        const status = ["cursor_stale", "index_not_ready", "dataset_stale", "ambiguous_result"].includes(error.code)
          ? 409
          : error.code === "result_not_found" ? 404 : 400;
        return sendJson(response, status, { error: error.message, code: error.code });
      }
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
  // The observer only talks to the local browser, which polls every couple of seconds. A longer idle window than
  // Node's 5 s default stops a slow client from reusing a connection the server is just closing.
  server.keepAliveTimeout = 30_000;
  return server;
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
