import { ChatError, safeError } from "../chat/chat-protocol.js";
import { CodexConnectionError } from "../chat/codex-client.js";

function send(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}

function assertRequest(request, { write = false } = {}) {
  const ownOrigin = "http://" + String(request.headers.host).toLowerCase();
  const origin = String(request.headers.origin ?? "").toLowerCase();
  const site = request.headers["sec-fetch-site"];
  if ((origin && origin !== ownOrigin) || (site && !["same-origin", "none"].includes(site)) || (write && !origin)) {
    throw new ChatError(403, "Chỉ trang PADStudio trên máy này mới được dùng hội thoại.");
  }
  if (write) {
    if (request.headers["x-padstudio-intent"] !== "chat") throw new ChatError(403, "Thiếu xác nhận thao tác hội thoại.");
    const expected = "application/json";
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
  const change = () => {
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

/** A small, explicit Codex client surface. It has no project, import or arbitrary RPC routes. */
export async function handleChatRequest(request, response, url, service) {
  if (!url.pathname.startsWith("/api/chat/")) return false;
  try {
    const write = request.method === "POST"; assertRequest(request, { write });
    if (request.method === "GET" && url.pathname === "/api/chat/status") { send(response, 200, { status: service.status() }); return true; }
    if (request.method === "GET" && url.pathname === "/api/chat/events") {
      if (url.searchParams.has("project")) throw new ChatError(400, "Chat không nhận ngữ cảnh project.");
      events(request, response, service, await service.session(url.searchParams.get("conversation"))); return true;
    }
    if (write && url.pathname === "/api/chat/connect") { await jsonBody(request); send(response, 200, { status: await service.connect() }); return true; }
    if (write && url.pathname === "/api/chat/login") { await jsonBody(request); send(response, 200, { status: await service.startLogin() }); return true; }
    if (write && url.pathname === "/api/chat/login/cancel") { await jsonBody(request); send(response, 200, { status: await service.cancelLogin() }); return true; }
    if (url.pathname === "/api/chat/conversations") {
      if (request.method === "GET") { send(response, 200, { session: await service.read() }); return true; }
      if (write) { await jsonBody(request); send(response, 201, { session: await service.newConversation() }); return true; }
    }
    const match = /^\/api\/chat\/conversations\/([^/]+)(?:\/(messages|interrupt|answer))?$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (!match[2] && request.method === "GET") { send(response, 200, { session: await service.read(id) }); return true; }
      if (write && match[2]) {
        const body = await jsonBody(request);
        if (match[2] === "messages") send(response, 200, await service.send(id, body));
        else if (match[2] === "interrupt") send(response, 200, { session: await service.interrupt(id) });
        else send(response, 200, { session: await service.answer(id, body.requestId, body) });
        return true;
      }
    }
    send(response, 404, { error: "Không tìm thấy thao tác hội thoại." });
  } catch (error) {
    const status = error instanceof ChatError ? error.status : error instanceof CodexConnectionError ? 503 : error instanceof URIError ? 400 : 500;
    send(response, status, { error: safeError(error), code: error.code ?? "chat_error" });
  }
  return true;
}
