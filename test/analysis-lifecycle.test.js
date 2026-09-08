import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AnalysisService } from "../src/analysis/analysis-service.js";
import { createDefaultAnalysisService } from "../src/analysis/default-analysis-service.js";
import {
  AnalysisLeaseConflictError,
  AnalysisStore,
  validateAnalysisJob
} from "../src/analysis/analysis-store.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ToolRegistry } from "../src/execution/tool-registry.js";
import { ProjectStore } from "../src/project/project-store.js";
import { importProjectInput } from "../src/resources/project-importer.js";

async function fixture(t, { name = "clip.mp4", contents = "source bytes" } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-analysis-lifecycle-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const sourcePath = join(workspace, name);
  await writeFile(sourcePath, contents, "utf8");
  const imported = await importProjectInput({ rootDir, projectId: "demo", sourcePath });
  const store = new ProjectStore(rootDir);
  return { workspace, rootDir, sourcePath, imported, store };
}

function probeDefinition(overrides = {}) {
  return {
    capability: "source.probe",
    tool: "fake-source-probe",
    resultType: "source.metadata",
    dependencies: [],
    profileGroup: "probe",
    ...overrides
  };
}

function analysisRequest(source, operations = ["probe"]) {
  return {
    version: "1.0",
    sources: [source],
    operations,
    profiles: {},
    reuse: "verified"
  };
}

function fakeProbe({ onExecute = null, availability = { status: "available" } } = {}) {
  return {
    name: "fake-source-probe",
    version: "1.0.0",
    provider: "test",
    capability: "source.probe",
    description: "Probe fixture",
    runtime: "local",
    executionMode: "sync",
    inputSchema: { type: "object" },
    outputDescription: "Source metadata fixture",
    sideEffects: [],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    producesFiles: false,
    async checkAvailability() {
      return typeof availability === "function" ? availability() : availability;
    },
    async prepare({ store, projectId, inputs }) {
      const media = await store.resolveMediaSource(projectId, inputs.source);
      return { runtime: { filePath: media.filePath }, trace: { itemName: media.itemName } };
    },
    async execute(runtime) {
      await onExecute?.(runtime);
      return { actualCostUsd: 0 };
    },
    createResult({ prepared }) {
      return {
        type: "source.metadata",
        name: `Metadata: ${prepared.trace.itemName}`,
        data: {
          coverage: { mode: "metadata" },
          outcome: "produced",
          counts: { tracks: 1 },
          datasets: [],
          warnings: [],
          contentReview: "not_performed"
        },
        verification: { status: "passed", checks: ["fixture_probe"] }
      };
    }
  };
}

function fakeFrames({ onExecute = null, availability = { status: "available" } } = {}) {
  return {
    ...fakeProbe({ onExecute, availability }),
    name: "fake-frames",
    capability: "source.extract-frames",
    description: "Frame fixture",
    outputDescription: "Frame evidence fixture",
    createResult({ prepared }) {
      return {
        type: "source.frames",
        name: `Frames: ${prepared.trace.itemName}`,
        data: {
          coverage: { startSeconds: 0, endSeconds: 1, mode: "sampled" },
          outcome: "produced",
          counts: { frames: 1 },
          datasets: [],
          warnings: [],
          contentReview: "not_performed"
        },
        verification: { status: "passed", checks: ["fixture_frame"] }
      };
    }
  };
}

function fakePreview({ onExecute = null, availability = { status: "available" } } = {}) {
  return {
    ...fakeFrames({ onExecute, availability }),
    name: "fake-preview",
    capability: "source.preview",
    description: "Preview fixture",
    outputDescription: "Preview evidence fixture",
    createResult({ prepared }) {
      return {
        type: "source.preview",
        name: `Preview: ${prepared.trace.itemName}`,
        data: {
          coverage: { startSeconds: 0, endSeconds: 1, mode: "sampled" },
          outcome: "produced",
          counts: { previews: 1 },
          datasets: [],
          warnings: [],
          contentReview: "not_performed"
        },
        verification: { status: "passed", checks: ["fixture_preview"] }
      };
    }
  };
}

