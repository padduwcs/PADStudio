// Deterministic protocol peer for chat tests. No model calls, no network and no command execution.
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export class FixtureCodex extends EventEmitter {
  constructor({ threads = new Map(), automatic = false, authenticated = true } = {}) {
    super(); Object.assign(this, { threads, automatic, authenticated });
    this.calls = []; this.responses = []; this.rejections = []; this.timers = new Set(); this.nextRequest = 100; this.waitingRequests = new Map();
  }
  async start() { if (this.failStart) throw new Error("Codex thử nghiệm không khởi động được"); return {}; }
  notify(method, params) { this.emit("notification", { method, params }); }
  async request(method, params = {}) {
    this.calls.push({ method, params });
    if (method === "account/read") return { account: this.authenticated ? { type: "chatgpt", email: "private@example.test", accessToken: "NEVER_SHOW_TOKEN" } : null, requiresOpenaiAuth: true };
    if (method === "model/list") return { data: [{ model: "fixture-model", displayName: "Codex thử nghiệm", isDefault: true, hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], defaultReasoningEffort: "low" }] };
    if (method === "collaborationMode/list") return { data: [{ name: "Plan", mode: "plan", model: "fixture-model", reasoning_effort: "high" }, { name: "Default", mode: "default", model: "fixture-model", reasoning_effort: "low" }] };
    if (method === "permissionProfile/list") return { data: [{ id: ":read-only", allowed: true }, { id: ":workspace", allowed: true }, { id: ":danger-full-access", allowed: false }] };
    if (method === "skills/list") return { data: [{ cwd: params.cwds[0], skills: [{ name: "fixture-skill", path: "C:/fixture/SKILL.md", description: "A skill", enabled: true }] }] };
    if (method === "account/rateLimits/read") return { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1800000000 }, accountId: "PRIVATE" } };
    if (method === "fuzzyFileSearch") return { files: this.files || [] };
    if (method === "thread/list") {
      const data = [...this.threads.values()].filter((entry) => entry.cwd === params.cwd && Boolean(entry.archived) === Boolean(params.archived) && (!params.searchTerm || (entry.name || entry.preview || "").includes(params.searchTerm)));
      const offset = Number(params.cursor || 0), limit = params.limit || 30;
      return { data: structuredClone(data.slice(offset, offset + limit)), nextCursor: data.length > offset + limit ? String(offset + limit) : null };
    }
    if (method === "account/login/start") return { type: "chatgpt", authUrl: "https://auth.openai.com/authorize?fixture=1", loginId: "private-login-id" };
    if (method === "account/login/cancel") return {};
    if (method === "thread/start") {
      const thread = { id: randomUUID(), cwd: params.cwd, source: "appServer", createdAt: Math.floor(Date.now()/1000), updatedAt: Math.floor(Date.now()/1000), turns: [], historyMode: "legacy", model: params.model ?? "fixture-model" };
      this.threads.set(thread.id, thread); return { thread, model: thread.model };
    }
    const thread = this.threads.get(params.threadId);
    if (!thread) throw new Error("Thread not found");
    if (method === "thread/resume") return { thread: structuredClone(thread), model: thread.model };
    if (method === "thread/read") return { thread: structuredClone(thread) };
    if (method === "thread/name/set") { thread.name = params.name; return {}; }
    if (method === "thread/archive" || method === "thread/unarchive") { thread.archived = method === "thread/archive"; return { thread }; }
    if (method === "thread/fork") {
      const fork = structuredClone(thread); fork.id = randomUUID();
      if (params.beforeTurnId) fork.turns = fork.turns.slice(0, fork.turns.findIndex((turn) => turn.id === params.beforeTurnId));
      this.threads.set(fork.id, fork); return { thread: structuredClone(fork), model: fork.model };
    }
    if (method === "thread/compact/start") return {};
    if (method === "thread/turns/list") {
      const offset = Number(params.cursor || 0), limit = params.limit || 50; const data = [...thread.turns].reverse();
      return { data: structuredClone(data.slice(offset, offset + limit)), nextCursor: data.length > offset + limit ? String(offset + limit) : null };
    }
    if (method === "turn/start" || method === "turn/steer") {
      if (this.failSend) throw new Error("Kết nối bị ngắt sau khi nhận yêu cầu");
      let turn = thread.turns.findLast((entry) => entry.status === "inProgress");
      if (!turn || method === "turn/start") {
        turn = { id: randomUUID(), status: "inProgress", items: [] }; thread.turns.push(turn);
        this.notify("turn/started", { threadId: thread.id, turn: structuredClone(turn) });
      }
      const item = { type: "userMessage", id: randomUUID(), clientId: params.clientUserMessageId, content: params.input };
      turn.items.push(item); this.notify("item/completed", { threadId: thread.id, turnId: turn.id, item });
      if (this.automatic && method === "turn/start") {
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          const message = params.input.find((entry) => entry.type === "text")?.text || "";
          if (message.includes("[approval]")) this.ask(thread.id, "item/commandExecution/requestApproval", { command: "node render-preview.js", reason: "Dựng bản xem thử trên máy" });
          else if (message.includes("[question]")) this.ask(thread.id, "item/tool/requestUserInput", {
            questions: [{ id: "style", header: "Phong cách", question: "Bạn chọn phong cách nào?", options: [
              { label: "Nhẹ nhàng", description: "Chuyển động chậm và rõ" }, { label: "Nhanh", description: "Nhịp nhanh" }
            ] }]
          });
          else if (!message.includes("[wait]")) this.complete(thread.id, "Đã nhận ý tưởng của bạn. **Chúng ta sẽ làm từng phần.**\n\n- Xem tư liệu\n- Dựng bản xem thử\n\n```js\nconst title = 'Xin chào';\n```\n\n<img src=x onerror=alert(1)> [Liên kết xấu](javascript:alert)");
        }, 100);
        this.timers.add(timer);
      }
      return method === "turn/steer" ? { turnId: turn.id } : { turn: { id: turn.id, status: turn.status, items: [] } };
    }
    if (method === "turn/interrupt") { this.complete(thread.id, null, "interrupted"); return {}; }
    throw new Error("Unsupported fixture RPC: " + method);
  }
  complete(threadId, text = "Đã hoàn tất.", status = "completed") {
    const thread = this.threads.get(threadId); const turn = thread.turns.at(-1);
    if (text) {
      const item = { type: "agentMessage", id: randomUUID(), text };
      this.notify("item/started", { threadId, turnId: turn.id, item: { ...item, text: "" } });
      this.notify("item/agentMessage/delta", { threadId, turnId: turn.id, itemId: item.id, delta: text.slice(0, 12) });
      this.notify("item/agentMessage/delta", { threadId, turnId: turn.id, itemId: item.id, delta: text.slice(12) });
      turn.items.push(item); this.notify("item/completed", { threadId, turnId: turn.id, item });
    }
    turn.status = status; this.notify("turn/completed", { threadId, turn: structuredClone(turn) });
  }
  ask(threadId, method, params = {}) {
    const thread = this.threads.get(threadId); const id = ++this.nextRequest;
    const value = { id, method, params: { threadId, turnId: thread.turns.at(-1)?.id, itemId: "fixture-item", ...params } };
    this.waitingRequests.set(id, value); this.emit("serverRequest", value); return value;
  }
  respond(id, result) {
    this.responses.push({ id, result });
    const waiting = this.waitingRequests.get(id); this.waitingRequests.delete(id);
    if (this.automatic && waiting) {
      this.complete(waiting.params.threadId, result.answers ? "Đã ghi nhận lựa chọn: " + Object.values(result.answers).flatMap((value) => value.answers).join(", ") : result.decision === "accept" ? "Bạn đã cho phép thao tác." : "Đã từ chối thao tác.");
    }
  }
  reject(id) { this.rejections.push(id); }
  async close() { for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }
}
