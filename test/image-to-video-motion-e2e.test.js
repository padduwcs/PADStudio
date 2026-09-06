import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ProjectStore } from "../src/project/project-store.js";
import { importProjectInput } from "../src/resources/project-importer.js";

const execFileAsync = promisify(execFile);

async function frameHash(videoPath, seekArgs) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-frame-"));
  try {
    const framePath = join(workspace, "frame.png");
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      ...seekArgs, "-i", videoPath, "-frames:v", "1", "-y", framePath
    ]);
    return createHash("sha256").update(await readFile(framePath)).digest("hex");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

test("image to video motion presets actually move the frame, not just claim to", async (t) => {
  try {
    await Promise.all([
      execFileAsync("ffmpeg", ["-version"]),
      execFileAsync("ffprobe", ["-version"])
    ]);
  } catch {
    t.skip("ffmpeg/ffprobe are not installed");
    return;
  }

  const workspace = await mkdtemp(join(tmpdir(), "padstudio-motion-e2e-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");

  // testsrc has spatially varying content (unlike a flat color), so a real
  // crop/zoom shift changes the sampled frame; a flat color would pass this
  // check even if the motion expressions were silently broken.
  const photoPath = join(workspace, "photo.png");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=size=800x600:rate=1",
    "-frames:v", "1", "-y", photoPath
  ]);

  const store = new ProjectStore(rootDir);
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
  const imported = await importProjectInput({ rootDir, projectId: "motion", sourcePath: photoPath });

  const staticRun = await executor.execute("motion", {
    capability: "image.to-video",
    tool: "ffmpeg-image-to-video",
    purpose: "Kiểm tra không có chuyển động khi motion=static",
    inputs: { source: { kind: "resource", id: imported.resourceId }, durationSeconds: 2 }
  });
  const staticResult = await store.readResult("motion", staticRun.resultId);
  assert.equal(staticResult.data.motion, "static");

  for (const motion of ["zoomIn", "zoomOut", "panLeft", "panRight", "kenBurns"]) {
    const run = await executor.execute("motion", {
      capability: "image.to-video",
      tool: "ffmpeg-image-to-video",
      purpose: "Kiểm tra chuyển động " + motion,
      inputs: { source: { kind: "resource", id: imported.resourceId }, durationSeconds: 2, motion }
    });
    const result = await store.readResult("motion", run.resultId);
    assert.equal(result.data.motion, motion);
    assert.deepEqual(result.data.video, { width: 800, height: 600, frameRate: 30 });
    const clipPath = join(rootDir, "motion", ...result.files[0].path.split("/"));
    const first = await frameHash(clipPath, []);
    const last = await frameHash(clipPath, ["-sseof", "-0.1"]);
    assert.notEqual(first, last, `${motion} must visibly change the frame between start and end`);
  }
});
