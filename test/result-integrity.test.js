import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore, ProjectStoreError } from "../src/project/project-store.js";
import { ProjectReader, ProjectResultFileNotFoundError } from "../src/web/project-reader.js";

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
