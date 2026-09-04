import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore, ProjectStoreError } from "../src/project/project-store.js";

async function temporaryStore(t) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-store-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { rootDir: join(directory, "projects"), store: new ProjectStore(join(directory, "projects")) };
}

test("project identity and checkpoint survive reopening without temporary files", async (t) => {
  const { rootDir, store } = await temporaryStore(t);
  const project = await store.createProject({
    projectId: "coffee-video",
    title: "Video giới thiệu cà phê"
  });
  assert.equal(project.title, "Video giới thiệu cà phê");

  await store.writeCheckpoint("coffee-video", {
    goal: "Tạo video 30 giây.",
    constraints: ["Tông ấm"],
    selectedResources: [],
    pending: ["Chờ người dùng chọn nhạc"],
    next: "Đề xuất ba hướng hình ảnh"
  });

  const reopened = await new ProjectStore(rootDir).readContext("coffee-video");
  assert.equal(reopened.checkpoint.goal, "Tạo video 30 giây.");
  assert.deepEqual(reopened.checkpoint.constraints, ["Tông ấm"]);
  assert.match(reopened.overview, /Chờ người dùng chọn nhạc/);
  const names = await readdir(join(rootDir, "coffee-video"));
  assert.equal(names.some((name) => name.endsWith(".tmp")), false);
});

test("invalid checkpoint references do not replace the current checkpoint", async (t) => {
  const { rootDir, store } = await temporaryStore(t);
  await store.createProject({ projectId: "coffee-video", title: "Coffee" });
  await store.writeCheckpoint("coffee-video", {
    goal: "Mục tiêu ban đầu",
    selectedResources: [],
    next: null
  });

  await assert.rejects(
    store.writeCheckpoint("coffee-video", {
      goal: "Mục tiêu sai",
      selectedResources: ["resource-khong-ton-tai"],
      next: null
    }),
    ProjectStoreError
  );
  await assert.rejects(
    store.writeCheckpoint("coffee-video", {
      goal: "Mục tiêu sai",
      selectedResource: "gõ nhầm field",
      next: null
    }),
    /field không được hỗ trợ/
  );
  assert.equal((await new ProjectStore(rootDir).readCheckpoint("coffee-video")).goal, "Mục tiêu ban đầu");
});

test("uninitialized folders are ignored and unsafe project ids are rejected", async (t) => {
  const { rootDir, store } = await temporaryStore(t);
  await mkdir(join(rootDir, "old-demo"), { recursive: true });
  assert.deepEqual(await store.listProjects(), []);
  await assert.rejects(
    store.createProject({ projectId: "../outside", title: "Outside" }),
    /Tên project không hợp lệ/
  );
  await assert.rejects(
    store.createProject({ projectId: "bad:name", title: "Bad" }),
    /Tên project không hợp lệ/
  );
  await assert.rejects(
    store.createProject({ projectId: "CON", title: "Reserved" }),
    /Tên project không hợp lệ/
  );
  await assert.rejects(
    store.createProject({ projectId: ".hidden", title: "Hidden" }),
    /Tên project không hợp lệ/
  );
});

test("projects created before results existed still open with an empty result list", async (t) => {
  const { rootDir, store } = await temporaryStore(t);
  await store.createProject({ projectId: "legacy-project", title: "Legacy" });
  await rm(join(rootDir, "legacy-project", "results"), { recursive: true });

  const context = await new ProjectStore(rootDir).readContext("legacy-project");
  assert.deepEqual(context.results, []);
});

test("results created before file outputs normalize to empty provenance and files", async (t) => {
  const { rootDir, store } = await temporaryStore(t);
  await store.createProject({ projectId: "legacy-result", title: "Legacy result" });
  const result = {
    version: "1.0",
    id: "result-legacy",
    projectId: "legacy-result",
    type: "media.metadata",
    name: "Legacy metadata",
    capability: "media.inspect",
    inputResources: [],
    tool: { name: "ffprobe", version: "1.0.0", provider: "FFmpeg" },
    data: {},
    verification: { status: "passed", checks: ["legacy_check"] },
    createdAt: new Date().toISOString(),
    createdByRun: "run-legacy"
  };
  await writeFile(
    join(rootDir, "legacy-result", "results", "result-legacy.json"),
    JSON.stringify(result),
    "utf8"
  );

  const reopened = await new ProjectStore(rootDir).readResult("legacy-result", "result-legacy");
  assert.deepEqual(reopened.inputResults, []);
  assert.deepEqual(reopened.files, []);
});
