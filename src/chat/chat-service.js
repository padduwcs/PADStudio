import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "../project/atomic-files.js";
import { CodexClient } from "./codex-client.js";
import { approvalAnswer, approvalView, ChatError, displayItem, externalUrl, safeError, text } from "./chat-protocol.js";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_ITEMS = 500;

export class ChatService extends EventEmitter {
  constructor({ cwd = applicationRoot, sessionRoot = join(cwd, ".padstudio", "chat", "workspace"), client = null } = {}) {
    super();
    this.cwd = resolve(cwd); this.sessionRoot = sessionRoot;
    this.workspaceKey = createHash("sha256").update(this.cwd).digest("hex").slice(0, 16);
    this.client = client ?? new CodexClient({ cwd: this.cwd });
    this.sessions = new Map(); this.loading = null; this.initialized = false;
    this.currentId = null; this.saving = Promise.resolve();
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
        if (session.active) session.error = "Kết nối Codex đã mất. Kiểm tra lịch sử trước khi yêu cầu chạy lại.";
        session.active = false; session.turnId = null; session.requests.clear();
      }
      this.emit("change");
    });
  }

  status() {
    return { connected: this.connected, authenticated: this.account?.authenticated ?? false, accountType: this.account?.type ?? null,
      workspace: { name: basename(this.cwd), path: this.cwd, key: this.workspaceKey }, models: this.models, login: this.login ? { url: this.login.url } : null, error: this.error };
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

  async #initialize() {
    if (this.loading) return this.loading;
    if (this.initialized) return;
    this.loading = (async () => {
      let saved = null;
      try { saved = JSON.parse(await readFile(join(this.sessionRoot, this.workspaceKey + ".json"), "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw new ChatError(500, "Không đọc được lịch sử chat đã lưu. Dữ liệu cũ được giữ nguyên.", "session_read_failed"); }
      if (saved && (saved.version !== "1.0" || saved.cwd !== this.cwd || !Array.isArray(saved.conversations) || !saved.conversations.length
        || saved.conversations.some((entry) => !entry || typeof entry.id !== "string" || !entry.id || !Array.isArray(entry.receipts)
          || (entry.threadId !== null && typeof entry.threadId !== "string"))
        || new Set(saved.conversations.map((entry) => entry.id)).size !== saved.conversations.length)) {
        throw new ChatError(500, "Lịch sử chat không đúng định dạng. Dữ liệu cũ được giữ nguyên.", "session_read_failed");
      }
      for (const entry of saved?.conversations ?? [{}]) { const session = this.#conversation(entry); this.sessions.set(session.id, session); }
      this.currentId = this.sessions.has(saved?.currentId) ? saved.currentId : this.sessions.keys().next().value;
      if (!saved) await this.#save(this.sessions.get(this.currentId));
      this.initialized = true;
    })();
    try { await this.loading; }
    catch (error) { this.sessions.clear(); throw error; }
    finally { this.loading = null; }
  }

  #conversation(entry = {}) {
    return { id: entry.id ?? randomUUID(), threadId: entry.threadId ?? null, model: entry.model ?? null,
      title: entry.title ?? "", startedAt: entry.startedAt ?? null, receipts: entry.receipts ?? [],
      items: [], requests: new Map(), active: false, turnId: null, loaded: false, busy: false, error: null, truncated: false };
  }

  async session(conversationId = null) {
    await this.#initialize();
    if (conversationId !== null && (typeof conversationId !== "string" || !conversationId)) throw new ChatError(400, "Mã hội thoại không hợp lệ.");
    const session = this.sessions.get(conversationId ?? this.currentId);
    if (!session) throw new ChatError(404, "Không tìm thấy hội thoại trong thư mục này.");
    return session;
  }

  async #save(session) {
    session.receipts = session.receipts.slice(-200);
    await mkdir(this.sessionRoot, { recursive: true });
    // Persist only client metadata. Codex owns the transcript, configuration and instructions.
    this.saving = this.saving.catch(() => {}).then(() => writeJsonAtomic(join(this.sessionRoot, this.workspaceKey + ".json"), {
      version: "1.0", cwd: this.cwd, currentId: this.currentId,
      conversations: [...this.sessions.values()].map((entry) => ({ id: entry.id, threadId: entry.threadId,
        model: entry.model, title: entry.title, startedAt: entry.startedAt, receipts: entry.receipts.slice(-200) }))
    }));
    await this.saving;
  }

  snapshot(session) {
    return { conversationId: session.id, hasConversation: Boolean(session.threadId), model: session.model, active: session.active,
      items: session.items.slice(-MAX_ITEMS), requests: [...session.requests.values()].map((entry) => entry.view), error: session.error,
      truncated: session.truncated || session.items.length > MAX_ITEMS,
      conversations: [...this.sessions.values()].map((entry) => ({ id: entry.id, title: entry.title || "Chat mới", current: entry.id === session.id,
        active: entry.active, waiting: entry.requests.size > 0, hasConversation: Boolean(entry.threadId), startedAt: entry.startedAt })) };
  }

  async read(conversationId = null) {
    const session = await this.session(conversationId);
    if (session.threadId && this.connected && !session.loaded && !session.busy) {
      session.busy = true;
      try { await this.#load(session); } finally { session.busy = false; }
    }
    return this.snapshot(session);
  }

  async #load(session) {
    const result = await this.client.request("thread/resume", { threadId: session.threadId });
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
    this.emit("change", session.id);
  }

  async send(conversationId, body = {}) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["message", "clientId", "model"].includes(key))) throw new ChatError(400, "Yêu cầu chat không hợp lệ.");
    const { message, clientId, model = null } = body;
    if (typeof message !== "string" || message.length > 32_000 || !message.trim()) throw new ChatError(400, "Nhập tin nhắn tối đa 32.000 ký tự.");
    if (typeof clientId !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(clientId)) throw new ChatError(400, "Mã tin nhắn không hợp lệ.");
    if (model !== null && (typeof model !== "string" || !this.models.some((entry) => entry.id === model))) throw new ChatError(400, "Model này chưa có trong danh sách Codex.");
    const session = await this.session(conversationId);
    const fingerprint = createHash("sha256").update(JSON.stringify({ message, model })).digest("hex");
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
      const input = [{ type: "text", text: message, text_elements: [] }];
      if (session.threadId && !session.loaded) await this.#load(session);
      if (session.active && model && model !== session.model) throw new ChatError(409, "Chờ lượt hiện tại kết thúc trước khi đổi model.");
      if (!session.threadId) {
        const result = await this.client.request("thread/start", { cwd: this.cwd, ...(model ? { model } : {}) });
        session.threadId = result.thread.id; session.loaded = true; session.model = result.model ?? model;
        session.title = message.trim().split("\n")[0].slice(0, 80) || "Cuộc trò chuyện mới";
        session.startedAt = new Date().toISOString();
        await this.#save(session);
      }
      if (session.requests.size) throw new ChatError(409, "Hãy trả lời yêu cầu đang chờ trong hội thoại trước.");
      const receipt = { id: clientId, fingerprint, threadId: session.threadId, status: "sending", at: new Date().toISOString() };
      session.receipts.push(receipt);
      await this.#save(session); // Before the RPC: an ambiguous network failure must never silently spend twice.
      const optimistic = { id: `client-${clientId}`, clientId, role: "user", kind: "message", text: message, status: "sending", turnId: session.turnId };
      session.items.push(optimistic); session.error = null;
      const wasActive = session.active;
      session.active = true; this.emit("change", session.id);
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
        this.emit("change", session.id);
        throw error;
      }
      this.emit("change", session.id);
      return { duplicate: false, session: this.snapshot(session) };
    } finally { session.busy = false; }
  }

  async interrupt(conversationId) {
    const session = await this.session(conversationId);
    if (session.busy || (session.active && !session.turnId)) throw new ChatError(409, "Đang gửi yêu cầu. Vui lòng chờ agent nhận xong.");
    if (session.active && session.turnId) await this.client.request("turn/interrupt", { threadId: session.threadId, turnId: session.turnId });
    return this.snapshot(session);
  }

  async answer(conversationId, requestId, value) {
    const session = await this.session(conversationId);
    const request = session.requests.get(requestId);
    if (!request) throw new ChatError(409, "Yêu cầu này đã được trả lời hoặc đã kết thúc. Hội thoại sẽ cập nhật lại.");
    const result = approvalAnswer(request, value);
    this.client.respond(request.rpcId, result);
    session.requests.delete(requestId); this.emit("change", session.id);
    return this.snapshot(session);
  }

  async newConversation() {
    await this.#initialize();
    const session = this.#conversation(); this.sessions.set(session.id, session); this.currentId = session.id;
    await this.#save(session); this.emit("change");
    return this.snapshot(session);
  }

  #find(threadId) { return threadId ? [...this.sessions.values()].find((session) => session.threadId === threadId) : null; }

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
      else if (p.turn.status === "interrupted") session.error = "Đã dừng lượt của Codex.";
    } else if (method === "item/started" || method === "item/completed") this.#upsert(session, p.item, p.turnId);
    else if (method === "item/agentMessage/delta") {
      let item = session.items.find((candidate) => candidate.id === p.itemId);
      if (!item) { item = { id: p.itemId, role: "assistant", kind: "message", text: "", turnId: p.turnId, status: "inProgress" }; session.items.push(item); }
      item.text = (item.text + text(p.delta, 100_000)).slice(0, 100_000);
    } else if (method === "serverRequest/resolved") {
      for (const [id, entry] of session.requests) if (entry.rpcId === p.requestId) session.requests.delete(id);
    } else if (method === "error") session.error = safeError(p.error);
    else return;
    this.emit("change", session.id);
  }

  #serverRequest({ id, method, params = {} }) {
    const session = this.#find(params.threadId);
    const requestId = randomUUID();
    const view = session && approvalView(method, params, requestId);
    if (!view) { this.client.reject(id); return; }
    session.requests.set(requestId, { rpcId: id, method, params, view });
    this.emit("change", session.id);
  }

  async close() { await this.client.close(); }
}
