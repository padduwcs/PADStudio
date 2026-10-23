import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore, StoredProjectNotFoundError } from "../project/project-store.js";
import { validateProjectId } from "../project/project-paths.js";
import { writeJsonAtomic } from "../project/atomic-files.js";
import { CodexClient } from "./codex-client.js";
import { approvalAnswer, approvalView, ChatError, displayItem, displayUserText, externalUrl, projectInstructions, safeError, text } from "./chat-protocol.js";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_ITEMS = 500;

export class ChatService extends EventEmitter {
  constructor({ projectRoot, sessionRoot = join(dirname(projectRoot), "chat", createHash("sha256").update(resolve(projectRoot)).digest("hex").slice(0, 16)), cwd = applicationRoot, client = null } = {}) {
    super();
    Object.assign(this, { projectRoot: resolve(projectRoot), sessionRoot, cwd });
    this.store = new ProjectStore(this.projectRoot);
    this.client = client ?? new CodexClient({ cwd, env: { ...process.env, PADSTUDIO_PROJECT_ROOT: this.projectRoot } });
    this.sessions = new Map();
    this.loading = new Map();
    this.connected = false;
    this.account = null;
    this.models = [];
    this.connecting = null;
    this.login = null;
    this.error = null;
    this.client.on("notification", (message) => {
      try { this.#notification(message); } catch { this.error = "Không đọc được một cập nhật từ Codex. Kiểm tra phiên bản và kết nối lại."; this.emit("change"); }
    });
    this.client.on("serverRequest", (message) => {
      try { this.#serverRequest(message); } catch { this.client.reject(message.id, "Unsupported request format"); }
    });
    this.client.on("disconnect", (error) => {
      this.connected = false; this.connecting = null; this.error = safeError(error);
      for (const session of this.sessions.values()) {
        session.loaded = false;
        if (session.active) session.error = "Kết nối Codex đã mất. Kiểm tra lịch sử và trạng thái project trước khi yêu cầu chạy lại.";
        session.active = false; session.turnId = null; session.requests.clear();
      }
      this.emit("change");
    });
  }

  status() {
    return { connected: this.connected, authenticated: this.account?.authenticated ?? false, accountType: this.account?.type ?? null,
      models: this.models, login: this.login ? { url: this.login.url } : null, error: this.error };
  }

  async connect() {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.client.start();
      this.connected = true;
      await this.#account();
      const result = await this.client.request("model/list", { limit: 100 });
      this.models = (result.data ?? []).filter((model) => !model.hidden).map((model) => ({
        id: model.model, name: model.displayName || model.model, isDefault: model.isDefault === true
      }));
      this.error = null;
      this.emit("change");
      return this.status();
    })().catch((error) => { this.connecting = null; this.error = safeError(error); this.emit("change"); throw error; });
    return this.connecting;
  }

