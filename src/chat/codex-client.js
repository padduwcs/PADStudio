import { EventEmitter } from "node:events";
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function codexLaunch({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const explicit = env.PADSTUDIO_CODEX_PATH;
  if (explicit && /\.[cm]?js$/i.test(explicit)) return { command: process.execPath, prefix: [explicit] };
  if (explicit && !/\.cmd$/i.test(explicit)) return { command: explicit, prefix: [] };
  if (platform !== "win32") return { command: explicit || "codex", prefix: [] };
  const directories = explicit ? [dirname(explicit)] : String(env.PATH ?? env.Path ?? "").split(";").map((entry) => entry.replace(/^"|"$/g, "")).filter(Boolean);
  for (const directory of directories) {
    const executable = join(directory, "codex.exe");
    if (exists(executable)) return { command: executable, prefix: [] };
  }
  // npm's .cmd shim cannot be executed with shell:false on Windows. Invoke its JS entry point using Node instead.
  for (const directory of directories) {
    const entry = join(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (exists(entry)) return { command: process.execPath, prefix: [entry] };
  }
  return { command: explicit || "codex.exe", prefix: [] };
}

export class CodexConnectionError extends Error {
  constructor(message, code = "codex_unavailable") {
    super(message);
    this.name = "CodexConnectionError";
    this.code = code;
  }
}

// Only the backend speaks JSON-RPC. The browser never gets an arbitrary RPC or shell-command endpoint.
export class CodexClient extends EventEmitter {
  constructor({ cwd, env = process.env, command = null, args = null, spawnImpl = spawn, timeoutMs = 30_000 } = {}) {
    super();
    const launch = codexLaunch({ env });
    Object.assign(this, { cwd, env, command: command ?? launch.command,
      args: args ?? [...launch.prefix, "app-server", "--listen", "stdio://"], spawnImpl, timeoutMs });
    this.pending = new Map();
    this.nextId = 0;
    this.child = null;
    this.children = new Set();
    this.starting = null;
  }

  async start() {
    if (this.starting) return this.starting;
    this.starting = this.#start().catch(async (error) => {
      await this.close();
      this.starting = null;
      throw error;
    });
    return this.starting;
  }

  async #start() {
    const child = this.spawnImpl(this.command, this.args, {
      cwd: this.cwd, env: this.env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.children.add(child);
    child.once("close", () => this.children.delete(child));
    let buffer = "";
    // Do not forward stderr: it can contain configuration, account information or credentials.
    child.stderr?.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 32 * 1024 * 1024) {
        this.#disconnected(child, new CodexConnectionError("Phản hồi Codex quá lớn. Hãy kết nối lại.", "protocol_error"));
        child.kill();
        return;
      }
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
          if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid RPC envelope");
        } catch {
          this.#disconnected(child, new CodexConnectionError("Codex trả dữ liệu không hợp lệ. Hãy kiểm tra phiên bản Codex.", "protocol_error"));
          child.kill();
          return;
        }
        if (message.method) {
          this.emit(message.id === undefined ? "notification" : "serverRequest", message);
        } else if (message.id !== undefined) {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new CodexConnectionError(message.error.message || "Codex từ chối yêu cầu.", "rpc_error"));
          else pending.resolve(message.result);
        }
      }
    });
    child.stdin.on("error", () => {});
    child.once("error", (error) => this.#disconnected(child, new CodexConnectionError(
      error.code === "ENOENT" ? "Chưa tìm thấy Codex CLI. Cài Codex và mở lại PADStudio; hoặc đặt PADSTUDIO_CODEX_PATH tới chương trình Codex."
        : "Không khởi động được Codex. Hãy kiểm tra cài đặt Codex trên máy."
    )));
    child.once("exit", () => this.#disconnected(child, new CodexConnectionError("Codex đã ngắt kết nối. Bạn có thể kết nối lại để mở lại hội thoại.")));
    const initialized = await this.request("initialize", {
      clientInfo: { name: "padstudio", title: "PADStudio", version: "0.1.0" },
      capabilities: { experimentalApi: true }
    });
    this.notify("initialized", {});
    return initialized;
  }

  #disconnected(child, error) {
    if (this.child !== child) return;
    this.child = null;
    this.starting = null;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    this.emit("disconnect", error);
  }

  #write(message) {
    if (!this.child || this.child.stdin.destroyed) throw new CodexConnectionError("Codex chưa kết nối.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  request(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexConnectionError("Codex chưa trả lời yêu cầu. Hãy kiểm tra hội thoại trước khi gửi lại.", "rpc_timeout"));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try { this.#write({ id, method, params }); } catch (error) {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      }
    });
  }

  notify(method, params) { this.#write({ method, params }); }
  respond(id, result) { this.#write({ id, result }); }
  reject(id, message = "PADStudio chưa hỗ trợ yêu cầu này.") { this.#write({ id, error: { code: -32601, message } }); }

  async close() {
    if (this.child) this.#disconnected(this.child, new CodexConnectionError("Kết nối Codex đã đóng."));
    await Promise.all([...this.children].map((child) => this.#closeChild(child)));
  }

  async #closeChild(child) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (process.platform === "win32" && child.pid) {
          execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve());
        } else { child.kill(); resolve(); }
      }, 2_000);
      child.once("close", () => { clearTimeout(timer); resolve(); });
      if (!child.stdin.destroyed) child.stdin.end();
    });
  }
}