function fileProducingProbe({ onExecute = null } = {}) {
  return {
    ...fakeProbe(),
    producesFiles: true,
    sideEffects: ["creates fixture evidence"],
    async prepare({ store, projectId, inputs, outputWorkspace }) {
      const media = await store.resolveMediaSource(projectId, inputs.source);
      return {
        runtime: { outputPath: join(outputWorkspace.temporaryDirectory, "metadata.jsonl") },
        trace: {
          itemName: media.itemName,
          finalPath: `${outputWorkspace.projectRelativeDirectory}/metadata.jsonl`
        }
      };
    },
    async execute({ outputPath }) {
      const contents = await onExecute?.() ?? "{\"fixture\":true}\n";
      await writeFile(outputPath, contents, "utf8");
      return { actualCostUsd: 0, sizeBytes: Buffer.byteLength(contents) };
    },
    createResult({ prepared, execution }) {
      const base = fakeProbe().createResult({ prepared });
      return {
        ...base,
        files: [{
          id: "metadata",
          role: "dataset",
          path: prepared.trace.finalPath,
          name: "metadata.jsonl",
          mediaType: "application/x-ndjson",
          sizeBytes: execution.sizeBytes
        }],
        data: {
          ...base.data,
          datasets: [{ kind: "metadata", fileId: "metadata" }]
        }
      };
    }
  };
}

function createService({ rootDir, store, tools, analysisStore = null, definitions = null, cancellationPollMs = 10 }) {
  const manifestStore = analysisStore ?? new AnalysisStore({ rootDir, projectStore: store });
  return {
    analysisStore: manifestStore,
    service: new AnalysisService({
      store,
      analysisStore: manifestStore,
      executor: new ToolExecutor({ store, registry: new ToolRegistry(tools) }),
      operationDefinitions: definitions ?? { probe: probeDefinition() },
      cancellationPollMs
    })
  };
}

test("analysis job persists source identity, attempt, Run and Result and reuses verified evidence", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  let executions = 0;
  const { service, analysisStore } = createService({
    rootDir,
    store,
    tools: [fakeProbe({ onExecute: async () => { executions += 1; } })]
  });
  const source = { kind: "resource", id: imported.resourceId, itemPath: null };

  const first = await service.createAndRun("demo", analysisRequest(source));
  assert.equal(first.state, "completed");
  assert.equal(first.job.ownerLease, null);
  assert.equal(first.job.units[0].state, "succeeded");
  assert.equal(first.job.units[0].attempts[0].state, "succeeded");
  assert.ok(first.job.units[0].runId.startsWith("run-"));
  assert.ok(first.job.units[0].resultId.startsWith("result-"));
  assert.match(first.job.sourceSnapshots[0].sourceKey, /^[a-f0-9]{64}$/);
  assert.match(first.job.sourceSnapshots[0].sourceVersion, /^[a-f0-9]{64}$/);
  const storedRun = await store.readRun("demo", first.job.units[0].runId);
  assert.equal(storedRun.inputs.analysis.analysisJobId, first.analysisJobId);
  assert.equal(storedRun.inputs.analysis.unitId, first.job.units[0].id);

  const result = await store.readResult("demo", first.job.units[0].resultId);
  assert.equal(result.data.analysisJobId, first.analysisJobId);
  assert.equal(result.data.unitId, first.job.units[0].id);
  assert.equal(result.data.contentReview, "not_performed");
  assert.equal(result.verification.status, "passed");

  const reopened = await new AnalysisStore({
    rootDir,
    projectStore: new ProjectStore(rootDir)
  }).readJob("demo", first.analysisJobId);
  assert.equal(reopened.state, "completed");
  assert.equal(reopened.revision, first.revision);
  const corruptCompleted = structuredClone(reopened);
  corruptCompleted.units[0].state = "pending";
  assert.throws(() => validateAnalysisJob(corruptCompleted, "demo"), /completed/);

  const second = await service.createAndRun("demo", analysisRequest(source));
  assert.equal(second.state, "completed");
  assert.equal(second.job.units[0].state, "reused");
  assert.equal(second.job.units[0].resultId, result.id);
  assert.equal(executions, 1);
  assert.equal((await analysisStore.listJobs("demo")).length, 2);
  await assert.rejects(
    service.cancel("demo", first.analysisJobId),
    (error) => error.code === "job_terminal"
  );
});

