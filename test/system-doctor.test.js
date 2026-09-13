import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectPadStudio,
  PRACTICAL_REQUIRED_CAPABILITIES
} from "../src/operations/system-doctor.js";
import { ProjectStore } from "../src/project/project-store.js";

function registryWithout(missing = null) {
  return {
    describeCapabilities: async () => ({
      capabilities: [
        ...PRACTICAL_REQUIRED_CAPABILITIES
          .filter((id) => id !== missing)
          .map((id) => ({
            id, available: true,
            tools: [{ name: id, provider: "fixture", availability: { status: "available" } }]
          })),
        {
          id: "optional.fixture", available: false,
          tools: [{
            name: "optional", provider: "fixture",
            availability: { status: "unavailable", reason: "not installed" }
          }]
        }
      ]
    })
  };
}

test("system doctor keeps optional tools non-blocking and reports release limits", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-doctor-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  await mkdir(rootDir, { recursive: true });
  const result = await inspectPadStudio({
    rootDir,
    registry: registryWithout(),
    store: new ProjectStore(rootDir),
    minimumFreeBytes: 0
  });
  assert.equal(result.status, "ready");
  assert.equal(result.release.releaseDefault, null);
  assert.equal(
    result.capabilities.find((entry) => entry.id === "optional.fixture").requirement,
    "optional"
  );
});

test("system doctor blocks when a required practical capability is missing", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-doctor-blocked-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  await mkdir(rootDir, { recursive: true });
  const missing = PRACTICAL_REQUIRED_CAPABILITIES[0];
  const result = await inspectPadStudio({
    rootDir,
    registry: registryWithout(missing),
    store: new ProjectStore(rootDir),
    minimumFreeBytes: 0
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.missingRequiredCapabilities, [missing]);
  assert.ok(result.remediations.some((entry) => entry.code === "capability:" + missing));
});

async function resultFixture(rootDir, projectId = "demo") {
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId, title: "Doctor integrity" });
  const tool = { name: "fixture", version: "1.0.0", provider: "test" };
  const run = await store.startRun(projectId, {
    capability: "fixture.write", purpose: "Write doctor fixture", tool
  });
  const output = await store.createRunOutputWorkspace(projectId, run.id);
  await writeFile(join(output.temporaryDirectory, "payload.bin"), "original");
  await store.commitRunOutputWorkspace(output);
  const result = await store.addResult(projectId, {
    runId: run.id,
    type: "fixture.output",
    name: "Fixture",
    capability: "fixture.write",
    inputResources: [],
    tool,
    files: [{
      id: "primary", role: "primary", path: output.projectRelativeDirectory + "/payload.bin",
      name: "payload.bin", mediaType: "document", sizeBytes: 8
    }],
    data: {},
    verification: { status: "passed", checks: ["fixture"] }
  });
  await store.finishRun(projectId, run.id, {
    status: "completed", outputs: [result.id]
  });
  return { store, result, output };
}

test("deep doctor keeps a healthy checksummed project ready without project remediation", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-doctor-ready-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const { store } = await resultFixture(rootDir);

  const doctor = await inspectPadStudio({
    rootDir, deep: true, registry: registryWithout(), store, minimumFreeBytes: 0
  });

  assert.equal(doctor.status, "ready");
  assert.equal(doctor.projects[0].status, "ready");
  assert.equal(doctor.projects[0].integrity.verified, 1);
  assert.equal(doctor.projects[0].integrity.legacyUnchecked, 0);
  assert.equal(doctor.projects[0].integrity.failed, 0);
  assert.ok(!doctor.remediations.some((entry) => entry.code.startsWith("project_")));
});

test("deep doctor reports legacy unchecked separately without rewriting immutable Result", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-doctor-legacy-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const { store, result } = await resultFixture(rootDir);
  const resultPath = join(rootDir, "demo", "results", result.id + ".json");
  const record = JSON.parse(await readFile(resultPath, "utf8"));
  delete record.files[0].sha256;
  await writeFile(resultPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  const beforeDoctor = await readFile(resultPath);

  const doctor = await inspectPadStudio({
    rootDir, deep: true, registry: registryWithout(), store, minimumFreeBytes: 0
  });

  assert.equal(doctor.status, "attention");
  assert.equal(doctor.projects[0].status, "attention");
  assert.equal(doctor.projects[0].health.status, "ready");
  assert.equal(doctor.projects[0].integrity.legacyUnchecked, 1);
  assert.equal(doctor.projects[0].integrity.unchecked, 1);
  assert.equal(doctor.projects[0].integrity.failed, 0);
  assert.equal(doctor.projects[0].integrity.files[0].status, "legacy_unchecked");
  assert.ok(doctor.remediations.some((entry) => entry.code === "project_legacy_integrity:demo"));
  assert.ok(!doctor.remediations.some((entry) => entry.code === "project_health:demo"));
  assert.deepEqual(await readFile(resultPath), beforeDoctor);
});

test("deep doctor blocks on same-size corruption with exact remediation", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-doctor-corrupt-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const { store, result, output } = await resultFixture(rootDir);
  const resultPath = join(rootDir, "demo", "results", result.id + ".json");
  const beforeDoctor = await readFile(resultPath);
  await writeFile(join(output.finalDirectory, "payload.bin"), "tampered");

  const doctor = await inspectPadStudio({
    rootDir, deep: true, registry: registryWithout(), store, minimumFreeBytes: 0
  });

  assert.equal(doctor.status, "blocked");
  assert.equal(doctor.projects[0].status, "blocked");
  assert.equal(doctor.projects[0].health.status, "ready");
  assert.equal(doctor.projects[0].integrity.legacyUnchecked, 0);
  assert.equal(doctor.projects[0].integrity.failed, 1);
  assert.match(doctor.projects[0].integrity.files[0].error, /SHA-256/);
  assert.ok(doctor.remediations.some((entry) => entry.code === "project_integrity:demo"));
  assert.ok(!doctor.remediations.some((entry) => entry.code === "project_health:demo"));
  assert.deepEqual(await readFile(resultPath), beforeDoctor);
});

test("doctor preserves blocked project-health precedence without an integrity failure", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-doctor-health-blocked-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Blocked health" });
  await store.startRun("demo", {
    capability: "fixture.write",
    purpose: "Leave an unrecoverable in-progress run",
    tool: { name: "fixture", version: "1.0.0", provider: "test" }
  });

  const doctor = await inspectPadStudio({
    rootDir, deep: true, registry: registryWithout(), store, minimumFreeBytes: 0
  });

  assert.equal(doctor.status, "blocked");
  assert.equal(doctor.projects[0].status, "blocked");
  assert.equal(doctor.projects[0].health.status, "blocked");
  assert.equal(doctor.projects[0].integrity.failed, 0);
  assert.ok(doctor.remediations.some((entry) => entry.code === "project_health:demo"));
});

test("doctor preserves attention project-health precedence with verified integrity", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-doctor-health-attention-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const { store, result } = await resultFixture(rootDir);
  await store.recordDecision("demo", {
    resultId: result.id,
    outcome: "changes_requested",
    note: "Revise this exact Result before approval."
  });

  const doctor = await inspectPadStudio({
    rootDir, deep: true, registry: registryWithout(), store, minimumFreeBytes: 0
  });

  assert.equal(doctor.status, "attention");
  assert.equal(doctor.projects[0].status, "attention");
  assert.equal(doctor.projects[0].health.status, "attention");
  assert.equal(doctor.projects[0].integrity.verified, 1);
  assert.equal(doctor.projects[0].integrity.failed, 0);
  assert.ok(doctor.remediations.some((entry) => entry.code === "project_health:demo"));
});
