import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ToolRegistry } from "../src/execution/tool-registry.js";
import { applyProjectPrune, planProjectPrune, readProjectPrunes } from "../src/operations/project-prune.js";
import { analyzeProjectStorage, formatBytes } from "../src/operations/project-storage.js";
import { ProjectStore } from "../src/project/project-store.js";

const tool = { name: "scratch-tool", version: "1", provider: "test" };

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-prune-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const store = new ProjectStore(join(workspace, "projects"));
  await store.createProject({ projectId: "demo", title: "Demo" });
  return { store, root: join(workspace, "projects", "demo") };
}

// A completed Run whose output directory holds `registered` files plus arbitrary scratch.
async function completedRun(store, { registered = { "clip.mp4": "video-bytes" }, scratch = {}, finish = true } = {}) {
  const run = await store.startRun("demo", { capability: "media.inspect", purpose: "test", tool });
  const output = await store.createRunOutputWorkspace("demo", run.id);
  const files = [];
  for (const [name, content] of Object.entries({ ...registered, ...scratch })) {
    const path = join(output.temporaryDirectory, ...name.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
  for (const [name, content] of Object.entries(registered)) {
    files.push({ id: name.replace(/[^a-z0-9]/gi, "-"), role: "primary", path: `outputs/${run.id}/${name}`,
      name, mediaType: "video", sizeBytes: Buffer.byteLength(content) });
  }
  await store.commitRunOutputWorkspace(output);
  const result = await store.addResult("demo", {
    runId: run.id, type: "media.metadata", name: "Result", capability: "media.inspect", inputResources: [],
    files, tool, data: {}, verification: { status: "passed", checks: [] }
  });
  if (finish) await store.finishRun("demo", run.id, { status: "completed", outputs: [result.id] });
  return { run, result };
}

test("storage analysis separates registered files from scratch inside completed runs", async (t) => {
  const { store } = await fixture(t);
  await completedRun(store, {
    registered: { "animation.mp4": "12345678" },
    scratch: { "workspace/node_modules/cache.pack": "0123456789", "home/x": "ab" }
  });
  const report = await analyzeProjectStorage(store, "demo");
  assert.equal(report.areas.outputs.registeredBytes, 8);
  assert.equal(report.areas.outputs.unregisteredBytes, 12);
  assert.equal(report.reclaimable.unregisteredRuns, 1);
  assert.deepEqual(report.runs[0].unregisteredEntries.map((entry) => entry.path).sort(), ["home", "workspace"]);
  assert.ok(report.totalBytes >= 20);
  assert.equal(formatBytes(12), "12 B");
  assert.equal(formatBytes(1_500_000), "1.50 MB");
  assert.equal(formatBytes(42_890_000_000), "42.89 GB");
});

test("a plan changes nothing and applying removes only scratch", async (t) => {
  const { store, root } = await fixture(t);
  const { run, result } = await completedRun(store, {
    registered: { "animation.mp4": "the-video", "poster.jpg": "jpg" },
    scratch: { "workspace/a.txt": "scratch", "manim-media/b.bin": "more" }
  });
  const runDirectory = join(root, "outputs", run.id);

  const plan = await planProjectPrune(store, "demo");
  assert.equal(plan.status, "planned");
  assert.equal(plan.summary.bytes, "scratch".length + "more".length);
  assert.deepEqual((await readdir(runDirectory)).sort(), ["animation.mp4", "manim-media", "poster.jpg", "workspace"]);

  const applied = await applyProjectPrune(store, "demo");
  assert.equal(applied.status, "completed");
  assert.equal(applied.bytesFreed, plan.summary.bytes);
  assert.equal(applied.integrity.status, "verified");
  assert.deepEqual((await readdir(runDirectory)).sort(), ["animation.mp4", "poster.jpg"]);
  assert.equal(await readFile(join(runDirectory, "animation.mp4"), "utf8"), "the-video");

  const reread = await store.readResult("demo", result.id);
  assert.ok(reread.files.every((file) => file.available));
  assert.equal((await store.verifyResultFile("demo", result.id, "animation-mp4")).integrity, "verified");

  const again = await applyProjectPrune(store, "demo");
  assert.equal(again.status, "nothing_to_do");
  assert.equal(again.bytesFreed, 0);
});

test("every apply leaves an append-only audit record", async (t) => {
  const { store, root } = await fixture(t);
  await completedRun(store, { scratch: { "workspace/a.txt": "12345" } });
  const applied = await applyProjectPrune(store, "demo", { now: () => "2026-10-09T10:00:00.000Z" });
  const records = await readProjectPrunes(store, "demo");
  assert.equal(records.length, 1);
  assert.equal(records[0].id, applied.recordId);
  assert.equal(records[0].createdAt, "2026-10-09T10:00:00.000Z");
  assert.equal(records[0].bytesFreed, 5);
  assert.equal(records[0].integrity.status, "verified");
  assert.deepEqual(records[0].runs[0].removed.map((entry) => entry.path), ["workspace"]);
  await stat(join(root, "prunes", `${applied.recordId}.json`));
  // Nothing more to do means no new record.
  await applyProjectPrune(store, "demo");
  assert.equal((await readProjectPrunes(store, "demo")).length, 1);
});

test("runs that are not completed, orphan directories and temporary directories are never touched", async (t) => {
  const { store, root } = await fixture(t);
  const inProgress = await completedRun(store, { scratch: { "workspace/x": "x" }, finish: false });
  const failedRun = await store.startRun("demo", { capability: "media.inspect", purpose: "failing", tool });
  await store.finishRun("demo", failedRun.id, { status: "failed", error: "boom" });
  await mkdir(join(root, "outputs", failedRun.id, "workspace"), { recursive: true });
  await writeFile(join(root, "outputs", failedRun.id, "workspace", "f"), "failed-run-scratch");
  await mkdir(join(root, "outputs", "run-no-record", "workspace"), { recursive: true });
  await writeFile(join(root, "outputs", "run-no-record", "workspace", "o"), "orphan");
  await mkdir(join(root, "outputs", ".run-temp-token"), { recursive: true });
  await writeFile(join(root, "outputs", ".run-temp-token", "t"), "temp");

  const plan = await planProjectPrune(store, "demo");
  assert.equal(plan.status, "nothing_to_do");
  assert.equal(plan.notReclaimable.orphanOutputBytes > 0, true);
  assert.equal(plan.notReclaimable.temporaryBytes, 4);
  const applied = await applyProjectPrune(store, "demo");
  assert.equal(applied.status, "nothing_to_do");
  await stat(join(root, "outputs", inProgress.run.id, "workspace", "x"));
  await stat(join(root, "outputs", failedRun.id, "workspace", "f"));
  await stat(join(root, "outputs", "run-no-record", "workspace", "o"));
  await stat(join(root, "outputs", ".run-temp-token", "t"));
});

test("a pending Result draft keeps its files out of the plan", async (t) => {
  const { store, root } = await fixture(t);
  const run = await store.startRun("demo", { capability: "media.inspect", purpose: "paid", tool });
  const output = await store.createRunOutputWorkspace("demo", run.id);
  await writeFile(join(output.temporaryDirectory, "voice.mp3"), "paid-audio");
  await store.stageRunResult("demo", run.id, {
    type: "audio.tts", files: [{ id: "primary", path: `outputs/${run.id}/voice.mp3`, name: "voice.mp3", mediaType: "audio", sizeBytes: 10 }]
  });
  await store.commitRunOutputWorkspace(output);
  const plan = await planProjectPrune(store, "demo");
  assert.equal(plan.status, "nothing_to_do");
  await stat(join(root, "outputs", run.id, "voice.mp3"));
});

test("pruning can be limited to named runs and rejects unknown ones", async (t) => {
  const { store, root } = await fixture(t);
  const first = await completedRun(store, { scratch: { "workspace/a": "aaaa" } });
  const second = await completedRun(store, { scratch: { "workspace/b": "bb" } });
  await assert.rejects(planProjectPrune(store, "demo", { runIds: ["run-unknown"] }), { code: "unknown_run" });
  const applied = await applyProjectPrune(store, "demo", { runIds: [first.run.id] });
  assert.equal(applied.bytesFreed, 4);
  await assert.rejects(stat(join(root, "outputs", first.run.id, "workspace")), { code: "ENOENT" });
  await stat(join(root, "outputs", second.run.id, "workspace", "b"));
});

test("an executor run keeps only the files its Result registers", async (t) => {
  const { store, root } = await fixture(t);
  const scratchTool = {
    name: "scratch-tool", version: "1", provider: "test", capability: "media.inspect",
    description: "writes scratch", runtime: "local", executionMode: "sync", producesFiles: true,
    inputSchema: { type: "object" }, outputDescription: "clip", sideEffects: [],
    cost: { currency: "USD", estimated: 0 }, approvalRequired: false,
    async checkAvailability() { return { status: "available" }; },
    async prepare({ outputWorkspace }) { return { runtime: { directory: outputWorkspace.temporaryDirectory }, trace: { relative: outputWorkspace.projectRelativeDirectory } }; },
    async execute({ directory }) {
      await mkdir(join(directory, "workspace", "node_modules", ".cache"), { recursive: true });
      await writeFile(join(directory, "workspace", "node_modules", ".cache", "pack.bin"), "x".repeat(2048));
      await mkdir(join(directory, "home"), { recursive: true });
      await writeFile(join(directory, "home", "profile"), "profile");
      await writeFile(join(directory, "clip.mp4"), "clip-bytes");
      await writeFile(join(directory, "report.json"), "{}");
      return { verification: { status: "passed", checks: [] }, actualCostUsd: 0 };
    },
    createResult({ prepared }) {
      return {
        type: "media.metadata", name: "Clip", inputResources: [], data: {},
        files: [
          { id: "primary", role: "primary", path: `${prepared.trace.relative}/clip.mp4`, name: "clip.mp4", mediaType: "video", sizeBytes: 10 },
          { id: "report", role: "evidence", path: `${prepared.trace.relative}/report.json`, name: "report.json", mediaType: "application/json", sizeBytes: 2 }
        ],
        verification: { status: "passed", checks: [] }
      };
    }
  };
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([scratchTool]) });
  const response = await executor.execute("demo", { capability: "media.inspect", tool: "scratch-tool", purpose: "scratch", inputs: {} });
  assert.equal(response.status, "completed");
  assert.deepEqual((await readdir(join(root, "outputs", response.runId))).sort(), ["clip.mp4", "report.json"]);
  const verified = await store.verifyResultFile("demo", response.resultId, "primary");
  assert.equal(verified.integrity, "verified");
  assert.equal((await analyzeProjectStorage(store, "demo")).reclaimable.unregisteredBytes, 0);
});