test("tool environment drift after planning fails without committing mismatched evidence", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  let checks = 0;
  const tool = fakeProbe({
    availability: () => ({
      status: "available",
      executableVersion: checks++ < 2 ? "fixture-1" : "fixture-2"
    })
  });
  const { service } = createService({ rootDir, store, tools: [tool] });
  const response = await service.createAndRun(
    "demo",
    { ...analysisRequest({ kind: "resource", id: imported.resourceId, itemPath: null }), reuse: "never" }
  );
  assert.equal(response.state, "failed");
  assert.equal(response.job.units[0].state, "failed");
  assert.match(response.job.units[0].error, /Môi trường tool đã đổi/);
  assert.deepEqual(await store.readResults("demo"), []);
  const run = (await store.readRuns("demo")).find((item) => item.capability === "source.probe");
  assert.equal(run.status, "failed");
});

test("same bytes imported twice remain separate logical sources and are not cross-reused", async (t) => {
  const { workspace, rootDir, imported, store } = await fixture(t, { contents: "identical" });
  const secondPath = join(workspace, "copy.mp4");
  await writeFile(secondPath, "identical", "utf8");
  const secondImport = await importProjectInput({ rootDir, projectId: "demo", sourcePath: secondPath });
  let executions = 0;
  const { service } = createService({
    rootDir,
    store,
    tools: [fakeProbe({ onExecute: async () => { executions += 1; } })]
  });
  const response = await service.createAndRun("demo", {
    ...analysisRequest({ kind: "resource", id: imported.resourceId, itemPath: null }),
    sources: [
      { kind: "resource", id: imported.resourceId, itemPath: null },
      { kind: "resource", id: secondImport.resourceId, itemPath: null }
    ]
  });
  assert.equal(response.state, "completed");
  assert.equal(new Set(response.job.sourceSnapshots.map((item) => item.sourceKey)).size, 2);
  assert.equal(new Set(response.job.sourceSnapshots.map((item) => item.sourceVersion)).size, 1);
  assert.equal(executions, 2);
});

test("tool version changes invalidate reuse even when source bytes and request stay the same", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  let executions = 0;
  const source = { kind: "resource", id: imported.resourceId, itemPath: null };
  const firstTool = fakeProbe({ onExecute: async () => { executions += 1; } });
  const firstService = createService({ rootDir, store, tools: [firstTool] }).service;
  await firstService.createAndRun("demo", analysisRequest(source));

  const secondTool = {
    ...fakeProbe({ onExecute: async () => { executions += 1; } }),
    version: "2.0.0"
  };
  const secondService = createService({ rootDir, store, tools: [secondTool] }).service;
  const response = await secondService.createAndRun("demo", analysisRequest(source));
  assert.equal(response.job.units[0].state, "succeeded");
  assert.equal(response.job.units[0].method.tool.version, "2.0.0");
  assert.equal(executions, 2);
});

