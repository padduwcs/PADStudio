import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolExecutor, ToolExecutorError } from "../src/execution/tool-executor.js";
import { ToolRegistry } from "../src/execution/tool-registry.js";
import { ProjectStore } from "../src/project/project-store.js";
import { importProjectInput } from "../src/resources/project-importer.js";
import { createFfprobeMediaInspector } from "../src/tools/ffprobe-media-inspector.js";

function silentWav({ sampleRate = 8000, durationSeconds = 0.1 } = {}) {
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const output = Buffer.alloc(44 + dataSize);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  output.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  output.writeUInt16LE(bitsPerSample, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataSize, 40);
  return output;
}

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-executor-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const inputPath = join(workspace, "voice.wav");
  await writeFile(inputPath, "fake audio", "utf8");
  const imported = await importProjectInput({
    rootDir,
    projectId: "demo",
    sourcePath: inputPath
  });
  return { workspace, rootDir, store: new ProjectStore(rootDir), imported };
}

function fakeTool(overrides = {}) {
  return {
    name: "fake-probe",
    version: "1.0.0",
    provider: "test",
    capability: "media.inspect",
    description: "Test probe",
    runtime: "local",
    executionMode: "sync",
    inputSchema: { type: "object" },
    outputDescription: "Test metadata",
    sideEffects: [],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    async checkAvailability() {
      return { status: "available", executableVersion: "test-1" };
    },
    async prepare({ store, projectId, inputs }) {
      const input = await store.resolveInputResourceItem(projectId, inputs);
      return {
        runtime: { filePath: input.filePath },
        trace: {
          resourceId: input.resourceId,
          itemPath: input.itemPath,
          itemName: input.itemName,
          mediaType: input.mediaType
        }
      };
    },
    async execute() {
      return {
        data: { durationSeconds: 1.25 },
        verification: { status: "passed", checks: ["fake_check"] },
        actualCostUsd: 0
      };
    },
    createResult({ prepared, execution }) {
      return {
        type: "media.metadata",
        name: "Metadata: " + prepared.trace.itemName,
        inputResources: [prepared.trace.resourceId],
        data: { source: prepared.trace, media: execution.data },
        verification: execution.verification
      };
    },
    ...overrides
  };
}

function request(resourceId) {
  return {
    capability: "media.inspect",
    tool: "fake-probe",
    purpose: "Đọc thông số file nguồn",
    inputs: { resourceId }
  };
}

test("executor stores a durable result and a completed run with full trace", async (t) => {
  const { rootDir, store, imported } = await fixture(t);
  const executor = new ToolExecutor({
    store,
    registry: new ToolRegistry([fakeTool()])
  });

  const response = await executor.execute("demo", request(imported.resourceId));
  const context = await new ProjectStore(rootDir).readContext("demo");
  const run = context.runs.find((candidate) => candidate.id === response.runId);

  assert.equal(response.status, "completed");
  assert.equal(context.results.length, 1);
  assert.equal(context.results[0].id, response.resultId);
  assert.equal(context.results[0].createdByRun, response.runId);
  assert.deepEqual(context.results[0].inputResources, [imported.resourceId]);
  assert.equal(context.results[0].data.media.durationSeconds, 1.25);
  assert.deepEqual(run.outputs, [response.resultId]);
  assert.equal(run.status, "completed");
  assert.equal(run.purpose, "Đọc thông số file nguồn");
  assert.deepEqual(run.tool, {
    name: "fake-probe",
    version: "1.0.0",
    provider: "test"
  });
  assert.equal(run.cost.estimated, 0);
  assert.equal(run.cost.actual, 0);
  assert.ok(Number.isFinite(run.durationMs));
});

test("executor records an unavailable tool as a failed run without a result", async (t) => {
  const { store, imported } = await fixture(t);
  const executor = new ToolExecutor({
    store,
    registry: new ToolRegistry([
      fakeTool({
        async checkAvailability() {
          return { status: "unavailable", reason: "ffprobe is missing" };
        }
      })
    ])
  });

  await assert.rejects(
    executor.execute("demo", request(imported.resourceId)),
    (error) => error instanceof ToolExecutorError && error.code === "tool_unavailable"
  );
  const context = await store.readContext("demo");
  const run = context.runs.find((candidate) => candidate.capability === "media.inspect");
  assert.equal(run.status, "failed");
  assert.match(run.error, /ffprobe is missing/);
  assert.deepEqual(run.outputs, []);
  assert.deepEqual(context.results, []);
});

test("executor refuses tools that require approval until approval is supported", async (t) => {
  const { store, imported } = await fixture(t);
  const executor = new ToolExecutor({
    store,
    registry: new ToolRegistry([fakeTool({ approvalRequired: true })])
  });
  await assert.rejects(
    executor.execute("demo", request(imported.resourceId)),
    (error) => error instanceof ToolExecutorError && error.code === "approval_required"
  );
  const run = (await store.readRuns("demo")).find(
    (candidate) => candidate.capability === "media.inspect"
  );
  assert.equal(run.status, "failed");
  assert.match(run.error, /cần phê duyệt/);
});

