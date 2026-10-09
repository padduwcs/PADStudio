// A minimal Chrome DevTools Protocol client for UI acceptance runs. No dependencies: Node's global WebSocket,
// a throw-away browser profile and a handful of helpers. It only ever drives a browser it launched itself.
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CANDIDATES = [
  process.env.PADSTUDIO_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);

export function findBrowser(explicit = null) {
  const path = [explicit, ...CANDIDATES].filter(Boolean).find((candidate) => existsSync(candidate));
  if (!path) throw new Error("Không tìm thấy Chrome hoặc Edge. Đặt PADSTUDIO_CHROME_PATH hoặc truyền --browser.");
  return path;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function killTree(pid) {
  return new Promise((resolve) => {
    if (process.platform === "win32") execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    else { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } resolve(); }
  });
}

export class Page {
  #socket; #nextId = 0; #pending = new Map(); #listeners = new Map();
  errors = []; writes = []; failed = []; consoleErrors = [];

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const waiter = this.#pending.get(message.id);
        if (!waiter) return;
        this.#pending.delete(message.id);
        if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
        else waiter.resolve(message.result);
      } else {
        for (const handler of this.#listeners.get(message.method) ?? []) handler(message.params);
      }
    });
    this.on("Runtime.exceptionThrown", (params) => this.errors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "exception"));
    this.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") this.consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    });
    this.on("Network.requestWillBeSent", (params) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(params.request.method)) this.writes.push(`${params.request.method} ${params.request.url}`);
    });
    this.on("Network.responseReceived", (params) => {
      if (params.response.status >= 400) this.failed.push(`${params.response.status} ${params.response.url}`);
    });
  }

  on(method, handler) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, { timeout = 30_000 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      try {
        const response = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (response.exceptionDetails) {
          throw new Error("Browser script failed: " + (response.exceptionDetails.exception?.description ?? response.exceptionDetails.text));
        }
        return response.result.value;
      } catch (error) {
        const pending = /Cannot find default execution context|Execution context was destroyed/.test(error.message);
        if (!pending || Date.now() > deadline) throw error;
        await sleep(100);
      }
    }
  }

  async waitFor(expression, { timeout = 15_000, interval = 100, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await this.evaluate(`Boolean(${expression})`).catch(() => false);
      if (value) return true;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
      await sleep(interval);
    }
  }

  async goto(url) {
    this.errors.length = 0;
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'", { timeout: 20_000, label: "page load" });
  }

  async viewport(width, height = 900, { mobile = false } = {}) {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  }

  async media(features) {
    await this.send("Emulation.setEmulatedMedia", { features });
  }

  async screenshot(path) {
    await mkdir(dirname(path), { recursive: true });
    const shot = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path, Buffer.from(shot.data, "base64"));
    return path;
  }

  async offline(value) {
    await this.send("Network.emulateNetworkConditions", { offline: value, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
}

export async function launchBrowser({ browserPath = null, width = 1440, height = 900, headless = true } = {}) {
  const executable = findBrowser(browserPath);
  const profile = await mkdtemp(join(tmpdir(), "padstudio-browser-"));
  const args = [
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
    `--window-size=${width},${height}`, ...(headless ? ["--headless=new"] : []), "about:blank"
  ];
  const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
  let endpoint = null;
  child.stderr.on("data", (chunk) => {
    const match = /DevTools listening on ws:\/\/([\d.]+:\d+)\//.exec(String(chunk));
    if (match) endpoint = match[1];
  });
  const deadline = Date.now() + 20_000;
  while (!endpoint && Date.now() < deadline) await sleep(50);
  if (!endpoint) { await killTree(child.pid); throw new Error("Trình duyệt không mở được cổng điều khiển."); }

  const targets = await (await fetch(`http://${endpoint}/json/list`)).json();
  const target = targets.find((item) => item.type === "page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const page = new Page(socket);
  await Promise.all(["Page.enable", "Runtime.enable", "Network.enable"].map((method) => page.send(method)));
  await page.viewport(width, height);

  return {
    page,
    async close() {
      try { socket.close(); } catch { /* ignore */ }
      await killTree(child.pid);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try { await rm(profile, { recursive: true, force: true }); return; } catch { await sleep(200); }
      }
    }
  };
}