test("resume revalidates a successful upstream unit after tool version drift", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  const definitions = {
    probe: probeDefinition(),
    frames: {
      capability: "source.extract-frames",
      tool: "fake-frames",
      resultType: "source.frames",
      dependencies: ["probe"],
      profileGroup: "visual"
    },
    preview: {
      capability: "source.preview",
      tool: "fake-preview",
      resultType: "source.preview",
      dependencies: ["frames"],
      profileGroup: "preview"
    }
  };
  let probeExecutions = 0;
  let frameExecutions = 0;
  const source = { kind: "resource", id: imported.resourceId, itemPath: null };
  const first = await createService({
    rootDir,
    store,
    tools: [
      fakeProbe({ onExecute: async () => { probeExecutions += 1; } }),
      fakeFrames({ onExecute: async () => { frameExecutions += 1; } }),
      fakePreview({ availability: { status: "unavailable", reason: "fixture blocked" } })
    ],
    definitions
  }).service.createAndRun("demo", analysisRequest(source, ["preview"]));
  assert.equal(first.state, "partial");
  const oldProbeResultId = first.job.units[0].resultId;
  const oldFramesResultId = first.job.units[1].resultId;

  const probeV2 = {
    ...fakeProbe({ onExecute: async () => { probeExecutions += 1; } }),
    version: "2.0.0"
  };
  const resumed = await createService({
    rootDir,
    store,
    tools: [
      probeV2,
      fakeFrames({ onExecute: async () => { frameExecutions += 1; } }),
      fakePreview()
    ],
    definitions
  }).service.resume("demo", first.analysisJobId);
  assert.equal(resumed.state, "completed");
  assert.equal(probeExecutions, 2);
  assert.equal(frameExecutions, 2);
  const [probeUnit, framesUnit, previewUnit] = resumed.job.units;
  assert.equal(probeUnit.method.tool.version, "2.0.0");
  assert.notEqual(probeUnit.resultId, oldProbeResultId);
  assert.notEqual(framesUnit.resultId, oldFramesResultId);
  assert.deepEqual(probeUnit.attempts.map((attempt) => attempt.state), ["succeeded", "succeeded"]);
  const framesResult = await store.readResult("demo", framesUnit.resultId);
  assert.ok(framesResult.inputResults.includes(probeUnit.resultId));
  assert.ok(!framesResult.inputResults.includes(oldProbeResultId));
  const previewResult = await store.readResult("demo", previewUnit.resultId);
  assert.ok(previewResult.inputResults.includes(framesUnit.resultId));
  assert.ok(!previewResult.inputResults.includes(oldFramesResultId));
  assert.ok(resumed.job.warnings.some((warning) =>
    warning.code === "analysis_evidence_invalidated" && warning.unitId === probeUnit.id
  ));
  assert.ok(resumed.job.warnings.some((warning) =>
    warning.code === "analysis_evidence_invalidated" && warning.unitId === framesUnit.id
  ));
});

test("resume reruns evidence whose output checksum changed and preserves the historical Result", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  const definitions = {
    probe: probeDefinition(),
    frames: {
      capability: "source.extract-frames",
      tool: "fake-frames",
      resultType: "source.frames",
      dependencies: ["probe"],
      profileGroup: "visual"
    }
  };
  let executions = 0;
  const probe = fileProducingProbe({
    onExecute: async () => `{"execution":${++executions}}\n`
  });
  const source = { kind: "resource", id: imported.resourceId, itemPath: null };
  const first = await createService({
    rootDir,
    store,
    tools: [probe, fakeFrames({ availability: { status: "unavailable", reason: "fixture blocked" } })],
    definitions
  }).service.createAndRun("demo", analysisRequest(source, ["frames"]));
  assert.equal(first.state, "partial");
  const oldUnit = first.job.units[0];
  const oldResult = await store.readResult("demo", oldUnit.resultId);
  const oldEvidencePath = join(rootDir, "demo", ...oldResult.files[0].path.split("/"));
  await writeFile(oldEvidencePath, "tampered\n", "utf8");

  const resumed = await createService({
    rootDir,
    store,
    tools: [probe, fakeFrames()],
    definitions
  }).service.resume("demo", first.analysisJobId);
  assert.equal(resumed.state, "completed");
  assert.equal(executions, 2);
  const newUnit = resumed.job.units[0];
  assert.notEqual(newUnit.resultId, oldUnit.resultId);
  assert.equal(await readFile(oldEvidencePath, "utf8"), "tampered\n");
  assert.equal((await store.readResult("demo", oldResult.id)).id, oldResult.id);
  const newResult = await store.readResult("demo", newUnit.resultId);
  assert.match(newResult.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(resumed.job.warnings.some((warning) =>
    warning.code === "analysis_evidence_invalidated" && warning.resultId === oldResult.id
  ));
});

