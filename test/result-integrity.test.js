import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ProjectStore,
  ProjectStoreError,
  pruneEmptyChildDirectories
} from "../src/project/project-store.js";
import { ProjectReader, ProjectResultFileNotFoundError } from "../src/web/project-reader.js";

test("committing an output workspace removes empty runtime directories", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-output-cleanup-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const store = new ProjectStore(join(workspace, "projects"));
  await store.createProject({ projectId: "demo", title: "Output cleanup" });
  const run = await store.startRun("demo", {
    capability: "fixture.write", purpose: "Verify output cleanup",
    tool: { name: "fixture", version: "1.0.0", provider: "test" }
  });
  const output = await store.createRunOutputWorkspace("demo", run.id);
  await mkdir(join(output.temporaryDirectory, "home", "app-data"), { recursive: true });
  await mkdir(join(output.temporaryDirectory, "kept"), { recursive: true });
  await writeFile(join(output.temporaryDirectory, "kept", "payload.txt"), "kept");
  await store.commitRunOutputWorkspace(output);
  await assert.rejects(access(join(output.finalDirectory, "home")));
  assert.equal(await readFile(join(output.finalDirectory, "kept", "payload.txt"), "utf8"), "kept");
});

test("empty runtime directory cleanup retries transient Windows locks", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-output-cleanup-retry-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const locked = join(workspace, "workspace");
  await mkdir(locked);
  let attempts = 0;
  const waits = [];

  await pruneEmptyChildDirectories(workspace, {
    platform: "win32",
    maxRetries: 3,
    retryDelayMs: 25,
    wait: async (milliseconds) => waits.push(milliseconds),
    removeDirectory: async (path) => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("temporarily locked"), { code: "EBUSY" });
      await rmdir(path);
    }
  });

  assert.equal(attempts, 3);
  assert.deepEqual(waits, [25, 25]);
  await assert.rejects(access(locked));
});

test("empty runtime directory cleanup still fails after bounded Windows lock retries", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-output-cleanup-persistent-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, "workspace"));
  let attempts = 0;

  await assert.rejects(
    pruneEmptyChildDirectories(workspace, {
      platform: "win32",
      maxRetries: 2,
      wait: async () => {},
      removeDirectory: async () => {
        attempts += 1;
        throw Object.assign(new Error("still locked"), { code: "EBUSY" });
      }
    }),
    (error) => error?.code === "EBUSY"
  );
  assert.equal(attempts, 3);
});

test("all new Result files get SHA-256 and exact-byte verification detects same-size tampering", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-result-integrity-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Integrity" });
  const tool = { name: "fixture", version: "1.0.0", provider: "test" };
  const run = await store.startRun("demo", {
    capability: "fixture.write", purpose: "Write bytes", tool
  });
  const output = await store.createRunOutputWorkspace("demo", run.id);
  const filePath = join(output.temporaryDirectory, "payload.bin");
  await writeFile(filePath, "original");
  await store.commitRunOutputWorkspace(output);
  const result = await store.addResult("demo", {
    runId: run.id,
    type: "fixture.output",
    name: "Fixture",
    capability: "fixture.write",
    inputResources: [],
    tool,
    files: [{
      id: "primary", role: "primary",
      path: output.projectRelativeDirectory + "/payload.bin",
      name: "payload.bin", mediaType: "document", sizeBytes: 8
    }],
    data: {},
    verification: { status: "passed", checks: ["fixture"] }
  });
  assert.match(result.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal((await store.verifyResultFile("demo", result.id, "primary")).integrity, "verified");

  await writeFile(join(output.finalDirectory, "payload.bin"), "tampered");
  assert.equal((await store.readResult("demo", result.id)).files[0].available, true);
  await assert.rejects(
    store.verifyResultFile("demo", result.id, "primary"),
    (error) => error instanceof ProjectStoreError && /SHA-256/.test(error.message)
  );
  await assert.rejects(
    new ProjectReader(rootDir).readResultFile("demo", result.id, "primary"),
    ProjectResultFileNotFoundError
  );
});

test("legacy sequence checksums verify segment sources used by generic media chaining", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-result-segment-integrity-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Legacy segment integrity" });
  const tool = { name: "fixture", version: "1.0.0", provider: "test" };
  const run = await store.startRun("demo", {
    capability: "video.render-sequence", purpose: "Write legacy-shaped render", tool
  });
  const output = await store.createRunOutputWorkspace("demo", run.id);
  await writeFile(join(output.temporaryDirectory, "preview.mp4"), "primary!");
  await writeFile(join(output.temporaryDirectory, "segment.mp4"), "segment!");
  await store.commitRunOutputWorkspace(output);
  const result = await store.addResult("demo", {
    runId: run.id,
    type: "video.sequence-render",
    name: "Legacy-shaped sequence render",
    capability: "video.render-sequence",
    inputResources: [],
    tool,
    files: [
      {
        id: "primary", role: "primary", path: output.projectRelativeDirectory + "/preview.mp4",
        name: "preview.mp4", mediaType: "video", sizeBytes: 8
      },
      {
        id: "segment-0", role: "segment", path: output.projectRelativeDirectory + "/segment.mp4",
        name: "segment.mp4", mediaType: "video", sizeBytes: 8
      }
    ],
    data: {
      sequence: { artifactId: "artifact-legacy", key: "film", revision: 1 },
      segments: []
    },
    verification: { status: "passed", checks: ["fixture"] }
  });

  // Simulate an immutable Result written before per-file checksums were introduced.
  const resultPath = join(rootDir, "demo", "results", result.id + ".json");
  const stored = JSON.parse(await readFile(resultPath, "utf8"));
  const primarySha256 = stored.files.find((file) => file.id === "primary").sha256;
  const segmentSha256 = stored.files.find((file) => file.id === "segment-0").sha256;
  for (const file of stored.files) delete file.sha256;
  stored.data.sha256 = primarySha256;
  stored.data.segments = [{ id: "opening", fileId: "segment-0", sha256: segmentSha256 }];
  await writeFile(resultPath, JSON.stringify(stored, null, 2) + "\n", "utf8");

  const primary = await store.verifyResultFile("demo", result.id, "primary");
  assert.equal(primary.checksumSource, "result_data");
  const segment = await store.verifyResultFile("demo", result.id, "segment-0");
  assert.equal(segment.checksumSource, "result_data_segment");
  const chained = await store.resolveMediaSource("demo", {
    kind: "result", id: result.id, file: "segment-0"
  });
  assert.equal(chained.trace.file, "segment-0");

  await writeFile(join(output.finalDirectory, "segment.mp4"), "tampered");
  await assert.rejects(
    store.resolveMediaSource("demo", { kind: "result", id: result.id, file: "segment-0" }),
    (error) => error instanceof ProjectStoreError && /SHA-256/.test(error.message)
  );
});
