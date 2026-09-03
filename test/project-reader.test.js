import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectInputNotFoundError, ProjectReader } from "../src/project-reader.js";
import { createPadStudioServer } from "../src/server.js";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-reader-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function createProject(rootDir, id, overview) {
  const directory = join(rootDir, id);
  await mkdir(directory, { recursive: true });
  if (overview !== undefined) {
    await writeFile(join(directory, "overview.md"), overview, "utf8");
  }
}

test("reader lists projects, overviews, and safe input files", async (t) => {
  const rootDir = await temporaryDirectory(t);
  await createProject(rootDir, "z-project");
  await createProject(rootDir, "coffee-video", "# Video cà phê\n\nTone ấm, chưa chốt lời thoại.\n");
  await mkdir(join(rootDir, "coffee-video", "inputs", "footage"), { recursive: true });
  const logoPath = join(rootDir, "coffee-video", "inputs", "logo.png");
  const clipPath = join(rootDir, "coffee-video", "inputs", "footage", "clip.mp4");
  await writeFile(logoPath, "not-a-real-image", "utf8");
  await writeFile(clipPath, "not-a-real-video", "utf8");

  const [logoInfo, clipInfo] = await Promise.all([stat(logoPath), stat(clipPath)]);
  const reader = new ProjectReader(rootDir);
  assert.deepEqual(await reader.list(), ["coffee-video", "z-project"]);
  assert.deepEqual(await reader.readOverview("coffee-video"), {
    id: "coffee-video",
    overview: "# Video cà phê\n\nTone ấm, chưa chốt lời thoại.\n"
  });
  assert.deepEqual(await reader.readProject("coffee-video"), {
    id: "coffee-video",
    overview: "# Video cà phê\n\nTone ấm, chưa chốt lời thoại.\n",
    inputs: [
      {
        path: "footage/clip.mp4",
        name: "clip.mp4",
        size: 16,
        modifiedAt: clipInfo.mtime.toISOString(),
        mediaType: "video"
      },
      {
        path: "logo.png",
        name: "logo.png",
        size: 16,
        modifiedAt: logoInfo.mtime.toISOString(),
        mediaType: "image"
      }
    ]
  });
  await assert.rejects(
    reader.readInputFile("coffee-video", "../source-logo.txt"),
    ProjectInputNotFoundError
  );
});

test("reader does not follow an inputs junction outside the project", async (t) => {
  const rootDir = await temporaryDirectory(t);
  const projectDirectory = join(rootDir, "coffee-video");
  const outsideDirectory = join(rootDir, "outside");
  await mkdir(projectDirectory, { recursive: true });
  await mkdir(outsideDirectory, { recursive: true });
  await writeFile(join(outsideDirectory, "secret.txt"), "outside-secret", "utf8");
  await symlink(outsideDirectory, join(projectDirectory, "inputs"), "junction");

  const reader = new ProjectReader(rootDir);
  assert.deepEqual(await reader.readProject("coffee-video"), {
    id: "coffee-video",
    overview: null,
    inputs: []
  });
  await assert.rejects(
    reader.readInputFile("coffee-video", "secret.txt"),
    ProjectInputNotFoundError
  );
});

test("observer endpoints read project inputs and serve valid byte ranges", async (t) => {
  const rootDir = await temporaryDirectory(t);
  const sourceText = "Nguồn do người dùng cung cấp.";
  const sourceBytes = new TextEncoder().encode(sourceText);
  await createProject(rootDir, "coffee-video", "# Video cà phê\n");
  await mkdir(join(rootDir, "coffee-video", "inputs"), { recursive: true });
  const inputPath = join(rootDir, "coffee-video", "inputs", "brief.txt");
  await writeFile(inputPath, sourceText, "utf8");
  const inputInfo = await stat(inputPath);
  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects`);
  const listBody = await listResponse.json();
  const overviewResponse = await fetch(`http://127.0.0.1:${port}/api/projects/coffee-video`);
  const overviewBody = await overviewResponse.json();
  const inputResponse = await fetch(`http://127.0.0.1:${port}/project-inputs/coffee-video/brief.txt`);
  const firstRangeResponse = await fetch(`http://127.0.0.1:${port}/project-inputs/coffee-video/brief.txt`, {
    headers: { Range: "bytes=0-5" }
  });
  const suffixRangeResponse = await fetch(`http://127.0.0.1:${port}/project-inputs/coffee-video/brief.txt`, {
    headers: { Range: "bytes=-5" }
  });

  assert.equal(listResponse.status, 200);
  assert.deepEqual(listBody.projects, ["coffee-video"]);
  assert.equal(overviewResponse.status, 200);
  assert.equal(overviewBody.project.overview, "# Video cà phê\n");
  assert.deepEqual(overviewBody.project.inputs, [
    {
      path: "brief.txt",
      name: "brief.txt",
      size: sourceBytes.length,
      modifiedAt: inputInfo.mtime.toISOString(),
      mediaType: "other"
    }
  ]);
  assert.equal(inputResponse.status, 200);
  assert.equal(await inputResponse.text(), sourceText);
  assert.equal(firstRangeResponse.status, 206);
  assert.equal(firstRangeResponse.headers.get("content-range"), `bytes 0-5/${sourceBytes.length}`);
  assert.deepEqual(new Uint8Array(await firstRangeResponse.arrayBuffer()), sourceBytes.slice(0, 6));
  assert.equal(suffixRangeResponse.status, 206);
  assert.equal(suffixRangeResponse.headers.get("content-range"), `bytes ${sourceBytes.length - 5}-${sourceBytes.length - 1}/${sourceBytes.length}`);
  assert.deepEqual(new Uint8Array(await suffixRangeResponse.arrayBuffer()), sourceBytes.slice(-5));
});

test("web server exposes no chat command endpoint", async (t) => {
  const rootDir = await temporaryDirectory(t);
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