test("resume rejects previously successful evidence after source bytes change", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  const definitions = {
    probe: probeDefinition(),
    frames: {
      capability: "source.extract-frames",
      tool: "fake-frames",
      resultType: "source.frames",
      dependencies: ["probe"],
      profileGroup: "visual"
    }
  };
  let probeExecutions = 0;
  const probe = fakeProbe({ onExecute: async () => { probeExecutions += 1; } });
  const source = { kind: "resource", id: imported.resourceId, itemPath: null };
  const first = await createService({
    rootDir,
    store,
    tools: [probe, fakeFrames({ availability: { status: "unavailable", reason: "fixture blocked" } })],
    definitions
  }).service.createAndRun("demo", analysisRequest(source, ["frames"]));
  assert.equal(first.state, "partial");
  const historicalResultId = first.job.units[0].resultId;
  const managedSource = await store.resolveMediaSource("demo", source);
  await writeFile(managedSource.filePath, "source bytes changed after the partial job", "utf8");

  const resumed = await createService({
    rootDir,
    store,
    tools: [probe, fakeFrames()],
    definitions
  }).service.resume("demo", first.analysisJobId);
  assert.equal(resumed.state, "failed");
  assert.equal(resumed.job.units[0].state, "failed");
  assert.match(resumed.job.units[0].error, /thay đổi/);
  assert.equal(probeExecutions, 1);
  assert.equal((await store.readResult("demo", historicalResultId)).id, historicalResultId);
  assert.ok(resumed.job.warnings.some((warning) =>
    warning.code === "analysis_evidence_invalidated" && warning.resultId === historicalResultId
  ));
});

test("requested operations include technical dependencies and bind downstream fingerprints to upstream Results", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  const framesTool = {
    ...fakeProbe(),
    name: "fake-frames",
    capability: "source.extract-frames",
    description: "Frame fixture",
    outputDescription: "Frame evidence fixture",
    createResult({ prepared }) {
      return {
        type: "source.frames",
        name: `Frames: ${prepared.trace.itemName}`,
        data: {
          coverage: { startSeconds: 0, endSeconds: 1, mode: "sampled" },
          outcome: "produced",
          counts: { frames: 1 },
          datasets: [],
          warnings: [],
          contentReview: "not_performed"
        },
        verification: { status: "passed", checks: ["fixture_frame"] }
      };
    }
  };
  const definitions = {
    probe: probeDefinition(),
    frames: {
      capability: "source.extract-frames",
      tool: "fake-frames",
      resultType: "source.frames",
      dependencies: ["probe"],
      profileGroup: "visual"
    }
  };
  const { service } = createService({
    rootDir,
    store,
    tools: [fakeProbe(), framesTool],
    definitions
  });
  const response = await service.createAndRun("demo", {
    ...analysisRequest({ kind: "resource", id: imported.resourceId, itemPath: null }, ["frames"]),
    reuse: "never"
  });
  assert.equal(response.state, "completed");
  assert.deepEqual(response.job.units.map((unit) => unit.operation), ["probe", "frames"]);
  const [probeUnit, framesUnit] = response.job.units;
  assert.deepEqual(framesUnit.dependencies, [probeUnit.id]);
  const framesResult = await store.readResult("demo", framesUnit.resultId);
  assert.ok(framesResult.inputResults.includes(probeUnit.resultId));
  assert.notEqual(framesUnit.fingerprint, framesUnit.planFingerprint);
});

test("resource folders are snapshotted to concrete files", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-analysis-folder-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const folder = join(workspace, "footage");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(folder));
  await writeFile(join(folder, "a.mp4"), "a");
  await writeFile(join(folder, "b.wav"), "b");
  const imported = await importProjectInput({ rootDir, projectId: "demo", sourcePath: folder });
  const store = new ProjectStore(rootDir);
  const { service } = createService({ rootDir, store, tools: [fakeProbe()] });
  const response = await service.createAndRun("demo", {
    version: "1.0",
    sources: [],
    resourceFolders: [imported.resourceId],
    operations: ["probe"],
    profiles: {},
    reuse: "never"
  });
  assert.equal(response.job.sourceSnapshots.length, 2);
  assert.deepEqual(
    response.job.sourceSnapshots.map((item) => item.source.itemPath).sort(),
    ["a.mp4", "b.wav"]
  );
});

test("a live writer lease blocks a second coordinator and a dead lease is archived", async (t) => {
  const { rootDir, store } = await fixture(t);
  const firstStore = new AnalysisStore({ rootDir, projectStore: store });
  const firstLease = await firstStore.acquireLease("demo");
  await assert.rejects(
    firstStore.acquireLease("demo"),
    (error) => error instanceof AnalysisLeaseConflictError && error.code === "analysis_lease_conflict"
  );

  const takeoverStore = new AnalysisStore({
    rootDir,
    projectStore: store,
    ownerAlive: async () => false
  });
  const takeover = await takeoverStore.acquireLease("demo");
  assert.notEqual(takeover.token, firstLease.token);
  await takeoverStore.releaseLease("demo", takeover);
});

