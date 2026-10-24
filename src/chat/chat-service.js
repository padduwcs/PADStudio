import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "../project/atomic-files.js";
import { CodexClient } from "./codex-client.js";
import { ChatAttachments } from "./chat-attachments.js";
import { approvalAnswer, approvalView, ChatError, displayItem, externalUrl, safeError, text } from "./chat-protocol.js";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_ITEMS = 5000;

export class ChatService extends EventEmitter {
  constructor({ cwd = applicationRoot, sessionRoot = join(cwd, ".padstudio", "chat", "workspace"), client = null } = {}) {
    super();
    this.cwd = resolve(cwd); this.sessionRoot = resolve(sessionRoot);
    this.workspaceKey = createHash("sha256").update(this.cwd).digest("hex").slice(0, 16);
    this.attachments = new ChatAttachments(join(this.sessionRoot, "attachments", this.workspaceKey));
    this.client = client ?? new CodexClient({ cwd: this.cwd });
    this.sessions = new Map(); this.loading = null; this.initialized = false;
    this.currentId = null; this.saving = Promise.resolve();
    this.connected = false;
    this.account = null;
    this.models = [];
    this.modes = []; this.permissions = []; this.skills = []; this.rateLimits = null;
    this.knownThreads = new Map();
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
      workspace: { name: basename(this.cwd), path: this.cwd, key: this.workspaceKey }, models: this.models,
      modes: this.modes, permissions: this.permissions, skills: this.skills, rateLimits: this.rateLimits,
      login: this.login ? { url: this.login.url } : null, error: this.error };
  }

  async connect() {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.client.start();
      this.connected = true;
      await this.#account();
      const result = await this.client.request("model/list", { limit: 100 });
      this.models = (result.data ?? []).filter((model) => !model.hidden).map((model) => ({
        id: model.model, name: model.displayName || model.model, isDefault: model.isDefault === true,
        efforts: (model.supportedReasoningEfforts ?? []).map((entry) => entry.reasoningEffort), defaultEffort: model.defaultReasoningEffort,
        inputModalities: model.inputModalities ?? ["text", "image"]
      }));
      // Optional catalogs: old/custom Codex servers can still provide ordinary chat.
      const catalogs = await Promise.allSettled([
        this.client.request("collaborationMode/list", {}), this.client.request("permissionProfile/list", {}),
        this.client.request("skills/list", { cwds: [this.cwd] }), this.client.request("account/rateLimits/read", {})
      ]);
      this.modes = catalogs[0].status === "fulfilled" ? (catalogs[0].value.data ?? []).filter((entry) => ["default", "plan"].includes(entry.mode)).map(({ name, mode, model, reasoning_effort }) => ({ name, mode, model, effort: reasoning_effort })) : [];
      this.permissions = catalogs[1].status === "fulfilled" ? (catalogs[1].value.data ?? []).filter((entry) => entry.allowed).map(({ id, description }) => ({ id, description: text(description, 500) })) : [];
      this.skills = catalogs[2].status === "fulfilled" ? (catalogs[2].value.data ?? []).flatMap((entry) => entry.skills ?? []).filter((entry) => entry.enabled).map((entry) => ({ name: entry.name, path: entry.path, description: text(entry.interface?.shortDescription || entry.shortDescription || entry.description, 500) })) : [];
      if (catalogs[3].status === "fulfilled") this.#rates(catalogs[3].value);
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
      title: entry.title ?? "", startedAt: entry.startedAt ?? null, receipts: entry.receipts ?? [], archived: entry.archived === true,
      options: entry.options ?? {}, effective: {}, usage: null, cursor: null,
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
        model: entry.model, title: entry.title, archived: entry.archived, options: entry.options, startedAt: entry.startedAt, receipts: entry.receipts.slice(-200) }))
    }));
    await this.saving;
  }

  snapshot(session) {
    return { conversationId: session.id, hasConversation: Boolean(session.threadId), model: session.model, active: session.active,
      items: session.items.slice(-MAX_ITEMS), requests: [...session.requests.values()].map((entry) => entry.view), error: session.error,
      options: session.options, effective: session.effective, usage: session.usage, archived: session.archived, hasOlder: Boolean(session.cursor),
      truncated: session.truncated || session.items.length > MAX_ITEMS,
      conversations: [...this.sessions.values()].map((entry) => ({ id: entry.id, title: entry.title || "Chat mới", current: entry.id === session.id,
        active: entry.active, archived: entry.archived, waiting: entry.requests.size > 0, hasConversation: Boolean(entry.threadId), startedAt: entry.startedAt })) };
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
      turns = [...history.data].reverse(); session.cursor = history.nextCursor; session.truncated = Boolean(history.nextCursor);
    }
    session.items = turns.flatMap((turn) => turn.items.map((item) => displayItem(item, turn.id)).filter(Boolean)).slice(-MAX_ITEMS);
    const active = turns.findLast((turn) => turn.status === "inProgress");
    session.active = Boolean(active); session.turnId = active?.id ?? null; session.loaded = true;
    session.model = result.model ?? session.model;
    this.#effective(session, result);
    // A resumed failed/interrupted turn is never replayed automatically.
    const last = turns.at(-1);
    session.error = last?.status === "failed" ? safeError(last.error) : last?.status === "interrupted" ? "Lượt trước đã dừng. Bạn có thể gửi yêu cầu tiếp theo." : null;
    this.emit("change", session.id);
  }

  async send(conversationId, body = {}) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["message", "clientId", "model", "attachments", "references", "skills", "options"].includes(key))) throw new ChatError(400, "Yêu cầu chat không hợp lệ.");
    const { message, clientId, model = null, attachments = [], references = [], skills = [], options = {} } = body;
    if (![attachments, references, skills].every((entry) => Array.isArray(entry) && entry.length <= 10) || !options || typeof options !== "object" || Array.isArray(options)) throw new ChatError(400, "Tùy chọn tin nhắn không hợp lệ.");
    if (typeof message !== "string" || message.length > 32_000 || (!message.trim() && !attachments.length && !references.length && !skills.length)) throw new ChatError(400, "Nhập tin nhắn tối đa 32.000 ký tự hoặc chọn file.");
    if (typeof clientId !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(clientId)) throw new ChatError(400, "Mã tin nhắn không hợp lệ.");
    if (model !== null && typeof model !== "string") throw new ChatError(400, "Model không hợp lệ.");
    const session = await this.session(conversationId);
    const fingerprint = createHash("sha256").update(JSON.stringify({ message, model, attachments, references, skills, options })).digest("hex");
    const previous = session.receipts.find((entry) => entry.id === clientId);
    if (previous) {
      const legacy = !attachments.length && !references.length && !skills.length && !Object.keys(options).length && previous.fingerprint === createHash("sha256").update(JSON.stringify({ message, model })).digest("hex");
      if (previous.fingerprint !== fingerprint && !legacy) throw new ChatError(409, "Mã tin nhắn đã được dùng cho nội dung khác.");
      return { duplicate: true, session: this.snapshot(session) };
    }
    if (session.busy) throw new ChatError(409, "Hội thoại đang cập nhật. Vui lòng chờ một chút.");
    if (session.active && model && model !== session.model) throw new ChatError(409, "Chờ lượt hiện tại kết thúc trước khi đổi model.");
    session.busy = true;
    try {
      await this.connect();
      if (!this.account.authenticated) throw new ChatError(401, "Đăng nhập Codex để bắt đầu trò chuyện.", "login_required");
      if (model !== null && !this.models.some((entry) => entry.id === model)) throw new ChatError(400, "Model này chưa có trong danh sách Codex.");
      if (session.threadId && !session.loaded) await this.#load(session);
      let overrides = this.#options(options, model || session.model);
      if (session.archived) throw new ChatError(409, "Khôi phục hội thoại trước khi gửi tin nhắn.");
      if (session.active && Object.keys(options).length) throw new ChatError(409, "Chờ lượt hiện tại kết thúc trước khi đổi thiết lập.");
      const input = message ? [{ type: "text", text: message, text_elements: [] }] : [];
      const selectedFiles = await Promise.all(attachments.map((id) => this.attachments.get(id)));
      for (const file of selectedFiles) input.push(file.kind === "image" ? { type: "localImage", path: file.path } : { type: "text", text: file.path, text_elements: [] });
      for (const path of references) {
        if (typeof path !== "string" || !isAbsolute(path) || path.length > 2000) throw new ChatError(400, "Đường dẫn tham chiếu không hợp lệ.");
        const rel = relative(this.cwd, path), actual = await realpath(path).catch(() => null);
        if (!rel || rel.startsWith("..") || isAbsolute(rel) || !actual || relative(this.cwd, actual).startsWith("..") || isAbsolute(relative(this.cwd, actual)) || !(await stat(actual)).isFile()) throw new ChatError(400, "File tham chiếu phải nằm trong thư mục làm việc.");
        input.push({ type: "text", text: path, text_elements: [] });
      }
      for (const name of skills) {
        const skill = this.skills.find((entry) => entry.name === name);
        if (!skill) throw new ChatError(400, "Skill không có trong danh sách Codex.");
        input.push({ type: "skill", name: skill.name, path: skill.path });
      }
      if (session.active && model && model !== session.model) throw new ChatError(409, "Chờ lượt hiện tại kết thúc trước khi đổi model.");
      if (!session.threadId) {
        const result = await this.client.request("thread/start", { cwd: this.cwd, ...(model ? { model } : {}) });
        session.threadId = result.thread.id; session.loaded = true; session.model = result.model ?? model;
        this.#effective(session, result);
        session.title ||= message.trim().split("\n")[0].slice(0, 80) || selectedFiles[0]?.name || "Cuộc trò chuyện mới";
        session.startedAt = new Date().toISOString();
        await this.#save(session);
      }
      // A fresh thread may inherit a configured model different from the catalog default.
      // Selecting a mode must retain that actual native model unless the user selected another.
      if (options.mode) overrides = this.#options(options, model || session.model);
      if (session.requests.size) throw new ChatError(409, "Hãy trả lời yêu cầu đang chờ trong hội thoại trước.");
      const receipt = { id: clientId, fingerprint, threadId: session.threadId, status: "sending", at: new Date().toISOString() };
      session.receipts.push(receipt);
      await this.#save(session); // Before the RPC: an ambiguous network failure must never silently spend twice.
      const optimistic = { id: `client-${clientId}`, clientId, role: "user", kind: "message", text: message, attachments: selectedFiles.map(({ id, name, kind }) => ({ id, name, kind })), status: "sending", turnId: session.turnId };
      session.items.push(optimistic); session.error = null;
      const wasActive = session.active;
      session.active = true; this.emit("change", session.id);
      try {
        const result = await this.client.request(wasActive ? "turn/steer" : "turn/start", {
          threadId: session.threadId, input, clientUserMessageId: clientId,
          ...(wasActive ? { expectedTurnId: session.turnId } : { ...(model ? { model } : {}), ...overrides })
        });
        receipt.status = "sent"; receipt.turnId = result.turn?.id ?? result.turnId;
        if (session.active) session.turnId = receipt.turnId ?? session.turnId;
        optimistic.status = "completed";
        if (model) session.model = model;
        if (!wasActive) {
          session.options = { ...session.options, ...options };
          session.effective = { ...session.effective, ...options };
        }
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

  #options(options, model) {
    if (Object.keys(options).some((key) => !["effort", "mode", "permissions"].includes(key))) throw new ChatError(400, "Thiết lập Codex không hợp lệ.");
    if (Object.values(options).some((value) => typeof value !== "string" || !value || value.length > 200)) throw new ChatError(400, "Giá trị thiết lập Codex không hợp lệ.");
    const result = {};
    if (options.effort) {
      const entry = this.models.find((entry) => entry.id === model) ?? this.models.find((entry) => entry.isDefault);
      if (!entry?.efforts.includes(options.effort)) throw new ChatError(400, "Model không hỗ trợ mức suy luận này.");
      result.effort = options.effort;
    }
    if (options.permissions) {
      if (!this.permissions.some((entry) => entry.id === options.permissions)) throw new ChatError(400, "Quyền này không được Codex cho phép.");
      result.permissions = options.permissions;
    }
    if (options.mode) {
      const preset = this.modes.find((entry) => entry.mode === options.mode);
      if (!preset) throw new ChatError(400, "Chế độ này không có trong phiên bản Codex đang dùng.");
      result.collaborationMode = { mode: preset.mode, settings: {
        model: model || preset.model || this.models.find((entry) => entry.isDefault)?.id,
        reasoning_effort: options.effort || preset.effort || null, developer_instructions: null
      } };
    }
    return result;
  }

  #effective(session, result) {
    session.effective = { effort: result.reasoningEffort ?? null, mode: result.collaborationMode?.mode ?? null,
      permissions: result.activePermissionProfile?.id ?? null, approvalPolicy: typeof result.approvalPolicy === "string" ? result.approvalPolicy : null };
  }

  #rates(value) {
    const rates = value.rateLimits;
    if (!rates) return;
    const window = (entry) => entry && Number.isFinite(entry.usedPercent) ? {
      usedPercent: entry.usedPercent, windowDurationMins: entry.windowDurationMins, resetsAt: entry.resetsAt
    } : null;
    this.rateLimits = { primary: window(rates.primary), secondary: window(rates.secondary) };
  }

  async history({ query = "", cursor = null, archived = false } = {}) {
    if (typeof query !== "string" || query.length > 200 || (cursor !== null && (typeof cursor !== "string" || cursor.length > 2000)) || typeof archived !== "boolean") throw new ChatError(400, "Bộ lọc lịch sử không hợp lệ.");
    await this.connect();
    const result = await this.client.request("thread/list", { cwd: this.cwd, limit: 30, sortKey: "updated_at", sortDirection: "desc", archived,
      ...(query ? { searchTerm: query } : {}), ...(cursor ? { cursor } : {}) });
    const data = [];
    for (const thread of result.data ?? []) {
      if (resolve(thread.cwd) !== this.cwd) continue;
      this.knownThreads.set(thread.id, { ...thread, archived });
      data.push({ threadId: thread.id, title: text(thread.name || thread.preview || "Hội thoại Codex", 200), archived,
        updatedAt: thread.updatedAt, source: typeof thread.source === "string" ? thread.source : "agent" });
    }
    return { data, nextCursor: result.nextCursor ?? null };
  }

  async resume(threadId) {
    await this.#initialize(); await this.connect();
    const existing = this.#find(threadId);
    if (existing) return this.read(existing.id);
    const metadata = this.knownThreads.get(threadId);
    if (!metadata) throw new ChatError(400, "Hãy chọn hội thoại từ lịch sử Codex của thư mục này.");
    if (metadata.archived) throw new ChatError(409, "Khôi phục hội thoại đã lưu trữ trước.");
    const session = this.#conversation({ threadId, title: text(metadata.name || metadata.preview, 80), startedAt: new Date(metadata.createdAt * 1000).toISOString() });
    session.busy = true; this.sessions.set(session.id, session);
    try { await this.#load(session); } catch (error) { this.sessions.delete(session.id); throw error; } finally { session.busy = false; }
    this.currentId = session.id;
    await this.#save(session); this.emit("change"); return this.snapshot(session);
  }

  async restoreThread(threadId) {
    if (!this.knownThreads.has(threadId)) throw new ChatError(400, "Hãy chọn hội thoại từ lịch sử.");
    await this.connect(); await this.client.request("thread/unarchive", { threadId });
    this.knownThreads.get(threadId).archived = false;
    const linked = this.#find(threadId);
    if (linked) { linked.archived = false; await this.#save(linked); }
    return this.resume(threadId);
  }

  async changeConversation(id, action, body = {}) {
    const session = await this.session(id);
    if (session.busy || session.active || session.requests.size) throw new ChatError(409, "Chờ hoặc dừng lượt đang chạy trước khi thay đổi hội thoại.");
    session.busy = true;
    try {
      if (session.threadId && !session.loaded) { await this.connect(); await this.#load(session); }
      if (session.active || session.requests.size) throw new ChatError(409, "Chờ hoặc dừng lượt đang chạy trước khi thay đổi hội thoại.");
      if (action === "rename") {
        if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) throw new ChatError(400, "Tên hội thoại cần từ 1 đến 120 ký tự.");
        if (session.threadId) { await this.connect(); await this.client.request("thread/name/set", { threadId: session.threadId, name: body.name.trim() }); }
        session.title = body.name.trim();
      } else if (action === "archive" || action === "unarchive") {
        if (session.threadId) { await this.connect(); await this.client.request("thread/" + action, { threadId: session.threadId }); }
        session.archived = action === "archive";
      } else if (action === "fork") {
        if (!session.threadId || session.archived) throw new ChatError(409, "Mở một hội thoại có nội dung để phân nhánh.");
        await this.connect(); if (!session.loaded) await this.#load(session);
        const point = body.beforeTurnId;
        if (point !== undefined && (typeof point !== "string" || !session.items.some((entry) => entry.turnId === point))) throw new ChatError(400, "Mốc phân nhánh không còn trong phần lịch sử đang xem.");
        const result = await this.client.request("thread/fork", { threadId: session.threadId, ...(point ? { beforeTurnId: point } : {}) });
        const fork = this.#conversation({ threadId: result.thread.id, title: session.title + " · Nhánh", model: result.model ?? session.model, options: { ...session.options }, startedAt: new Date().toISOString() });
        fork.busy = true; this.sessions.set(fork.id, fork);
        try { await this.#load(fork); } catch (error) { this.sessions.delete(fork.id); throw error; } finally { fork.busy = false; }
        this.currentId = fork.id;
        await this.#save(fork); this.emit("change"); return this.snapshot(fork);
      } else if (action === "compact") {
        if (!session.threadId || session.archived) throw new ChatError(409, "Hội thoại chưa có nội dung hoặc đã lưu trữ.");
        await this.connect(); if (!session.loaded) await this.#load(session);
        await this.client.request("thread/compact/start", { threadId: session.threadId });
      } else throw new ChatError(400, "Thao tác hội thoại không hợp lệ.");
      await this.#save(session); this.emit("change"); return this.snapshot(session);
    } finally { session.busy = false; }
  }

  async older(id) {
    const session = await this.session(id);
    if (!session.cursor) return this.snapshot(session);
    if (session.busy) throw new ChatError(409, "Đang tải lịch sử.");
    session.busy = true;
    try {
      const result = await this.client.request("thread/turns/list", { threadId: session.threadId, cursor: session.cursor, limit: 25, sortDirection: "desc", itemsView: "full" });
      const previous = [...result.data].reverse().flatMap((turn) => (turn.items ?? []).map((item) => displayItem(item, turn.id)).filter(Boolean));
      const existing = new Set(session.items.map((item) => item.id));
      const items = [...previous.filter((item) => !existing.has(item.id)), ...session.items];
      // Older pages are explicit user requests. Bound a view to 5,000 items, not the initial 500.
      if (items.length > MAX_ITEMS) throw new ChatError(409, "Đã tải 5.000 mục. Xuất hội thoại để đọc toàn bộ lịch sử.");
      session.items = items;
      session.cursor = result.nextCursor; session.truncated = Boolean(result.nextCursor);
      this.emit("change", id); return this.snapshot(session);
    } finally { session.busy = false; }
  }

  async searchFiles(query) {
    if (typeof query !== "string" || !query.trim() || query.length > 200) return [];
    await this.connect();
    const result = await this.client.request("fuzzyFileSearch", { query, roots: [this.cwd] });
    const data = [];
    for (const file of (result.files ?? []).slice(0, 40)) {
      const path = resolve(file.root || this.cwd, file.path);
      const rel = relative(this.cwd, path);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
      const actual = await realpath(path).catch(() => null);
      if (!actual || relative(this.cwd, actual).startsWith("..") || isAbsolute(relative(this.cwd, actual))) continue;
      data.push({ name: rel, path });
    }
    return data;
  }

  async exportConversation(id) {
    const session = await this.session(id);
    if (!session.threadId) return { title: session.title || "Chat mới", items: [] };
    await this.connect();
    const result = await this.client.request("thread/read", { threadId: session.threadId, includeTurns: true });
    let turns = result.thread.turns ?? [];
    if (result.thread.historyMode === "paginated") {
      turns = []; let cursor;
      do {
        const page = await this.client.request("thread/turns/list", { threadId: session.threadId, limit: 100, sortDirection: "desc", itemsView: "full", ...(cursor ? { cursor } : {}) });
        turns.push(...page.data); cursor = page.nextCursor;
        if (turns.length > 10_000) throw new ChatError(413, "Hội thoại quá lớn để xuất một lần.");
      } while (cursor);
      turns.reverse();
    }
    return { title: session.title, items: turns.flatMap((turn) => (turn.items ?? []).map((item) => displayItem(item, turn.id)).filter(Boolean)) };
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
    if (method === "account/rateLimits/updated") { this.#rates(p); this.emit("change"); return; }
    if (method === "account/login/completed" || method === "account/updated") {
      if (method === "account/login/completed") { this.login = null; this.error = p.success ? null : text(p.error) || "Đăng nhập chưa hoàn tất."; }
      this.#account().then(() => this.emit("change")).catch((error) => { this.error = safeError(error); this.emit("change"); });
      return;
    }
    const session = this.#find(p.threadId);
    if (!session) return;
    if (method === "thread/name/updated") { session.title = text(p.threadName, 120); this.#save(session).catch(() => {}); }
    else if (method === "thread/tokenUsage/updated") {
      const usage = p.tokenUsage;
      session.usage = { total: usage?.total?.totalTokens ?? null, last: usage?.last?.totalTokens ?? null, contextWindow: usage?.modelContextWindow ?? null };
    }
    else if (method === "turn/started") { session.turnId = p.turn.id; session.active = true; session.error = null; }
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
    } else if (["item/commandExecution/outputDelta", "item/reasoning/summaryTextDelta", "item/plan/delta"].includes(method)) {
      let item = session.items.find((entry) => entry.id === p.itemId);
      if (!item && method === "item/reasoning/summaryTextDelta") {
        item = { id: p.itemId, turnId: p.turnId, role: "tool", kind: "summary", text: "Tóm tắt suy luận", output: "", status: "inProgress" }; session.items.push(item);
      }
      if (item) {
        const key = method === "item/plan/delta" ? "text" : "output";
        item[key] = ((item[key] || "") + text(p.delta, 100_000)).slice(-100_000);
      }
    } else if (method === "turn/plan/updated") {
      const id = "plan-" + p.turnId;
      const plan = { id, turnId: p.turnId, role: "tool", kind: "plan", text: "Kế hoạch", output: [text(p.explanation, 2000), ...(p.plan ?? []).map((step) => `${step.status === "completed" ? "✓" : step.status === "inProgress" ? "→" : "○"} ${text(step.step, 1000)}`)].filter(Boolean).join("\n") };
      const index = session.items.findIndex((entry) => entry.id === id); if (index >= 0) session.items[index] = plan; else session.items.push(plan);
    } else if (method === "turn/diff/updated") {
      const id = "diff-" + p.turnId; const diff = { id, turnId: p.turnId, role: "tool", kind: "files", text: "Thay đổi trong lượt này", output: text(p.diff, 100_000) };
      const index = session.items.findIndex((entry) => entry.id === id); if (index >= 0) session.items[index] = diff; else session.items.push(diff);
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
