import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverPath = join(applicationRoot, "src", "web", "server.js");

function observerOrigin(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Observer port must be an integer between 1 and 65535.");
  }
  return `http://127.0.0.1:${port}`;
}

export async function probeObserver(origin, { fetchImpl = globalThis.fetch, timeoutMs = 1_000 } = {}) {
  try {
    const response = await fetchImpl(`${origin}/api/projects`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const body = await response.json();
    return Array.isArray(body?.projects);
  } catch {
    return false;
  }
}

export function launchObserver(port, { spawnImpl = spawn } = {}) {
  const child = spawnImpl(process.execPath, [serverPath], {
    cwd: applicationRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
  return child;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** The running observer's identity, or null when it is too old to report one (or is not PADStudio). */
export async function identifyObserver(origin, { fetchImpl = globalThis.fetch, timeoutMs = 1_000 } = {}) {
  try {
    const response = await fetchImpl(`${origin}/api/observer`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.app === "padstudio-observer" && Number.isInteger(body.pid) && typeof body.build === "string" ? body : null;
  } catch {
    return null;
  }
}

function stopProcess(pid) {
  process.kill(pid);
}

function urls(origin, projectId) {
  return {
    origin,
    url: projectId ? `${origin}/?project=${encodeURIComponent(projectId)}` : origin,
    toolsUrl: `${origin}/?panel=tools`
  };
}

/**
 * Reuse the observer on `port` when it runs the code on disk; otherwise start one. A server still running older
 * code (it reports a different build) is stopped and replaced, so the user sees the current interface. A server
 * too old to report its build cannot be stopped from here; the result says so and how to fix it.
 */
export async function ensureObserver({
  port = 7603,
  projectId = null,
  restart = true,
  attempts = 30,
  intervalMs = 100,
  probe = probeObserver,
  identify = identifyObserver,
  currentBuild = null,
  stop = stopProcess,
  launch = launchObserver,
  waitForNextAttempt = wait,
} = {}) {
  const origin = observerOrigin(port);
  const waitUntil = async (healthy) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await waitForNextAttempt(intervalMs);
      if (await probe(origin) === healthy) return true;
    }
    return false;
  };

  let restarted = false;
  if (await probe(origin)) {
    const build = currentBuild ?? (await import("./observer-build.js")).observerBuild();
    const identity = await identify(origin);
    if (identity?.build === build) return { started: false, restarted: false, ...urls(origin, projectId) };
    if (!identity) {
      return {
        started: false, restarted: false, stale: true, ...urls(origin, projectId),
        message: "Observer đang chạy là bản cũ, chưa có trang Công cụ và các sửa lỗi mới. Tắt tiến trình node đang chạy " +
          "src/web/server.js (cửa sổ npm start), rồi chạy lại npm run observer:ensure."
      };
    }
    if (!restart) return { started: false, restarted: false, stale: true, ...urls(origin, projectId), pid: identity.pid };
    stop(identity.pid);
    if (!await waitUntil(false)) throw new Error(`The old PADStudio Observer at ${origin} did not stop.`);
    restarted = true;
  }

  launch(port);
  if (await waitUntil(true)) return { started: true, restarted, ...urls(origin, projectId) };
  throw new Error(`PADStudio Observer did not become ready at ${origin}.`);
}
