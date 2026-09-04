import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ProjectStore } from "../src/project/project-store.js";
import { importProjectInput } from "../src/resources/project-importer.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";

const execFileAsync = promisify(execFile);

test("real ffmpeg trim creates a durable reusable clip and serves registered bytes", async (t) => {
  try {
    await Promise.all([
      execFileAsync("ffmpeg", ["-version"]),
      execFileAsync("ffprobe", ["-version"])
    ]);
  } catch {
    t.skip("ffmpeg/ffprobe are not installed");
    return;
  }

  const workspace = await mkdtemp(join(tmpdir(), "padstudio-trim-e2e-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const sourcePath = join(workspace, "source.mp4");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25:d=3",
    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=44100:duration=3",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-y", sourcePath
  ]);
  const sourceBefore = await readFile(sourcePath);
  const imported = await importProjectInput({
    rootDir,
    projectId: "trim-project",
    sourcePath
  });
  const projectInputPath = join(rootDir, "trim-project", "inputs", imported.inputPath);
  const projectInputBefore = await readFile(projectInputPath);
  const store = new ProjectStore(rootDir);
  const executor = new ToolExecutor({
    store,
    registry: createDefaultToolRegistry()
  });
  const first = await executor.execute("trim-project", {
    capability: "video.trim",
    tool: "ffmpeg-trim",
    purpose: "Cắt đoạn thử nghiệm có audio",
    inputs: {
      source: { kind: "resource", id: imported.resourceId, itemPath: null },
      startSeconds: 0.5,
      endSeconds: 2
    }
  });
  const reopened = await new ProjectStore(rootDir).readContext("trim-project");
  const firstResult = reopened.results.find((result) => result.id === first.resultId);
  assert.equal(firstResult.type, "video.clip");
  assert.equal(firstResult.files[0].available, true);
  assert.deepEqual(firstResult.inputResources, [imported.resourceId]);
  assert.deepEqual(firstResult.inputResults, []);
  assert.ok(Math.abs(firstResult.data.durationSeconds - 1.5) <= 0.25);
  assert.equal(firstResult.data.hasAudio, true);
  assert.deepEqual(await readFile(sourcePath), sourceBefore);
  assert.deepEqual(await readFile(projectInputPath), projectInputBefore);

  const second = await executor.execute("trim-project", {
    capability: "video.trim",
    tool: "ffmpeg-trim",
    purpose: "Dùng clip trước làm nguồn",
    inputs: {
      source: { kind: "result", id: first.resultId, file: "primary" },
      startSeconds: 0.2,
      endSeconds: 0.8
    }
  });
  const secondResult = await store.readResult("trim-project", second.resultId);
  assert.deepEqual(secondResult.inputResources, []);
  assert.deepEqual(secondResult.inputResults, [first.resultId]);
  assert.notEqual(secondResult.files[0].path, firstResult.files[0].path);

  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    "http://127.0.0.1:" + server.address().port +
      "/project-results/trim-project/" + first.resultId + "/primary",
    { headers: { Range: "bytes=0-9" } }
  );
  assert.equal(response.status, 206);
  assert.equal((await response.arrayBuffer()).byteLength, 10);

  const outputsBeforeFailure = (await readdir(join(rootDir, "trim-project", "outputs"))).sort();
  await assert.rejects(
    executor.execute("trim-project", {
      capability: "video.trim",
      tool: "ffmpeg-trim",
      purpose: "Mốc cắt vượt quá nguồn",
      inputs: {
        source: { kind: "resource", id: imported.resourceId },
        startSeconds: 0,
        endSeconds: 9
      }
    }),
    /vượt quá thời lượng/
  );
  assert.deepEqual(
    (await readdir(join(rootDir, "trim-project", "outputs"))).sort(),
    outputsBeforeFailure
  );
  const finalContext = await store.readContext("trim-project");
  assert.equal(finalContext.results.length, 2);
  assert.equal(finalContext.runs.filter((run) => run.status === "failed").length, 1);

  const projectDirectory = join(rootDir, "trim-project");
  const firstOutputDirectory = join(
    projectDirectory,
    ...firstResult.files[0].path.split("/").slice(0, -1)
  );
  const secondOutputDirectory = join(
    projectDirectory,
    ...secondResult.files[0].path.split("/").slice(0, -1)
  );
  await rm(firstOutputDirectory, { recursive: true });
  await symlink(secondOutputDirectory, firstOutputDirectory, "junction");
  assert.equal(
    (await new ProjectStore(rootDir).readResult("trim-project", first.resultId)).files[0].available,
    false
  );
  const redirectedResponse = await fetch(
    "http://127.0.0.1:" + server.address().port +
      "/project-results/trim-project/" + first.resultId + "/primary"
  );
  assert.equal(redirectedResponse.status, 404);
});
