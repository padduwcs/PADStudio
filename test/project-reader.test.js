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
  const sourceViewResponse = await fetch(`http://127.0.0.1:${port}/source-analysis-view.js`);
  const stylesResponse = await fetch(`http://127.0.0.1:${port}/styles.css`);
  const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects`);
  const listBody = await listResponse.json();
  const contextResponse = await fetch(`http://127.0.0.1:${port}/api/projects/coffee-video`);
  const contextBody = await contextResponse.json();
  const inputResponse = await fetch(`http://127.0.0.1:${port}/project-inputs/coffee-video/brief.txt`);
  const rangeResponse = await fetch(`http://127.0.0.1:${port}/project-inputs/coffee-video/brief.txt`, {
    headers: { Range: "bytes=0-5" }
  });

  assert.equal(pageResponse.status, 200);
  const pageBody = await pageResponse.text();
  assert.match(pageBody, /id="checkpoint"/);
  assert.match(pageBody, /id="source-analysis-view"/);
  assert.match(pageBody, /id="result-list"/);
  assert.equal(appResponse.status, 200);
  const appBody = await appResponse.text();
  assert.match(appBody, /renderResources/);
  assert.match(appBody, /renderResults/);
  assert.match(appBody, /renderResultDecision/);
  assert.equal(sourceViewResponse.status, 200);
  assert.match(await sourceViewResponse.text(), /renderSourceAnalysis/);
  assert.equal(stylesResponse.status, 200);
  const stylesBody = await stylesResponse.text();
  assert.match(stylesBody, /\.result-card/);
  assert.match(stylesBody, /\.result-decision/);
  assert.equal(listResponse.status, 200);
  assert.deepEqual(listBody.projects.map((project) => project.id), ["coffee-video"]);
  assert.equal(contextResponse.status, 200);
  assert.equal(contextBody.context.checkpoint.goal, "Video cà phê.");
  assert.deepEqual(contextBody.context.decisions, []);
  assert.equal(contextBody.context.resources[0].items[0].modifiedAt, inputInfo.mtime.toISOString());
  assert.equal(inputResponse.status, 200);
  assert.equal(await inputResponse.text(), sourceText);
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get("content-range"), `bytes 0-5/${sourceBytes.length}`);
  assert.deepEqual(new Uint8Array(await rangeResponse.arrayBuffer()), sourceBytes.slice(0, 6));
});

test("observer API exposes a result with its input, tool, run and decision trace", async (t) => {
  const workspace = await temporaryDirectory(t);
  const rootDir = join(workspace, "projects");
  const sourcePath = join(workspace, "clip.mp4");
  await writeFile(sourcePath, "test fixture", "utf8");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "result-project", title: "Result project" });
  const imported = await importProjectInput({
    rootDir,
    projectId: "result-project",
    sourcePath
  });
  const tool = { name: "ffprobe", version: "1.0.0", provider: "FFmpeg" };
  const run = await store.startRun("result-project", {
    capability: "media.inspect",
    purpose: "Đọc thông số video nguồn",
    tool,
    inputs: { resourceId: imported.resourceId },
    estimatedCostUsd: 0
  });
  const result = await store.addResult("result-project", {
    runId: run.id,
    type: "media.metadata",
    name: "Metadata: clip.mp4",
    capability: "media.inspect",
    inputResources: [imported.resourceId],
    tool,
    data: {
      source: {
        resourceId: imported.resourceId,
        itemPath: "clip.mp4",
        itemName: "clip.mp4",
        mediaType: "video"
      },
      media: {
        format: {
          name: "mov,mp4",
          durationSeconds: 3.5,
          sizeBytes: 2048,
          bitRate: 4681
        },
        streams: [{ index: 0, type: "video", codec: "h264", width: 1280, height: 720 }]
      }
    },
    verification: {
      status: "passed",
      checks: ["ffprobe_exit_0", "valid_json"]
    }
  });
  await store.finishRun("result-project", run.id, {
    status: "completed",
    outputs: [result.id],
    durationMs: 25,
    actualCostUsd: 0
  });
  const decision = await store.recordDecision("result-project", {
    resultId: result.id,
    outcome: "accepted",
    note: "Dùng thông số này làm cơ sở tiếp theo"
  });

  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/projects/result-project`
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.context.results.length, 1);
  assert.equal(body.context.results[0].id, result.id);
  assert.deepEqual(body.context.results[0].inputResources, [imported.resourceId]);
  assert.equal(body.context.results[0].createdByRun, run.id);
  assert.deepEqual(
    body.context.runs.find((candidate) => candidate.id === run.id).outputs,
    [result.id]
  );
  assert.equal(body.context.results[0].data.media.streams[0].codec, "h264");
  assert.equal(body.context.decisions.length, 1);
  assert.deepEqual(body.context.decisions[0], decision);
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