test("a paused stale takeover serializes a competing takeover", async (t) => {
  const { rootDir, store } = await fixture(t);
  const initialStore = new AnalysisStore({ rootDir, projectStore: store });
  const staleLease = await initialStore.acquireLease("demo");
  let staleCheckStartedResolve;
  const staleCheckStarted = new Promise((resolve) => { staleCheckStartedResolve = resolve; });
  let allowTakeoverResolve;
  const allowTakeover = new Promise((resolve) => { allowTakeoverResolve = resolve; });
  const pausedStore = new AnalysisStore({
    rootDir,
    projectStore: store,
    ownerAlive: async (lease) => {
      assert.equal(lease.token, staleLease.token);
      staleCheckStartedResolve();
      await allowTakeover;
      return false;
    }
  });
  const pendingTakeover = pausedStore.acquireLease("demo");
  await staleCheckStarted;

  const competingStore = new AnalysisStore({
    rootDir,
    projectStore: store,
    ownerAlive: async () => false
  });
  await assert.rejects(
    competingStore.acquireLease("demo"),
    (error) => error instanceof AnalysisLeaseConflictError
  );
  allowTakeoverResolve();
  const electedLease = await pendingTakeover;
  await pausedStore.assertLease("demo", electedLease);

  const archiveDirectory = join(rootDir, "demo", "analysis", "leases", "archive");
  const archived = await Promise.all(
    (await readdir(archiveDirectory)).map(async (name) =>
      JSON.parse(await readFile(join(archiveDirectory, name), "utf8"))
    )
  );
  assert.ok(archived.some((lease) => lease.token === staleLease.token));
  assert.ok(!archived.some((lease) => lease.token === electedLease.token));
  assert.deepEqual(
    (await readdir(join(rootDir, "demo", "analysis", "leases")))
      .filter((name) => name.startsWith("acquire-")),
    []
  );
  await pausedStore.releaseLease("demo", electedLease);
});

test("source mutation during execution fails the Run and never commits a Result", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  const { service } = createService({
    rootDir,
    store,
    tools: [fakeProbe({
      onExecute: async ({ filePath }) => writeFile(filePath, "mutated during analysis", "utf8")
    })]
  });
  const response = await service.createAndRun(
    "demo",
    { ...analysisRequest({ kind: "resource", id: imported.resourceId, itemPath: null }), reuse: "never" }
  );
  assert.equal(response.state, "failed");
  assert.equal(response.job.units[0].state, "failed");
  assert.match(response.job.units[0].error, /thay đổi/);
  assert.deepEqual(await store.readResults("demo"), []);
  const analysisRun = (await store.readRuns("demo")).find((run) => run.capability === "source.probe");
  assert.equal(analysisRun.status, "failed");
});

