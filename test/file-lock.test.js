import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "../src/project/file-lock.js";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-lock-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("heartbeat keeps a live long-running owner mutually exclusive", async (t) => {
  const directory = await workspace(t);
  let active = 0;
  let maximum = 0;
  const enter = async (milliseconds) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await delay(milliseconds);
    active -= 1;
  };
  const first = withFileLock({
    projectDirectory: directory,
    name: "shared",
    staleMs: 45,
    heartbeatMs: 10,
    timeoutMs: 500,
    action: () => enter(120)
  });
  await delay(55);
  const second = withFileLock({
    projectDirectory: directory,
    name: "shared",
    staleMs: 45,
    heartbeatMs: 10,
    timeoutMs: 500,
    action: () => enter(10)
  });
  await Promise.all([first, second]);
  assert.equal(maximum, 1);
});

test("an old owner never removes a successor lock", async (t) => {
  const directory = await workspace(t);
  const lockDirectory = join(directory, ".locks");
  const lockPath = join(lockDirectory, "shared.lock");
  await mkdir(lockDirectory, { recursive: true });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const owner = withFileLock({
    projectDirectory: directory,
    name: "shared",
    action: async () => { entered(); await held; }
  });
  await started;
  const current = JSON.parse(await readFile(lockPath, "utf8"));
  await rm(lockPath, { force: true });
  await writeFile(lockPath, JSON.stringify({ token: "successor", pid: process.pid }), "utf8");
  release();
  await owner;
  assert.notEqual(current.token, "successor");
  assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, "successor");
});

test("a stale lock from a dead owner is retired and replaced", async (t) => {
  const directory = await workspace(t);
  const lockDirectory = join(directory, ".locks");
  const lockPath = join(lockDirectory, "shared.lock");
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(lockPath, JSON.stringify({ token: "dead-owner", pid: 2_147_483_647 }), "utf8");
  const old = new Date(Date.now() - 10_000);
  await utimes(lockPath, old, old);
  let entered = false;
  await withFileLock({
    projectDirectory: directory,
    name: "shared",
    staleMs: 50,
    heartbeatMs: 10,
    timeoutMs: 500,
    action: async () => { entered = true; }
  });
  assert.equal(entered, true);
  await assert.rejects(readFile(lockPath, "utf8"), (error) => error.code === "ENOENT");
});

test("many stale-lock contenders never overlap in the protected action", async (t) => {
  const directory = await workspace(t);
  const lockDirectory = join(directory, ".locks");
  const lockPath = join(lockDirectory, "shared.lock");
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(lockPath, JSON.stringify({ token: "dead-owner", pid: 2_147_483_647 }), "utf8");
  const old = new Date(Date.now() - 10_000);
  await utimes(lockPath, old, old);
  let active = 0;
  let maximum = 0;

  await Promise.all(Array.from({ length: 8 }, () => withFileLock({
    projectDirectory: directory,
    name: "shared",
    staleMs: 50,
    heartbeatMs: 10,
    timeoutMs: 2_000,
    action: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await delay(5);
      active -= 1;
    }
  })));

  assert.equal(maximum, 1);
  assert.deepEqual(await readdir(lockDirectory), []);
});
