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
      for (const project of this.sessions.values()) for (const session of project.conversations.values()) {
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

  async #project(projectId) {
    validateProjectId(projectId);
    await this.store.readProject(projectId).catch((error) => {
      if (error instanceof StoredProjectNotFoundError) throw new ChatError(404, "Không tìm thấy dự án.", "project_not_found");
      throw error;
    });
    if (this.loading.has(projectId)) return this.loading.get(projectId);
    if (this.sessions.has(projectId)) return this.sessions.get(projectId);
    const load = (async () => {
      let saved = null;
      try { saved = JSON.parse(await readFile(this.#path(projectId), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw new ChatError(500, "Không đọc được liên kết hội thoại đã lưu. Dữ liệu cũ được giữ nguyên.", "session_read_failed"); }
      if (saved && (saved.projectId !== projectId || !["1.0", "2.0"].includes(saved.version)
        || (saved.version === "1.0" && saved.threadId !== null && typeof saved.threadId !== "string")
        || (saved.version === "2.0" && (!Array.isArray(saved.conversations) || !saved.conversations.length
          || saved.conversations.some((entry) => !entry || typeof entry.id !== "string" || (entry.threadId !== null && typeof entry.threadId !== "string"))
          || new Set(saved.conversations.map((entry) => entry.id)).size !== saved.conversations.length)))) {
        throw new ChatError(500, "Liên kết hội thoại không đúng định dạng. Dữ liệu cũ được giữ nguyên.", "session_read_failed");
      }
      // Version 1 kept a mutable current thread. Migrate every linked thread, without copying transcripts.
      const entries = saved?.version === "2.0" ? saved.conversations : [
        { id: saved?.threadId ?? randomUUID(), threadId: saved?.threadId ?? null, model: saved?.model,
          title: saved?.title, startedAt: saved?.startedAt, receipts: (saved?.receipts ?? []).filter((receipt) => receipt.threadId === saved?.threadId) },
        ...(saved?.previousThreads ?? []).map((entry) => ({ id: typeof entry === "string" ? entry : entry.id,
          threadId: typeof entry === "string" ? entry : entry.id, title: entry.title, startedAt: entry.at,
          receipts: (saved?.receipts ?? []).filter((receipt) => receipt.threadId === (entry.id ?? entry)) }))
      ];
      const project = { projectId, currentId: saved?.currentId ?? entries[0].id, conversations: new Map(), saving: Promise.resolve() };
      for (const entry of entries) {
        if (project.conversations.has(entry.id)) continue;
        project.conversations.set(entry.id, this.#conversation(projectId, entry));
      }
      if (!project.conversations.has(project.currentId)) project.currentId = entries[0].id;
      this.sessions.set(projectId, project);
      // Even a blank tab needs a durable ID: browser tabs may outlive a server restart.
      if (saved?.version !== "2.0") await this.#save(project.conversations.get(project.currentId));
      return project;
    })();
    this.loading.set(projectId, load);
    try { return await load; }
    catch (error) { this.sessions.delete(projectId); throw error; }
    finally { this.loading.delete(projectId); }
  }

  #conversation(projectId, entry = {}) {
    return { projectId, id: entry.id ?? randomUUID(), threadId: entry.threadId ?? null, model: entry.model ?? null,
      title: entry.title ?? "", startedAt: entry.startedAt ?? null, receipts: entry.receipts ?? [],
      items: [], requests: new Map(), active: false, turnId: null, loaded: false, busy: false, error: null, truncated: false };
  }

  async session(projectId, conversationId = null) {
    const project = await this.#project(projectId);
    if (conversationId !== null && (typeof conversationId !== "string" || !conversationId)) throw new ChatError(400, "Mã hội thoại không hợp lệ.");
    const session = conversationId ? project.conversations.get(conversationId)
      ?? [...project.conversations.values()].find((entry) => entry.threadId === conversationId) : project.conversations.get(project.currentId);
    if (!session) throw new ChatError(404, "Hội thoại không thuộc dự án này.");
    return session;
  }

  async #save(session) {
    const project = this.sessions.get(session.projectId);
    session.receipts = session.receipts.slice(-200);
    await mkdir(this.sessionRoot, { recursive: true });
    // Independent tabs can save concurrently. Serialize the metadata write, taking a fresh snapshot each time.
    project.saving = project.saving.catch(() => {}).then(() => writeJsonAtomic(this.#path(session.projectId), {
      version: "2.0", projectId: session.projectId, currentId: project.currentId,
      conversations: [...project.conversations.values()].map((entry) => ({ id: entry.id, threadId: entry.threadId,
        model: entry.model, title: entry.title, startedAt: entry.startedAt, receipts: entry.receipts.slice(-200) }))
    }));
    await project.saving;
  }

  snapshot(session) {
    return { projectId: session.projectId, conversationId: session.id, hasConversation: Boolean(session.threadId), model: session.model, active: session.active,
      items: session.items.slice(-MAX_ITEMS), requests: [...session.requests.values()].map((entry) => entry.view), error: session.error,
      truncated: session.truncated || session.items.length > MAX_ITEMS,
      conversations: [...this.sessions.get(session.projectId).conversations.values()].map((entry) => ({
        id: entry.id, title: entry.title || "Chat mới", current: entry.id === session.id,
        active: entry.active, waiting: entry.requests.size > 0, hasConversation: Boolean(entry.threadId), startedAt: entry.startedAt
      })) };
  }

  async read(projectId, conversationId = null) {
    const session = await this.session(projectId, conversationId);
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

  async send(projectId, { message, clientId, conversationId = null, model = null, attachments = [], anchor = null } = {}) {
    if (!Array.isArray(attachments) || attachments.length > 12 || attachments.some((id) => typeof id !== "string")) throw new ChatError(400, "Danh sách tư liệu không hợp lệ.");
    if (typeof message !== "string" || message.length > 32_000 || (!message.trim() && !attachments.length)) throw new ChatError(400, "Nhập tin nhắn tối đa 32.000 ký tự hoặc đính kèm tư liệu.");
    if (typeof clientId !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(clientId)) throw new ChatError(400, "Mã tin nhắn không hợp lệ.");
    if (model !== null && (typeof model !== "string" || !this.models.some((entry) => entry.id === model))) throw new ChatError(400, "Model này chưa có trong danh sách Codex.");
    const session = await this.session(projectId, conversationId);
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

  async interrupt(projectId, conversationId = null) {
    const session = await this.session(projectId, conversationId);
    if (session.busy || (session.active && !session.turnId)) throw new ChatError(409, "Đang gửi yêu cầu. Vui lòng chờ agent nhận xong.");
    if (session.active && session.turnId) await this.client.request("turn/interrupt", { threadId: session.threadId, turnId: session.turnId });
    return this.snapshot(session);
  }

  async answer(projectId, requestId, value) {
    const session = await this.session(projectId, value?.conversationId);
    const request = session.requests.get(requestId);
    if (!request) throw new ChatError(409, "Yêu cầu này đã được trả lời hoặc đã kết thúc. Hội thoại sẽ cập nhật lại.");
    const result = approvalAnswer(request, value);
    this.client.respond(request.rpcId, result);
    session.requests.delete(requestId); this.emit("change", projectId);
    return this.snapshot(session);
  }

  async newConversation(projectId) {
    const project = await this.#project(projectId);
    const session = this.#conversation(projectId);
    project.conversations.set(session.id, session); project.currentId = session.id;
    await this.#save(session); this.emit("change", projectId);
    return this.snapshot(session);
  }

  #find(threadId) {
    if (!threadId) return null;
    for (const project of this.sessions.values()) for (const session of project.conversations.values()) if (session.threadId === threadId) return session;
    return null;
  }

  async selectConversation(projectId, conversationId) {
    const session = await this.session(projectId, conversationId);
    // Compatibility for existing clients; explicit conversation IDs keep different browser windows isolated.
    const result = await this.read(projectId, session.id);
    this.sessions.get(projectId).currentId = session.id;
    await this.#save(session);
    return result;
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