test("resume reconciles a durable Result after manifest persistence fails without rerunning tool", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  const baseAnalysisStore = new AnalysisStore({ rootDir, projectStore: store });
  let injected = false;
  const faultingAnalysisStore = new Proxy(baseAnalysisStore, {
    get(target, property) {
      if (property === "updateJob") {
        return async (...args) => {
          const results = await store.readResults("demo");
          if (!injected && results.some((result) => result.data?.analysisJobId)) {
            injected = true;
            const error = new Error("simulated manifest write failure after Result");
            error.code = "manifest_write_failed";
            throw error;
          }
          return target.updateJob(...args);
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  let executions = 0;
  const firstService = createService({
    rootDir,
    store,
    analysisStore: faultingAnalysisStore,
    tools: [fakeProbe({ onExecute: async () => { executions += 1; } })]
  }).service;
  const source = { kind: "resource", id: imported.resourceId, itemPath: null };
  const first = await firstService.createAndRun("demo", { ...analysisRequest(source), reuse: "never" });
  assert.equal(first.state, "failed");
  assert.equal(injected, true);
  assert.equal((await store.readResults("demo")).length, 1);

  const resumedService = createService({
    rootDir,
    store,
    analysisStore: baseAnalysisStore,
    tools: [fakeProbe({ onExecute: async () => { executions += 1; } })]
  }).service;
  const resumed = await resumedService.resume("demo", first.analysisJobId);
  assert.equal(resumed.state, "completed");
  assert.equal(resumed.job.units[0].state, "succeeded");
  assert.equal(executions, 1);
});

test("resume keeps an interrupted attempt and retries it with a new Run", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  const baseAnalysisStore = new AnalysisStore({ rootDir, projectStore: store });
  let updates = 0;
  const faultingAnalysisStore = new Proxy(baseAnalysisStore, {
    get(target, property) {
      if (property === "updateJob") {
        return async (...args) => {
          updates += 1;
          if (updates >= 3) {
            const error = new Error("simulated coordinator interruption");
            error.code = "manifest_unavailable";
            throw error;
          }
          return target.updateJob(...args);
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  let executions = 0;
  const source = { kind: "resource", id: imported.resourceId, itemPath: null };
  await assert.rejects(
    createService({
      rootDir,
      store,
      analysisStore: faultingAnalysisStore,
      tools: [fakeProbe({ onExecute: async () => { executions += 1; } })]
    }).service.createAndRun("demo", { ...analysisRequest(source), reuse: "never" }),
    /simulated coordinator interruption/
  );
  assert.equal(executions, 0);
  const [interruptedJob] = await baseAnalysisStore.listJobs("demo");
  assert.equal(interruptedJob.units[0].state, "running");
  assert.equal(interruptedJob.units[0].attempts[0].state, "running");

  const resumed = await createService({
    rootDir,
    store,
    analysisStore: baseAnalysisStore,
    tools: [fakeProbe({ onExecute: async () => { executions += 1; } })]
  }).service.resume("demo", interruptedJob.id);
  assert.equal(resumed.state, "completed");
  assert.deepEqual(
    resumed.job.units[0].attempts.map((attempt) => attempt.state),
    ["interrupted", "succeeded"]
  );
  assert.notEqual(resumed.job.units[0].attempts[0].id, resumed.job.units[0].attempts[1].id);
  assert.equal(executions, 1);
});

test("cancel persists intent, aborts the active unit and cancels pending units", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const tool = fakeProbe({
    onExecute: ({ signal }) => new Promise((resolve, reject) => {
      startedResolve();
      signal.addEventListener("abort", () => {
        const error = new Error("cancelled fixture");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  const { service, analysisStore } = createService({ rootDir, store, tools: [tool] });
  const running = service.createAndRun(
    "demo",
    { ...analysisRequest({ kind: "resource", id: imported.resourceId, itemPath: null }), reuse: "never" }
  );
  await started;
  const [job] = await analysisStore.listJobs("demo");
  const cancellation = await service.cancel("demo", job.id);
  assert.equal(cancellation.analysisJobId, job.id);
  const response = await running;
  assert.equal(response.state, "cancelled");
  assert.equal(response.job.units[0].state, "cancelled");
  assert.equal((await store.readResults("demo")).length, 0);
});

test("a blocked probe blocks dependent units without running them", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  const definitions = {
    probe: probeDefinition(),
    frames: {
      capability: "source.extract-frames",
      tool: "fake-frames",
      resultType: "source.frames",
      dependencies: ["probe"],
      profileGroup: "visual"
    }
  };
  const { service } = createService({
    rootDir,
    store,
    tools: [fakeProbe({ availability: { status: "unavailable", reason: "fixture dependency missing" } })],
    definitions
  });
  const response = await service.createAndRun("demo", {
    ...analysisRequest({ kind: "resource", id: imported.resourceId, itemPath: null }, ["probe", "frames"]),
    reuse: "never"
  });
  assert.equal(response.state, "failed");
  assert.deepEqual(response.job.units.map((unit) => unit.state), ["blocked", "blocked"]);
  assert.match(response.job.units[1].error, /Dependency/);
  assert.equal((await store.readRuns("demo")).filter((run) => run.capability.startsWith("source.")).length, 1);
});

test("default package-B coordinator reports missing package-C tools as blocked without fallback", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  const response = await createDefaultAnalysisService({ rootDir }).createAndRun(
    "demo",
    { ...analysisRequest({ kind: "resource", id: imported.resourceId, itemPath: null }), reuse: "never" }
  );
  assert.equal(response.state, "failed");
  assert.equal(response.job.units[0].state, "blocked");
  assert.match(response.job.units[0].error, /Không tìm thấy công cụ/);
  assert.equal((await store.readRuns("demo")).filter((run) => run.capability === "source.probe").length, 0);
});

test("Result file checksums prevent reuse after evidence is tampered", async (t) => {
  const { rootDir, imported, store } = await fixture(t);
  let executions = 0;
  const tool = {
    ...fakeProbe(),
    producesFiles: true,
    sideEffects: ["creates fixture evidence"],
    async prepare({ store: currentStore, projectId, inputs, outputWorkspace }) {
      const media = await currentStore.resolveMediaSource(projectId, inputs.source);
      return {
        runtime: { outputPath: join(outputWorkspace.temporaryDirectory, "metadata.jsonl") },
        trace: {
          itemName: media.itemName,
          finalPath: `${outputWorkspace.projectRelativeDirectory}/metadata.jsonl`
        }
      };
    },
    async execute({ outputPath }) {
      executions += 1;
      const contents = `{"execution":${executions}}\n`;
      await writeFile(outputPath, contents, "utf8");
      return { actualCostUsd: 0, sizeBytes: Buffer.byteLength(contents) };
    },
    createResult({ prepared, execution }) {
      const base = fakeProbe().createResult({ prepared });
      return {
        ...base,
        files: [{
          id: "metadata",
          role: "dataset",
          path: prepared.trace.finalPath,
          name: "metadata.jsonl",
          mediaType: "application/x-ndjson",
          sizeBytes: execution.sizeBytes
        }],
        data: {
          ...base.data,
          datasets: [{ kind: "metadata", fileId: "metadata" }]
        }
      };
    }
  };
  const { service } = createService({ rootDir, store, tools: [tool] });
  const source = { kind: "resource", id: imported.resourceId, itemPath: null };
  const first = await service.createAndRun("demo", analysisRequest(source));
  const second = await service.createAndRun("demo", analysisRequest(source));
  assert.equal(second.job.units[0].state, "reused");
  assert.equal(executions, 1);

  const firstResult = await store.readResult("demo", first.job.units[0].resultId);
  assert.match(firstResult.files[0].sha256, /^[a-f0-9]{64}$/);
  const evidencePath = join(rootDir, "demo", ...firstResult.files[0].path.split("/"));
  await writeFile(evidencePath, "tampered\n", "utf8");
  const third = await service.createAndRun("demo", analysisRequest(source));
  assert.equal(third.job.units[0].state, "succeeded");
  assert.equal(executions, 2);
  assert.notEqual(third.job.units[0].resultId, first.job.units[0].resultId);
  assert.equal(await readFile(evidencePath, "utf8"), "tampered\n");
});

test("ProjectStore rejects malformed analysis Result data", async (t) => {
  const { imported, store } = await fixture(t);
  const tool = { name: "fake-source-probe", version: "1.0.0", provider: "test" };
  const run = await store.startRun("demo", {
    capability: "source.probe",
    tool,
    inputs: { resourceId: imported.resourceId }
  });
  await assert.rejects(
    store.addResult("demo", {
      runId: run.id,
      type: "source.metadata",
      name: "Invalid source metadata",
      capability: "source.probe",
      inputResources: [imported.resourceId],
      tool,
      data: { schemaVersion: "1.0" },
      verification: { status: "passed", checks: ["fixture"] }
    }),
    /field|source|operation/
  );
});

test("Executor records a failed Run and does not invoke a tool when onRunStarted fails", async (t) => {
  const { imported, store } = await fixture(t);
  let executed = false;
  const tool = fakeProbe({ onExecute: async () => { executed = true; } });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  await assert.rejects(
    executor.execute("demo", {
      capability: "source.probe",
      tool: "fake-source-probe",
      purpose: "Test durable Run registration",
      inputs: { source: { kind: "resource", id: imported.resourceId, itemPath: null } }
    }, {
      onRunStarted: async () => { throw new Error("manifest unavailable"); }
    }),
    (error) => error.code === "run_start_hook_failed"
  );
  assert.equal(executed, false);
  const run = (await store.readRuns("demo")).find((item) => item.capability === "source.probe");
  assert.equal(run.status, "failed");
  assert.deepEqual(await store.readResults("demo"), []);
});