  async #account() {
    const value = await this.client.request("account/read", {});
    this.account = { authenticated: Boolean(value.account) || value.requiresOpenaiAuth === false, type: value.account?.type ?? "custom" };
  }

  async startLogin() {
    await this.connect();
    if (this.login) return this.status();
    const result = await this.client.request("account/login/start", { type: "chatgpt" });
    const url = externalUrl(result.authUrl, { login: true });
    if (!url || typeof result.loginId !== "string") throw new ChatError(502, "Codex không trả về địa chỉ đăng nhập hợp lệ.");
    this.login = { id: result.loginId, url }; this.error = null; this.emit("change");
    return this.status();
  }

  async cancelLogin() {
    if (this.login) await this.client.request("account/login/cancel", { loginId: this.login.id });
    this.login = null; this.emit("change");
    return this.status();
  }

  async createProject(title) {
    if (typeof title !== "string" || !title.trim() || title.length > 160) throw new ChatError(400, "Tên dự án cần có từ 1 đến 160 ký tự.");
    return this.store.createProject({ projectId: `video-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8)}`, title: title.trim() });
  }

  #path(projectId) { return join(this.sessionRoot, createHash("sha256").update(projectId).digest("hex") + ".json"); }

  async session(projectId) {
    validateProjectId(projectId);
    await this.store.readProject(projectId).catch((error) => {
      if (error instanceof StoredProjectNotFoundError) throw new ChatError(404, "Không tìm thấy dự án.", "project_not_found");
      throw error;
    });
    if (this.sessions.has(projectId)) return this.sessions.get(projectId);
    if (this.loading.has(projectId)) return this.loading.get(projectId);
    const load = (async () => {
      let saved = null;
      try { saved = JSON.parse(await readFile(this.#path(projectId), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw new ChatError(500, "Không đọc được liên kết hội thoại đã lưu. Dữ liệu cũ được giữ nguyên.", "session_read_failed"); }
      if (saved && (saved.version !== "1.0" || saved.projectId !== projectId || (saved.threadId !== null && typeof saved.threadId !== "string"))) {
        throw new ChatError(500, "Liên kết hội thoại không đúng định dạng. Dữ liệu cũ được giữ nguyên.", "session_read_failed");
      }
      const session = { projectId, threadId: saved?.threadId ?? null, model: saved?.model ?? null,
        receipts: saved?.receipts ?? [], previousThreads: (saved?.previousThreads ?? []).map((entry) => typeof entry === "string" ? { id: entry, title: "Hội thoại trước" } : entry),
        title: saved?.title ?? "", startedAt: saved?.startedAt ?? null,
        items: [], requests: new Map(), active: false, turnId: null, loaded: false, busy: false, error: null, truncated: false };
      this.sessions.set(projectId, session);
      return session;
    })();
    this.loading.set(projectId, load);
    try { return await load; } finally { this.loading.delete(projectId); }
  }

  async #save(session) {
    await mkdir(this.sessionRoot, { recursive: true });
    session.receipts = session.receipts.slice(-200);
    session.previousThreads = session.previousThreads.slice(-20);
    await writeJsonAtomic(this.#path(session.projectId), {
      version: "1.0", projectId: session.projectId, threadId: session.threadId, model: session.model,
      title: session.title, startedAt: session.startedAt,
      receipts: session.receipts.slice(-200), previousThreads: session.previousThreads.slice(-20)
    });
  }

  snapshot(session) {
    return { projectId: session.projectId, hasConversation: Boolean(session.threadId), model: session.model, active: session.active,
      items: session.items.slice(-MAX_ITEMS), requests: [...session.requests.values()].map((entry) => entry.view), error: session.error,
      truncated: session.truncated || session.items.length > MAX_ITEMS,
      conversations: [
        ...(session.threadId ? [{ id: session.threadId, title: session.title || "Cuộc trò chuyện hiện tại", current: true }] : []),
        ...session.previousThreads.map((entry) => ({ id: entry.id, title: entry.title || "Hội thoại trước", current: false }))
      ] };
  }

  async read(projectId) {
    const session = await this.session(projectId);
    if (session.threadId && this.connected && !session.loaded && !session.busy) {
      session.busy = true;
      try { await this.#load(session); }
      finally { session.busy = false; }
    }
    return this.snapshot(session);
  }

  async #load(session) {
    const project = await this.store.readProject(session.projectId);
    const result = await this.client.request("thread/resume", {
      threadId: session.threadId, cwd: this.cwd, developerInstructions: projectInstructions(project, this.projectRoot),
      approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "workspace-write"
    });
    let turns = result.thread.turns ?? [];
    if (result.thread.historyMode === "paginated") {
      const history = await this.client.request("thread/turns/list", { threadId: session.threadId, limit: 50, sortDirection: "desc", itemsView: "full" });
      turns = [...history.data].reverse(); session.truncated = Boolean(history.nextCursor);
    }
    session.items = turns.flatMap((turn) => turn.items.map((item) => displayItem(item, turn.id)).filter(Boolean)).slice(-MAX_ITEMS);
    const active = turns.findLast((turn) => turn.status === "inProgress");
    session.active = Boolean(active); session.turnId = active?.id ?? null; session.loaded = true;
    session.model = result.model ?? session.model;
    // A resumed failed/interrupted turn is never replayed automatically.
    const last = turns.at(-1);
    session.error = last?.status === "failed" ? safeError(last.error) : last?.status === "interrupted" ? "Lượt trước đã dừng. Bạn có thể gửi yêu cầu tiếp theo." : null;
    this.emit("change", session.projectId);
  }

  async send(projectId, { message, clientId, model = null, attachments = [], anchor = null } = {}) {
    if (!Array.isArray(attachments) || attachments.length > 12 || attachments.some((id) => typeof id !== "string")) throw new ChatError(400, "Danh sách tư liệu không hợp lệ.");
    if (typeof message !== "string" || message.length > 32_000 || (!message.trim() && !attachments.length)) throw new ChatError(400, "Nhập tin nhắn tối đa 32.000 ký tự hoặc đính kèm tư liệu.");
    if (typeof clientId !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(clientId)) throw new ChatError(400, "Mã tin nhắn không hợp lệ.");
    if (model !== null && (typeof model !== "string" || !this.models.some((entry) => entry.id === model))) throw new ChatError(400, "Model này chưa có trong danh sách Codex.");
    const session = await this.session(projectId);
    const fingerprint = createHash("sha256").update(JSON.stringify({ message, model, attachments, anchor })).digest("hex");
    const previous = session.receipts.find((entry) => entry.id === clientId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ChatError(409, "Mã tin nhắn đã được dùng cho nội dung khác.");
      return { duplicate: true, session: this.snapshot(session) };
    }
    if (session.busy) throw new ChatError(409, "Hội thoại đang cập nhật. Vui lòng chờ một chút.");
    if (session.active && model && model !== session.model) throw new ChatError(409, "Chờ lượt hiện tại kết thúc trước khi đổi model.");
    session.busy = true;
    try {
      await this.connect();
      if (!this.account.authenticated) throw new ChatError(401, "Đăng nhập Codex để bắt đầu trò chuyện.", "login_required");
      const input = await this.#input(projectId, message, attachments, anchor);
      if (session.threadId && !session.loaded) await this.#load(session);
      if (session.active && model && model !== session.model) throw new ChatError(409, "Chờ lượt hiện tại kết thúc trước khi đổi model.");
      if (!session.threadId) {
        const project = await this.store.readProject(projectId);
        const result = await this.client.request("thread/start", {
          cwd: this.cwd, ...(model ? { model } : {}), approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "workspace-write",
          developerInstructions: projectInstructions(project, this.projectRoot)
        });
        session.threadId = result.thread.id; session.loaded = true; session.model = result.model ?? model;
        session.title = message.trim().split("\n")[0].slice(0, 80) || "Cuộc trò chuyện mới";
        session.startedAt = new Date().toISOString();
        await this.#save(session);
      }
      if (session.requests.size) throw new ChatError(409, "Hãy trả lời yêu cầu đang chờ trong hội thoại trước.");
      const receipt = { id: clientId, fingerprint, threadId: session.threadId, status: "sending", at: new Date().toISOString() };
      session.receipts.push(receipt);
      await this.#save(session); // Before the RPC: an ambiguous network failure must never silently spend twice.
      const optimistic = { id: `client-${clientId}`, clientId, role: "user", kind: "message", text: displayUserText(input[0].text), status: "sending", turnId: session.turnId };
      session.items.push(optimistic); session.error = null;
      const wasActive = session.active;
      session.active = true; this.emit("change", projectId);
      try {
        const result = await this.client.request(wasActive ? "turn/steer" : "turn/start", {
          threadId: session.threadId, input, clientUserMessageId: clientId,
          ...(wasActive ? { expectedTurnId: session.turnId } : { ...(model ? { model } : {}) })
        });
        receipt.status = "sent"; receipt.turnId = result.turn?.id ?? result.turnId;
        if (session.active) session.turnId = receipt.turnId ?? session.turnId;
        optimistic.status = "completed";
        if (model) session.model = model;
        await this.#save(session);
      } catch (error) {
        receipt.status = "uncertain";
        optimistic.status = "uncertain";
        session.error = safeError(error);
        if (!wasActive && !session.turnId) session.active = false;
        await this.#save(session).catch(() => {});
        this.emit("change", projectId);
        throw error;
      }
      this.emit("change", projectId);
      return { duplicate: false, session: this.snapshot(session) };
    } finally { session.busy = false; }
  }

  async #input(projectId, message, attachments, anchor) {
    if (!Array.isArray(attachments) || attachments.length > 12 || attachments.some((id) => typeof id !== "string")) throw new ChatError(400, "Danh sách tư liệu không hợp lệ.");
    const context = attachments.length || anchor ? await this.store.readContext(projectId) : null;
    const resources = attachments.map((id) => {
      const resource = context.resources.find((candidate) => candidate.id === id);
      if (!resource) throw new ChatError(400, "Tư liệu không thuộc dự án đang chọn.");
      return { resourceId: resource.id, name: resource.name, path: resource.path };
    });
    let target = null;
    if (anchor) {
      const result = context.results.find((candidate) => candidate.id === anchor.resultId);
      if (!result || typeof anchor.text !== "string" || anchor.text.length > 2_000) throw new ChatError(400, "Mốc phản hồi không thuộc dự án đang chọn.");
      target = anchor.text;
    }
    const content = message.trim() + (resources.length || target
      ? `\n\n<PADStudio-context>\n${JSON.stringify({ version: "1.0", attachments: resources, video: target })}\n</PADStudio-context>` : "");
    return [{ type: "text", text: content, text_elements: [] }];
  }

  async interrupt(projectId) {
    const session = await this.session(projectId);
    if (session.busy || (session.active && !session.turnId)) throw new ChatError(409, "Đang gửi yêu cầu. Vui lòng chờ agent nhận xong.");
    if (session.active && session.turnId) await this.client.request("turn/interrupt", { threadId: session.threadId, turnId: session.turnId });
    return this.snapshot(session);
  }

  async answer(projectId, requestId, value) {
    const session = await this.session(projectId);
    const request = session.requests.get(requestId);
    if (!request) throw new ChatError(409, "Yêu cầu này đã được trả lời hoặc đã kết thúc. Hội thoại sẽ cập nhật lại.");
    const result = approvalAnswer(request, value);
    this.client.respond(request.rpcId, result);
    session.requests.delete(requestId); this.emit("change", projectId);
    return this.snapshot(session);
  }

  async newConversation(projectId) {
    const session = await this.session(projectId);
    if (session.active || session.busy) throw new ChatError(409, "Dừng lượt đang chạy trước khi mở cuộc trò chuyện mới.");
    if (session.threadId) session.previousThreads.push({ id: session.threadId, title: session.title, at: session.startedAt });
    session.threadId = null; session.model = null; session.items = []; session.loaded = false; session.requests.clear(); session.error = null;
    session.title = ""; session.startedAt = null;
    await this.#save(session); this.emit("change", projectId);
    return this.snapshot(session);
  }

  #find(threadId) { return [...this.sessions.values()].find((session) => session.threadId === threadId); }

  async selectConversation(projectId, conversationId) {
    const session = await this.session(projectId);
    if (session.active || session.busy) throw new ChatError(409, "Dừng lượt đang chạy trước khi chuyển hội thoại.");
    if (session.threadId === conversationId) return this.snapshot(session);
    const target = session.previousThreads.find((entry) => entry.id === conversationId);
    if (!target) throw new ChatError(404, "Hội thoại không thuộc dự án này.");
    session.busy = true;
    const previous = { threadId: session.threadId, title: session.title, startedAt: session.startedAt, model: session.model };
    try {
      await this.connect();
      session.threadId = target.id; session.title = target.title; session.startedAt = target.at ?? null;
      await this.#load(session);
      session.previousThreads = session.previousThreads.filter((entry) => entry.id !== target.id);
      if (previous.threadId) session.previousThreads.push({ id: previous.threadId, title: previous.title, at: previous.startedAt });
      await this.#save(session); this.emit("change", projectId);
      return this.snapshot(session);
    } catch (error) { Object.assign(session, previous); session.loaded = false; throw error; }
    finally { session.busy = false; }
  }

  #upsert(session, item, turnId) {
    const value = displayItem(item, turnId);
    if (!value) return;
    const existing = session.items.findIndex((candidate) => candidate.id === value.id ||
      (value.clientId && candidate.id === `client-${value.clientId}`));
    if (existing >= 0) session.items[existing] = value;
    else session.items.push(value);
    if (session.items.length > MAX_ITEMS) { session.items = session.items.slice(-MAX_ITEMS); session.truncated = true; }
  }

  #notification({ method, params: p = {} }) {
    if (method === "account/login/completed" || method === "account/updated") {
      if (method === "account/login/completed") { this.login = null; this.error = p.success ? null : text(p.error) || "Đăng nhập chưa hoàn tất."; }
      this.#account().then(() => this.emit("change")).catch((error) => { this.error = safeError(error); this.emit("change"); });
      return;
    }
    const session = this.#find(p.threadId);
    if (!session) return;
    if (method === "turn/started") { session.turnId = p.turn.id; session.active = true; session.error = null; }
    else if (method === "turn/completed") {
      for (const item of p.turn.items ?? []) this.#upsert(session, item, p.turn.id);
      if (session.turnId && session.turnId !== p.turn.id) return;
      session.active = false; session.turnId = null; session.requests.clear();
      if (p.turn.status === "failed") session.error = safeError(p.turn.error);
      else if (p.turn.status === "interrupted") session.error = "Đã dừng lượt của agent. Những kết quả đã tạo vẫn được giữ trong dự án.";
    } else if (method === "item/started" || method === "item/completed") this.#upsert(session, p.item, p.turnId);
    else if (method === "item/agentMessage/delta") {
      let item = session.items.find((candidate) => candidate.id === p.itemId);
      if (!item) { item = { id: p.itemId, role: "assistant", kind: "message", text: "", turnId: p.turnId, status: "inProgress" }; session.items.push(item); }
      item.text = (item.text + text(p.delta, 100_000)).slice(0, 100_000);
    } else if (method === "serverRequest/resolved") {
      for (const [id, entry] of session.requests) if (entry.rpcId === p.requestId) session.requests.delete(id);
    } else if (method === "error") session.error = safeError(p.error);
    else return;
    this.emit("change", session.projectId);
  }

  #serverRequest({ id, method, params = {} }) {
    const session = this.#find(params.threadId);
    const requestId = randomUUID();
    const view = session && approvalView(method, params, requestId);
    if (!view) { this.client.reject(id); return; }
    session.requests.set(requestId, { rpcId: id, method, params, view });
    this.emit("change", session.projectId);
  }

  async close() { await this.client.close(); }
}
