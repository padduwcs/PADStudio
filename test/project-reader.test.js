import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectReader } from "../src/project-reader.js";
import { createPadStudioServer } from "../src/server.js";

async function temporaryDirectory() {
  return mkdtemp(join(tmpdir(), "padstudio-test-"));
}

async function createProject(rootDir, id, overview) {
  const directory = join(rootDir, id);
  await mkdir(directory, { recursive: true });
  if (overview !== undefined) {
    await writeFile(join(directory, "overview.md"), overview, "utf8");
  }
}

test("reader lists existing projects and reads an optional overview", async (t) => {
  const rootDir = await temporaryDirectory();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await createProject(rootDir, "z-project");
  await createProject(rootDir, "coffee-video", "# Video cà phê\n\nTone ấm, chưa chốt lời thoại.\n");

  const reader = new ProjectReader(rootDir);
  assert.deepEqual(await reader.list(), ["coffee-video", "z-project"]);

  assert.deepEqual(await reader.readOverview("coffee-video"), {
    id: "coffee-video",
    overview: "# Video cà phê\n\nTone ấm, chưa chốt lời thoại.\n"
  });
  assert.deepEqual(await reader.readOverview("z-project"), { id: "z-project", overview: null });
});

test("observer endpoints read project files without creating a project", async (t) => {
  const rootDir = await temporaryDirectory();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await createProject(rootDir, "coffee-video", "# Video cà phê\n");
  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects`);
  const listBody = await listResponse.json();
  const overviewResponse = await fetch(`http://127.0.0.1:${port}/api/projects/coffee-video`);
  const overviewBody = await overviewResponse.json();

  assert.equal(listResponse.status, 200);
  assert.deepEqual(listBody.projects, ["coffee-video"]);
  assert.equal(overviewResponse.status, 200);
  assert.equal(overviewBody.project.overview, "# Video cà phê\n");
});

test("web server exposes no chat command endpoint", async (t) => {
  const rootDir = await temporaryDirectory();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Xin chào" })
  });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error, "Không tìm thấy.");
});