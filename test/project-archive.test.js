import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveProject, listArchivedProjects, restoreProject } from "../src/project/project-archive.js";
import { ProjectStore } from "../src/project/project-store.js";

test("project archive moves a complete project out of the active store and restores it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-archive-")); t.after(() => rm(root, { recursive: true, force: true }));
  const activeRoot = join(root, "projects"), archiveRoot = join(root, "archive", "projects");
  const store = new ProjectStore(activeRoot); await store.createProject({ projectId: "demo", title: "Demo" });
  await assert.rejects(archiveProject({ activeRoot, archiveRoot, projectId: "demo", reason: "Pilot" }), (error) => error.code === "confirmation_required");
  const archived = await archiveProject({ activeRoot, archiveRoot, projectId: "demo", reason: "Completed pilot", confirmedStopped: true, now: () => "2026-09-14T00:00:00.000Z" });
  assert.equal(archived.state, "archived");
  assert.deepEqual(await store.listProjects(), []);
  assert.equal((await listArchivedProjects({ archiveRoot }))[0].archive.reason, "Completed pilot");
  const restored = await restoreProject({ activeRoot, archiveRoot, projectId: "demo", confirmedStopped: true, now: () => "2026-09-14T01:00:00.000Z" });
  assert.equal(restored.state, "restored");
  assert.equal((await store.listProjects())[0].id, "demo");
  assert.deepEqual(await listArchivedProjects({ archiveRoot }), []);
});

test("project archive refuses a project with an in-progress Run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-archive-busy-")); t.after(() => rm(root, { recursive: true, force: true }));
  const activeRoot = join(root, "projects"), archiveRoot = join(root, "archive", "projects");
  const store = new ProjectStore(activeRoot); await store.createProject({ projectId: "demo", title: "Demo" });
  await store.startRun("demo", { capability: "video.render", purpose: "Render", tool: null, inputs: {}, estimatedCostUsd: 0 });
  await assert.rejects(archiveProject({ activeRoot, archiveRoot, projectId: "demo", reason: "Busy", confirmedStopped: true }), (error) => error.code === "project_busy");
  assert.equal((await store.listProjects())[0].id, "demo");
});
