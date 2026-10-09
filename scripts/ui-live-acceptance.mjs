import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";

const exec = promisify(execFile);
const workspace = await mkdtemp(join(tmpdir(), "padstudio-ui-live-"));
const rootDir = join(workspace, "projects");
const projectId = "live-preview";
const tool = { name: "ui-fixture", version: "1", provider: "test" };
const store = new ProjectStore(rootDir);
const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
let phase = 0;
let artifact;
let run;

async function revision() {
  artifact = await store.recordArtifact(projectId, {
    key: "film", type: "video.sequence", name: "Một ngày thật mới", summary: "UI progress fixture",
    expectedRevision: artifact?.revision ?? 0,
    data: {
      version: "1.0", changeReason: "UI acceptance", format: { width: 360, height: 640, fps: 25 },
      segments: [{ id: "main", title: "Câu chuyện", intent: "UI acceptance", durationSeconds: 30, visual: null }]
    }
  });
  run = await store.startRun(projectId, { capability: "video.render-sequence", purpose: "Tạo bản xem thử", tool });
}

async function preview() {
  const output = await store.createRunOutputWorkspace(projectId, run.id);
  const target = join(output.temporaryDirectory, "preview.mp4");
  await copyFile(join(workspace, "fixture.mp4"), target);
  const { size } = await stat(target);
  await store.commitRunOutputWorkspace(output);
  const result = await store.addResult(projectId, {
    runId: run.id, capability: "video.render-sequence", tool, type: "video.sequence-render", name: "Bản xem thử",
    inputResources: [], inputArtifacts: [artifact.id],
    files: [{ id: "primary", role: "primary", path: `${output.projectRelativeDirectory}/preview.mp4`, name: "preview.mp4", mediaType: "video", sizeBytes: size }],
    data: { sequence: { artifactId: artifact.id, key: artifact.key, revision: artifact.revision }, hasAudio: false },
    verification: { status: "passed", checks: ["ui_fixture"] }
  });
  await store.finishRun(projectId, run.id, { status: "completed", outputs: [result.id] });
}

// Only this isolated fixture exposes an authoring route. The browser stays read-only;
// the acceptance driver advances the real ProjectStore from outside the UI.
const productHandler = server.listeners("request")[0];
server.removeAllListeners("request");
server.on("request", async (request, response) => {
  if (request.url !== "/_fixture/advance" || request.method !== "POST") return productHandler(request, response);
  try {
    phase += 1;
    if (phase === 1 || phase === 3) await preview();
    else if (phase === 2) await revision();
    else if (phase === 4) { await revision(); await preview(); }
    else throw new Error("Unexpected fixture phase");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ phase }));
  } catch (error) {
    console.error(`Fixture phase ${phase}: ${error.message}`);
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: error.message }));
  }
});

try {
  await mkdir(rootDir);
  await store.createProject({ projectId, title: "Một ngày thật mới" });
  await revision();
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xf2c4b1:s=360x640:r=25:d=30",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", join(workspace, "fixture.mp4")], { windowsHide: true, timeout: 20_000 });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { stdout } = await exec("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/ui-browser-smoke.ps1",
    "-Url", `http://127.0.0.1:${server.address().port}`, "-ProjectId", projectId, "-LiveFixture",
    "-ScreenshotDirectory", resolve(".cache/ui-polish/live")], { windowsHide: true, encoding: "utf8", timeout: 120_000, maxBuffer: 2e6 });
  const report = JSON.parse(stdout);
  if (report.liveProgress !== "passed" || report.writeRequests || phase !== 4) throw new Error("Live progress acceptance failed");
  console.log("Live progress: passed (first preview, active render, playback continuity, automatic replacement, manual selection, 12 responsive views)");
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  const target = resolve(workspace);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("padstudio-ui-live-")) {
    throw new Error("Refusing to remove a fixture outside its temporary directory.");
  }
  await rm(target, { recursive: true, force: true });
}
