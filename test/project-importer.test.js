import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectImportError, importProjectInput } from "../src/resources/project-importer.js";
import { ProjectStore } from "../src/project/project-store.js";

async function temporaryWorkspace(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-import-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  return {
    workspace,
    projectRoot: join(workspace, "projects"),
    sourceRoot: join(workspace, "source")
  };
}

test("import preserves sources and records grouped resources and completed runs", async (t) => {
  const { projectRoot, sourceRoot } = await temporaryWorkspace(t);
  await mkdir(join(sourceRoot, "footage"), { recursive: true });
  await writeFile(join(sourceRoot, "logo.txt"), "source logo", "utf8");
  await writeFile(join(sourceRoot, "footage", "clip.mp4"), "source clip", "utf8");
  await writeFile(join(sourceRoot, "footage", "notes.txt"), "source notes", "utf8");

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

  assert.equal(first.inputPath, "logo.txt");
  assert.equal(second.inputPath, "logo (2).txt");
  assert.equal(folder.inputPath, "footage");
  assert.match(first.runId, /^run-/);
  assert.match(first.resourceId, /^resource-/);
  assert.equal(await readFile(join(sourceRoot, "logo.txt"), "utf8"), "source logo");
  assert.equal(await readFile(join(projectRoot, "coffee-video", "inputs", "logo.txt"), "utf8"), "source logo");

  const context = await new ProjectStore(projectRoot).readContext("coffee-video");
  assert.equal(context.project.title, "Coffee Video");
  assert.equal(context.resources.length, 3);
  assert.equal(context.runs.length, 3);
  assert.ok(context.runs.every((run) => run.status === "completed"));
  const folderResource = context.resources.find((resource) => resource.id === folder.resourceId);
  assert.equal(folderResource.kind, "folder");
  assert.deepEqual(
    folderResource.items.map((item) => [item.relativePath, item.mediaType]),
    [["clip.mp4", "video"], ["notes.txt", "other"]]
  );
  assert.deepEqual(
    (await readdir(join(projectRoot, "coffee-video"))).sort(),
    ["analysis", "artifacts", "authorizations", "decisions", "inputs", "outputs", "project.json", "resources", "results", "reviews", "runs", "skills", "workflows"]
  );
  assert.equal(
    (await readdir(join(projectRoot, "coffee-video"))).some((name) => name.startsWith(".import-")),
    false
  );
});

test("a failed import records the error without creating a resource", async (t) => {
  const { projectRoot, sourceRoot } = await temporaryWorkspace(t);
  const missing = join(sourceRoot, "missing.mp4");

  await assert.rejects(
    importProjectInput({
      rootDir: projectRoot,
      projectId: "coffee-video",
      sourcePath: missing
    }),
    ProjectImportError
  );

  const context = await new ProjectStore(projectRoot).readContext("coffee-video");
  assert.equal(context.resources.length, 0);
  assert.equal(context.runs.length, 1);
  assert.equal(context.runs[0].status, "failed");
  assert.match(context.runs[0].error, /Không tìm thấy/);
  assert.deepEqual(await readdir(join(projectRoot, "coffee-video", "inputs")), []);
});

test("import rejects an unsafe inputs junction and a source containing the destination", async (t) => {
  const { workspace, projectRoot, sourceRoot } = await temporaryWorkspace(t);
  const store = new ProjectStore(projectRoot);
  await store.createProject({ projectId: "coffee-video", title: "Coffee video" });
  const projectDirectory = join(projectRoot, "coffee-video");
  const outsideDirectory = join(workspace, "outside");
  await mkdir(outsideDirectory, { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(sourceRoot, "brief.txt"), "brief", "utf8");
  await rm(join(projectDirectory, "inputs"), { recursive: true });
  await symlink(outsideDirectory, join(projectDirectory, "inputs"), "junction");

  await assert.rejects(
    importProjectInput({
      rootDir: projectRoot,
      projectId: "coffee-video",
      sourcePath: join(sourceRoot, "brief.txt")
    }),
    ProjectImportError
  );
  const context = await store.readContext("coffee-video");
  assert.equal(context.resources.length, 0);
  assert.equal(context.runs[0].status, "failed");

  const nestedProjectRoot = join(workspace, "nested", "projects");
  await assert.rejects(
    importProjectInput({
      rootDir: nestedProjectRoot,
      projectId: "coffee-video",
      sourcePath: join(workspace, "nested")
    }),
    ProjectImportError
  );
  await assert.rejects(new ProjectStore(nestedProjectRoot).readProject("coffee-video"));
});
