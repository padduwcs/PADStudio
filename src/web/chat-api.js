import { mkdtemp, open, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { importProjectInput } from "../resources/project-importer.js";
import { isPathInside } from "../project/project-paths.js";
import { ChatError, safeError } from "../chat/chat-protocol.js";
import { CodexConnectionError } from "../chat/codex-client.js";

export const MAX_CHAT_UPLOAD_BYTES = 100 * 1024 * 1024;

function send(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}

function assertRequest(request, { write = false, upload = false } = {}) {
  const ownOrigin = "http://" + String(request.headers.host).toLowerCase();
  const origin = String(request.headers.origin ?? "").toLowerCase();
  const site = request.headers["sec-fetch-site"];
  if ((origin && origin !== ownOrigin) || (site && !["same-origin", "none"].includes(site)) || (write && !origin)) {
    throw new ChatError(403, "Chỉ trang PADStudio trên máy này mới được dùng hội thoại.");
  }
  if (write) {
    if (request.headers["x-padstudio-intent"] !== "chat") throw new ChatError(403, "Thiếu xác nhận thao tác hội thoại.");
    const expected = upload ? "application/octet-stream" : "application/json";
    if (String(request.headers["content-type"] ?? "").toLowerCase().split(";")[0].trim() !== expected) throw new ChatError(415, "Định dạng yêu cầu không hợp lệ.");
  }
}

async function jsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new ChatError(413, "Yêu cầu hội thoại quá lớn.");
    if (size <= 128 * 1024) chunks.push(chunk);
  }
  if (size > 128 * 1024) throw new ChatError(413, "Yêu cầu hội thoại quá lớn.");
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new ChatError(400, "Nội dung không phải JSON hợp lệ."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChatError(400, "Yêu cầu phải là một object.");
  return value;
}

async function upload(request, service, projectId) {
  await service.session(projectId);
  let name;
  try { name = decodeURIComponent(request.headers["x-padstudio-filename"] ?? ""); } catch { throw new ChatError(400, "Tên file không hợp lệ."); }
  if (!name || name.length > 200 || name !== basename(name) || /[<>:"|?*\\/\u0000-\u001f]/.test(name) || /[. ]$/.test(name)
    || name === "." || name === ".." || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new ChatError(400, "Tên file không hợp lệ.");
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_CHAT_UPLOAD_BYTES) throw new ChatError(413, "Mỗi tư liệu tối đa 100 MB.");
  const temporary = await mkdtemp(join(tmpdir(), "padstudio-chat-upload-"));
  const file = join(temporary, name);
  let handle;
  try {
    handle = await open(file, "wx");
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_CHAT_UPLOAD_BYTES * 2) throw new ChatError(413, "Mỗi tư liệu tối đa 100 MB.");
      if (size <= MAX_CHAT_UPLOAD_BYTES) await handle.writeFile(chunk);
    }
    await handle.close(); handle = null;
    if (size > MAX_CHAT_UPLOAD_BYTES) throw new ChatError(413, "Mỗi tư liệu tối đa 100 MB.");
    if (size === 0) throw new ChatError(400, "File tư liệu đang trống.");
    const imported = await importProjectInput({ rootDir: service.projectRoot, projectId, sourcePath: file });
    return { attachment: { resourceId: imported.resourceId, name: imported.inputPath, sizeBytes: size } };
  } finally {
    await handle?.close();
    if (isPathInside(resolve(tmpdir()), resolve(temporary)) && basename(temporary).startsWith("padstudio-chat-upload-")) {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

function events(request, response, service, session) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff"
  });
  let scheduled = null;
  let closed = false;
  const flush = () => {
    scheduled = null;
    if (closed) return;
    if (response.writableLength > 2 * 1024 * 1024) { response.destroy(); return; }
    response.write(`event: state\ndata: ${JSON.stringify({ status: service.status(), session: session ? service.snapshot(session) : null })}\n\n`);
  };
  const change = (projectId) => {
    if (projectId && projectId !== session?.projectId) return;
    if (!scheduled) scheduled = setTimeout(flush, 60);
  };
  service.on("change", change);
  const heartbeat = setInterval(() => { if (!closed) response.write(": keep-alive\n\n"); }, 15_000);
  heartbeat.unref();
  const close = () => {
    closed = true; clearTimeout(scheduled); clearInterval(heartbeat); service.off("change", change);
  };
  request.once("close", close);
  response.once("close", close);
  flush();
}

/** Returns true when this module handled the URL. Only explicit app actions are exposed, never arbitrary RPC. */
export async function handleChatRequest(request, response, url, service) {
  if (!url.pathname.startsWith("/api/chat/")) return false;
  try {
    const write = request.method === "POST";
    const uploadRoute = /^\/api\/chat\/projects\/([^/]+)\/attachments$/.exec(url.pathname);
    assertRequest(request, { write, upload: Boolean(uploadRoute) });
    if (request.method === "GET" && url.pathname === "/api/chat/status") { send(response, 200, { status: service.status() }); return true; }
    if (request.method === "GET" && url.pathname === "/api/chat/events") {
      const projectId = url.searchParams.get("project");
      const session = projectId ? await service.session(projectId) : null;
      events(request, response, service, session); return true;
    }
    if (write && uploadRoute) { send(response, 201, await upload(request, service, decodeURIComponent(uploadRoute[1]))); return true; }
    if (write && url.pathname === "/api/chat/connect") { await jsonBody(request); send(response, 200, { status: await service.connect() }); return true; }
    if (write && url.pathname === "/api/chat/login") { await jsonBody(request); send(response, 200, { status: await service.startLogin() }); return true; }
    if (write && url.pathname === "/api/chat/login/cancel") { await jsonBody(request); send(response, 200, { status: await service.cancelLogin() }); return true; }
    if (write && url.pathname === "/api/chat/projects") {
      const body = await jsonBody(request);
      send(response, 201, { project: await service.createProject(body.title) }); return true;
    }
    const match = /^\/api\/chat\/projects\/([^/]+)(?:\/(messages|interrupt|answer|new|conversation))?$/.exec(url.pathname);
    if (match) {
      const projectId = decodeURIComponent(match[1]);
      if (!match[2] && request.method === "GET") { send(response, 200, { session: await service.read(projectId) }); return true; }
      if (write && match[2]) {
        const body = await jsonBody(request);
        if (match[2] === "messages") send(response, 200, await service.send(projectId, body));
        else if (match[2] === "interrupt") send(response, 200, { session: await service.interrupt(projectId) });
        else if (match[2] === "answer") send(response, 200, { session: await service.answer(projectId, body.requestId, body) });
        else if (match[2] === "conversation") send(response, 200, { session: await service.selectConversation(projectId, body.conversationId) });
        else send(response, 200, { session: await service.newConversation(projectId) });
        return true;
      }
    }
    send(response, 404, { error: "Không tìm thấy thao tác hội thoại." });
  } catch (error) {
    const status = error instanceof ChatError ? error.status : error instanceof CodexConnectionError ? 503
      : error.name === "ProjectPathError" || error instanceof URIError ? 400 : 500;
    send(response, status, { error: safeError(error), code: error.code ?? "chat_error" });
  }
  return true;
}