test("executor records tool errors but invalid selection does not create a run", async (t) => {
  const { store, imported } = await fixture(t);
  const executor = new ToolExecutor({
    store,
    registry: new ToolRegistry([
      fakeTool({
        async execute() {
          const error = new Error("probe failed clearly");
          error.code = "probe_failed";
          throw error;
        }
      })
    ])
  });
  const runCount = (await store.readRuns("demo")).length;
  await assert.rejects(
    executor.execute("demo", { ...request(imported.resourceId), tool: "missing" }),
    /Không tìm thấy công cụ/
  );
  assert.equal((await store.readRuns("demo")).length, runCount);

  await assert.rejects(
    executor.execute("demo", request(imported.resourceId)),
    (error) => error instanceof ToolExecutorError && error.code === "probe_failed"
  );
  const context = await store.readContext("demo");
  const run = context.runs.find((candidate) => candidate.capability === "media.inspect");
  assert.equal(run.status, "failed");
  assert.equal(run.error, "probe failed clearly");
  assert.deepEqual(context.results, []);
});

test("executor removes produced files when a tool declares an unsafe result path", async (t) => {
  const { rootDir, store, imported } = await fixture(t);
  const tool = fakeTool({
    producesFiles: true,
    sideEffects: ["creates a file"],
    async prepare({ outputWorkspace }) {
      return {
        runtime: { outputPath: join(outputWorkspace.temporaryDirectory, "clip.mp4") },
        trace: {}
      };
    },
    async execute({ outputPath }) {
      await writeFile(outputPath, "rendered");
      return {
        verification: { status: "passed", checks: ["rendered"] },
        actualCostUsd: 0
      };
    },
    createResult({ execution }) {
      return {
        type: "video.clip",
        name: "Unsafe clip",
        inputResources: [],
        files: [{
          id: "primary",
          role: "primary",
          path: "inputs/voice.wav",
          name: "clip.mp4",
          mediaType: "video",
          sizeBytes: 8
        }],
        data: {},
        verification: execution.verification
      };
    }
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });

  await assert.rejects(
    executor.execute("demo", request(imported.resourceId)),
    /phải nằm trong output của run hiện tại/
  );
  assert.deepEqual(await readdir(join(rootDir, "demo", "outputs")), []);
  const context = await store.readContext("demo");
  assert.deepEqual(context.results, []);
  assert.equal(context.runs.find((run) => run.capability === "media.inspect").status, "failed");
});

test("executor refuses an input directory redirected outside the project", async (t) => {
  const { workspace, rootDir, store, imported } = await fixture(t);
  const inputRoot = join(rootDir, "demo", "inputs");
  await rm(inputRoot, { recursive: true });
  await symlink(workspace, inputRoot, "junction");
  const executor = new ToolExecutor({
    store,
    registry: new ToolRegistry([fakeTool()])
  });

  await assert.rejects(
    executor.execute("demo", request(imported.resourceId)),
    /inputs không an toàn/
  );
  const context = await store.readContext("demo");
  const run = context.runs.find((candidate) => candidate.capability === "media.inspect");
  assert.equal(run.status, "failed");
  assert.deepEqual(context.results, []);
});

test("folder resources require an explicit itemPath", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-folder-tool-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const sourceFolder = join(workspace, "footage");
  await mkdir(sourceFolder);
  await writeFile(join(sourceFolder, "voice.wav"), "fake audio", "utf8");
  await writeFile(join(sourceFolder, "clip.mp4"), "fake video", "utf8");
  const imported = await importProjectInput({
    rootDir,
    projectId: "folder-project",
    sourcePath: sourceFolder
  });
  const store = new ProjectStore(rootDir);
  const executor = new ToolExecutor({
    store,
    registry: new ToolRegistry([fakeTool()])
  });

  await assert.rejects(
    executor.execute("folder-project", request(imported.resourceId)),
    /itemPath/
  );
  const response = await executor.execute("folder-project", {
    ...request(imported.resourceId),
    inputs: { resourceId: imported.resourceId, itemPath: "clip.mp4" }
  });
  assert.equal(response.result.data.source.itemPath, "clip.mp4");
});

test("default ffprobe tool completes a real end-to-end media inspection", async (t) => {
  const tool = createFfprobeMediaInspector();
  const availability = await tool.checkAvailability();
  if (availability.status !== "available") {
    t.skip("ffprobe is not installed in this environment");
    return;
  }

  const workspace = await mkdtemp(join(tmpdir(), "padstudio-real-ffprobe-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const sourcePath = join(workspace, "silence.wav");
  await writeFile(sourcePath, silentWav());
  const imported = await importProjectInput({
    rootDir,
    projectId: "real-probe",
    sourcePath
  });
  const store = new ProjectStore(rootDir);
  const executor = new ToolExecutor({
    store,
    registry: new ToolRegistry([tool])
  });
  const response = await executor.execute("real-probe", {
    capability: "media.inspect",
    tool: "ffprobe",
    purpose: "Xác nhận file audio nguồn",
    inputs: { resourceId: imported.resourceId }
  });
  const context = await store.readContext("real-probe");
  const result = context.results.find((candidate) => candidate.id === response.resultId);

  assert.equal(result.verification.status, "passed");
  assert.ok(result.verification.details.executableVersion);
  assert.ok(Math.abs(result.data.media.format.durationSeconds - 0.1) < 0.01);
  assert.equal(result.data.media.streams[0].type, "audio");
  assert.equal(result.data.media.streams[0].codec, "pcm_s16le");
  assert.equal(result.data.media.streams[0].sampleRate, 8000);
});
