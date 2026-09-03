import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectImportError, importProjectInput } from "../src/project-importer.js";

async function temporaryWorkspace(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-import-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  return {
    workspace,
    projectRoot: join(workspace, "projects"),
    sourceRoot: join(workspace, "source")
  };
}

test("import preserves the source, avoids overwriting names, and leaves no partial staging folder", async (t) => {
  const { projectRoot, sourceRoot } = await temporaryWorkspace(t);
  await mkdir(join(sourceRoot, "footage"), { recursive: true });
  await writeFile(join(sourceRoot, "logo.txt"), "source logo", "utf8");
  await writeFile(join(sourceRoot, "footage", "clip.txt"), "source clip", "utf8");

  const first = await importProjectInput({
    rootDir: projectRoot,
    projectId: "coffee-video",
    sourcePath: join(sourceRoot, "logo.txt")
  });
  const second = await importProjectInput({
    rootDir: projectRoot,
    projectId: "coffee-video",
    sourcePath: join(sourceRoot, "logo.txt")
  });
  const folder = await importProjectInput({
    rootDir: projectRoot,
    projectId: "coffee-video",
    sourcePath: join(sourceRoot, "footage")
  });

  assert.deepEqual(first, { projectId: "coffee-video", kind: "file", inputPath: "logo.txt" });
  assert.deepEqual(second, { projectId: "coffee-video", kind: "file", inputPath: "logo (2).txt" });
  assert.deepEqual(folder, { projectId: "coffee-video", kind: "folder", inputPath: "footage" });
  assert.equal(await readFile(join(sourceRoot, "logo.txt"), "utf8"), "source logo");
  assert.equal(await readFile(join(projectRoot, "coffee-video", "inputs", "logo.txt"), "utf8"), "source logo");
  assert.equal(await readFile(join(projectRoot, "coffee-video", "inputs", "footage", "clip.txt"), "utf8"), "source clip");
  assert.deepEqual(await readdir(join(projectRoot, "coffee-video")), ["inputs"]);
});

test("import rejects a project input junction and a source that contains the destination project", async (t) => {
  const { workspace, projectRoot, sourceRoot } = await temporaryWorkspace(t);
  const projectDirectory = join(projectRoot, "coffee-video");
  const outsideDirectory = join(workspace, "outside");
  await mkdir(projectDirectory, { recursive: true });
  await mkdir(outsideDirectory, { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(sourceRoot, "brief.txt"), "brief", "utf8");
  await symlink(outsideDirectory, join(projectDirectory, "inputs"), "junction");

  await assert.rejects(
    importProjectInput({
      rootDir: projectRoot,
      projectId: "coffee-video",
      sourcePath: join(sourceRoot, "brief.txt")
    }),
    ProjectImportError
  );
  await assert.rejects(
    importProjectInput({
      rootDir: join(workspace, "nested", "projects"),
      projectId: "coffee-video",
      sourcePath: join(workspace, "nested")
    }),
    ProjectImportError
  );
});