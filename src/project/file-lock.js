import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 120_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stale(path, staleMs, now) {
  try {
    const info = await stat(path);
    return now() - info.mtimeMs > staleMs;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function retireStaleLock(path) {
  const retired = `${path}.stale-${randomUUID()}`;
  try {
    await rename(path, retired);
    await rm(retired, { force: true });
    return true;
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) return false;
    throw error;
  }
}

export async function withFileLock({
  projectDirectory,
  name,
  action,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  staleMs = DEFAULT_STALE_MS,
  now = Date.now,
}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error("Invalid lock name.");
  const directory = join(projectDirectory, ".locks");
  const path = join(directory, `${name}.lock`);
  await mkdir(directory, { recursive: true });
  const startedAt = now();
  let handle = null;

  while (!handle) {
    try {
      handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date(now()).toISOString() }));
    } catch (error) {
      if (!["EEXIST", "EACCES", "EPERM"].includes(error?.code)) throw error;
      if (await stale(path, staleMs, now)) {
        await retireStaleLock(path);
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

  try {
    return await action();
  } finally {
    await handle.close().catch(() => {});
    await rm(path, { force: true }).catch(() => {});
  }
}
