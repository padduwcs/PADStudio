import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";

test("an output-free local Run can be explicitly abandoned without erasing history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-abandon-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root);
  await store.createProject({ projectId: "demo", title: "Demo" });
  const run = await store.startRun("demo", {
    capability: "animation.render", purpose: "Interrupted local render",
    tool: { name: "manim-ce", version: "1", provider: "Manim Community" }
  });
  await assert.rejects(store.abandonRun("demo", run.id, { reason: "stopped" }), /explicit confirmation/);
  const abandoned = await store.abandonRun("demo", run.id, {
    reason: "The local process is no longer running.", confirmStopped: true
  });
  assert.equal(abandoned.status, "failed");
  assert.match(abandoned.error, /operator confirmed/);
  assert.equal((await store.readContext("demo")).runRecovery.pendingFinalizations.length, 0);
});

test("a Run with output evidence cannot be abandoned", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-abandon-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root);
  await store.createProject({ projectId: "demo", title: "Demo" });
  const run = await store.startRun("demo", { capability: "fixture", purpose: "test", tool: null });
  await store.stageRunResult("demo", run.id, { type: "fixture", files: [] });
  await assert.rejects(store.abandonRun("demo", run.id, {
    reason: "Do not discard evidence.", confirmStopped: true
  }), /must use finalization recovery/);
});
