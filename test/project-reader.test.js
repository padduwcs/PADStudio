import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importProjectInput } from "../src/resources/project-importer.js";
import { ProjectInputNotFoundError, ProjectReader } from "../src/web/project-reader.js";
import { ProjectStore } from "../src/project/project-store.js";
import { createPadStudioServer } from "../src/web/server.js";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-reader-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("reader exposes initialized projects and their durable context", async (t) => {
  const workspace = await temporaryDirectory(t);
  const rootDir = join(workspace, "projects");
  const sourcePath = join(workspace, "logo.png");
  await writeFile(sourcePath, "not-a-real-image", "utf8");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "z-project", title: "Zulu" });
  await store.createProject({ projectId: "coffee-video", title: "Coffee video" });
  const imported = await importProjectInput({ rootDir, projectId: "coffee-video", sourcePath });
  await store.writeCheckpoint("coffee-video", {
    goal: "Video cà phê 30 giây.",
    constraints: ["Tông ấm"],
    selectedResources: [imported.resourceId],
    pending: [],
    next: "Phân tích video nguồn"
  });

  const reader = new ProjectReader(rootDir);
  assert.deepEqual((await reader.list()).map((project) => project.id), ["coffee-video", "z-project"]);
  const context = await reader.readProject("coffee-video");
  assert.equal(context.project.title, "Coffee video");
  assert.equal(context.checkpoint.next, "Phân tích video nguồn");
  assert.equal(context.resources[0].items[0].mediaType, "image");
  assert.equal(context.resources[0].items[0].available, true);
  assert.equal(context.runs[0].status, "completed");
  assert.match(context.overview, /Video cà phê 30 giây/);
  await assert.rejects(
    reader.readInputFile("coffee-video", "../source-logo.txt"),
    ProjectInputNotFoundError
  );
  await rm(join(rootDir, "coffee-video", "inputs", "logo.png"));
  assert.equal((await reader.readProject("coffee-video")).resources[0].items[0].available, false);
  await assert.rejects(
    reader.readInputFile("coffee-video", "logo.png"),
    ProjectInputNotFoundError
  );
});

test("reader does not follow an inputs junction outside the project", async (t) => {
  const workspace = await temporaryDirectory(t);
  const rootDir = join(workspace, "projects");
  const projectDirectory = join(rootDir, "coffee-video");
  const outsideDirectory = join(workspace, "outside");
  await new ProjectStore(rootDir).createProject({ projectId: "coffee-video", title: "Coffee" });
  await mkdir(outsideDirectory, { recursive: true });
  await writeFile(join(outsideDirectory, "secret.txt"), "outside-secret", "utf8");
  await rm(join(projectDirectory, "inputs"), { recursive: true });
  await symlink(outsideDirectory, join(projectDirectory, "inputs"), "junction");

  const reader = new ProjectReader(rootDir);
  await assert.rejects(reader.readInputFile("coffee-video", "secret.txt"), ProjectInputNotFoundError);
});

test("observer endpoints expose context and serve registered byte ranges", async (t) => {
  const workspace = await temporaryDirectory(t);
  const rootDir = join(workspace, "projects");
  const sourceText = "Nguồn do người dùng cung cấp.";
  const sourceBytes = new TextEncoder().encode(sourceText);
  const sourcePath = join(workspace, "brief.txt");
  await writeFile(sourcePath, sourceText, "utf8");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "coffee-video", title: "Coffee video" });
  const imported = await importProjectInput({ rootDir, projectId: "coffee-video", sourcePath });
  await store.writeCheckpoint("coffee-video", {
    goal: "Video cà phê.",
    selectedResources: [imported.resourceId],
    next: null
  });
  const inputInfo = await stat(join(rootDir, "coffee-video", "inputs", "brief.txt"));
  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
  const appResponse = await fetch(`http://127.0.0.1:${port}/app.js`);
  const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects`);
  const listBody = await listResponse.json();
  const contextResponse = await fetch(`http://127.0.0.1:${port}/api/projects/coffee-video`);
  const contextBody = await contextResponse.json();
  const inputResponse = await fetch(`http://127.0.0.1:${port}/project-inputs/coffee-video/brief.txt`);
  const rangeResponse = await fetch(`http://127.0.0.1:${port}/project-inputs/coffee-video/brief.txt`, {
    headers: { Range: "bytes=0-5" }
  });

  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /id="checkpoint"/);
  assert.equal(appResponse.status, 200);
  assert.match(await appResponse.text(), /renderResources/);
  assert.equal(listResponse.status, 200);
  assert.deepEqual(listBody.projects.map((project) => project.id), ["coffee-video"]);
  assert.equal(contextResponse.status, 200);
  assert.equal(contextBody.context.checkpoint.goal, "Video cà phê.");
  assert.equal(contextBody.context.resources[0].items[0].modifiedAt, inputInfo.mtime.toISOString());
  assert.equal(inputResponse.status, 200);
  assert.equal(await inputResponse.text(), sourceText);
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get("content-range"), `bytes 0-5/${sourceBytes.length}`);
  assert.deepEqual(new Uint8Array(await rangeResponse.arrayBuffer()), sourceBytes.slice(0, 6));
});

test("web server exposes no project mutation or chat endpoint", async (t) => {
  const rootDir = await temporaryDirectory(t);
  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  for (const path of ["/api/chat", "/api/projects"]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Xin chào" })
    });
    assert.equal(response.status, 404);
  }
});
