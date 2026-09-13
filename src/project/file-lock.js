import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 120_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function lockState(path, staleMs, now) {
  try {
    const [info, contents] = await Promise.all([stat(path), readFile(path, "utf8")]);
    let owner = null;
    try { owner = JSON.parse(contents); } catch {}
    return { owner, contents, stale: now() - info.mtimeMs > staleMs };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function retireStaleLock(path, expectedContents) {
  const retired = `${path}.stale-${randomUUID()}`;
  try {
    await rename(path, retired);
    const retiredContents = await readFile(retired, "utf8").catch(() => null);
    if (retiredContents !== expectedContents) {
      await rename(retired, path).catch(() => {});
      return false;
    }
    await rm(retired, { force: true });
    return true;
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) return false;
    throw error;
  }
}

async function activeTakeovers(directory, lockName, staleMs, now) {
  const prefix = `${lockName}.lock.takeover-`;
  const entries = await readdir(directory, { withFileTypes: true });
  const active = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    const takeoverPath = join(directory, entry.name);
    let state;
    try {
      state = await lockState(takeoverPath, staleMs, now);
    } catch (error) {
      if (["EACCES", "EPERM"].includes(error?.code)) {
        active.push(takeoverPath);
        continue;
      }
      throw error;
    }
    if (!state) continue;
    if (state.stale && !processIsAlive(state.owner?.pid)) {
      await rm(takeoverPath, { force: true }).catch(() => {});
      continue;
    }
    active.push(takeoverPath);
  }
  return active;
}

async function releaseOwnedLock(path, token, handle) {
  await handle?.close().catch(() => {});
  try {
    const current = JSON.parse(await readFile(path, "utf8"));
    if (current?.token === token) await rm(path, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function withFileLock({
  projectDirectory,
  name,
  action,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  staleMs = DEFAULT_STALE_MS,
  now = Date.now,
  heartbeatMs = Math.max(10, Math.floor(staleMs / 3)),
}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error("Invalid lock name.");
  if (!Number.isFinite(staleMs) || staleMs <= 0) throw new Error("Lock staleMs must be positive.");
  if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0 || heartbeatMs >= staleMs) {
    throw new Error("Lock heartbeatMs must be positive and less than staleMs.");
  }
  const directory = join(projectDirectory, ".locks");
  const path = join(directory, `${name}.lock`);
  await mkdir(directory, { recursive: true });
  const startedAt = now();
  const token = randomUUID();
  let handle = null;

  while (!handle) {
    if ((await activeTakeovers(directory, name, staleMs, now)).length) {
      if (now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for mutation lock ${name}; stale takeover in progress.`);
      }
      await delay(10);
      continue;
    }
    try {
      handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify({
        token,
        pid: process.pid,
        createdAt: new Date(now()).toISOString()
      }));
      if ((await activeTakeovers(directory, name, staleMs, now)).length) {
        await releaseOwnedLock(path, token, handle);
        handle = null;
        await delay(10);
      }
    } catch (error) {
      if (handle) {
        await releaseOwnedLock(path, token, handle).catch(() => {});
        handle = null;
      }
      if (!["EEXIST", "EACCES", "EPERM"].includes(error?.code)) throw error;
      let state;
      try {
        state = await lockState(path, staleMs, now);
      } catch (stateError) {
        if (!["EACCES", "EPERM"].includes(stateError?.code)) throw stateError;
        state = null;
      }
      if (state?.stale && !processIsAlive(state.owner?.pid)) {
        const takeoverToken = randomUUID();
        const takeoverPath = `${path}.takeover-${takeoverToken}`;
        let takeoverHandle = null;
        try {
          takeoverHandle = await open(takeoverPath, "wx");
          await takeoverHandle.writeFile(JSON.stringify({
            token: takeoverToken,
            pid: process.pid,
            createdAt: new Date(now()).toISOString()
          }));
          await takeoverHandle.close();
          takeoverHandle = null;
          const current = await lockState(path, staleMs, now);
          if (current?.contents === state.contents && current.stale && !processIsAlive(current.owner?.pid)) {
            await retireStaleLock(path, state.contents);
          }
        } finally {
          await takeoverHandle?.close().catch(() => {});
          await rm(takeoverPath, { force: true }).catch(() => {});
        }
        continue;
      }
      if (now() - startedAt >= timeoutMs) {
        let owner = "unknown";
        try { owner = await readFile(path, "utf8"); } catch {}
        throw new Error(`Timed out waiting for mutation lock ${name}; owner ${owner}.`);
      }
      await delay(10);
    }
  }

  let heartbeatStopped = false;
  let heartbeatPromise = Promise.resolve();
  const heartbeat = setInterval(() => {
    heartbeatPromise = heartbeatPromise.then(async () => {
      if (!heartbeatStopped) await handle.utimes(new Date(), new Date());
    }).catch(() => {});
  }, heartbeatMs);
  heartbeat.unref?.();

  try {
    return await action();
  } finally {
    heartbeatStopped = true;
    clearInterval(heartbeat);
    await heartbeatPromise;
    await releaseOwnedLock(path, token, handle);
  }
}
