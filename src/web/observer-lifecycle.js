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

export async function ensureObserver({
  port = 7603,
  projectId = null,
  attempts = 30,
  intervalMs = 100,
  probe = probeObserver,
  launch = launchObserver,
  waitForNextAttempt = wait,
} = {}) {
  const origin = observerOrigin(port);
  if (await probe(origin)) {
    return { started: false, origin, url: projectId ? `${origin}/?project=${encodeURIComponent(projectId)}` : origin };
  }

  launch(port);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await waitForNextAttempt(intervalMs);
    if (await probe(origin)) {
      return { started: true, origin, url: projectId ? `${origin}/?project=${encodeURIComponent(projectId)}` : origin };
    }
  }
  throw new Error(`PADStudio Observer did not become ready at ${origin}.`);
}
