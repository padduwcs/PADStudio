import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";
import { projectGeneration } from "../src/web/project-generation.js";

test("project generation includes durable local skills and ignores mutation locks", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-generation-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  await new ProjectStore(rootDir).createProject({ projectId: "demo", title: "Generation demo" });
  const before = await projectGeneration(rootDir, "demo");

  const skillDirectory = join(rootDir, "demo", "skills", "local-review");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), "# Local review\n", "utf8");
  const withSkill = await projectGeneration(rootDir, "demo");
  assert.notEqual(withSkill, before);

  const lockDirectory = join(rootDir, "demo", ".locks");
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(join(lockDirectory, "artifacts.lock"), "transient", "utf8");
  assert.equal(await projectGeneration(rootDir, "demo"), withSkill);
});
