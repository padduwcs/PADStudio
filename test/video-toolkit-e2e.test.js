import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ProjectStore } from "../src/project/project-store.js";
import { importProjectInput } from "../src/resources/project-importer.js";

const execFileAsync = promisify(execFile);

test("video toolkit chains concat, reformat and thumbnail into a durable pipeline", async (t) => {
  try {
    await Promise.all([
      execFileAsync("ffmpeg", ["-version"]),
      execFileAsync("ffprobe", ["-version"])
    ]);
  } catch {
    t.skip("ffmpeg/ffprobe are not installed");
    return;
  }

  const workspace = await mkdtemp(join(tmpdir(), "padstudio-toolkit-e2e-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");

  async function makeClip(name, { color, width, height, duration, withAudio = true }) {
    const path = join(workspace, name);
    const args = [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}:r=25:d=${duration}`
    ];
    if (withAudio) {
      args.push("-f", "lavfi", "-i", `sine=frequency=440:sample_rate=44100:duration=${duration}`);
      args.push("-shortest", "-c:a", "aac");
    }
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", path);
    await execFileAsync("ffmpeg", args);
    return path;
  }

  const clipA = await makeClip("a.mp4", { color: "blue", width: 320, height: 180, duration: 2 });
  const clipB = await makeClip("b.mp4", { color: "red", width: 320, height: 180, duration: 2 });
  const clipC = await makeClip("c.mp4", { color: "green", width: 640, height: 360, duration: 2 });
  const clipD = await makeClip("d.mp4", { color: "yellow", width: 320, height: 180, duration: 2, withAudio: false });

  const store = new ProjectStore(rootDir);
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });

  const importedA = await importProjectInput({ rootDir, projectId: "toolkit", sourcePath: clipA });
  const importedB = await importProjectInput({ rootDir, projectId: "toolkit", sourcePath: clipB });
  const importedC = await importProjectInput({ rootDir, projectId: "toolkit", sourcePath: clipC });
  const importedD = await importProjectInput({ rootDir, projectId: "toolkit", sourcePath: clipD });

  // Same resolution/codec/audio layout, cut transition -> lossless fast path.
  const fastConcat = await executor.execute("toolkit", {
    capability: "video.concat",
    tool: "ffmpeg-concat",
    purpose: "Ghép hai clip cùng định dạng",
    inputs: {
      sources: [
        { kind: "resource", id: importedA.resourceId },
        { kind: "resource", id: importedB.resourceId }
      ]
    }
  });
  const fastResult = await store.readResult("toolkit", fastConcat.resultId);
  assert.equal(fastResult.data.losslessFastPath, true);
  assert.ok(Math.abs(fastResult.data.durationSeconds - 4) <= 0.5);
  assert.equal(fastResult.data.hasAudio, true);
  assert.equal(fastResult.files[0].available, true);

  // Mismatched resolution, crossfade -> normalize path with an overlap-adjusted duration.
  const crossfadeConcat = await executor.execute("toolkit", {
    capability: "video.concat",
    tool: "ffmpeg-concat",
    purpose: "Ghép hai clip khác định dạng có chuyển cảnh",
    inputs: {
      sources: [
        { kind: "resource", id: importedA.resourceId },
        { kind: "resource", id: importedC.resourceId }
      ],
      transition: "crossfade",
      transitionSeconds: 0.5
    }
  });
  const crossfadeResult = await store.readResult("toolkit", crossfadeConcat.resultId);
  assert.equal(crossfadeResult.data.losslessFastPath, false);
  assert.ok(Math.abs(crossfadeResult.data.durationSeconds - 3.5) <= 0.5);
  assert.equal(crossfadeResult.data.video.width, 320);
  assert.equal(crossfadeResult.data.video.height, 180);

  // One clip has no audio track at all -> forced onto the normalize path even
  // with a plain cut, and a silent track must be synthesized so the concat
  // filter's audio graph does not fail.
  const silentConcat = await executor.execute("toolkit", {
    capability: "video.concat",
    tool: "ffmpeg-concat",
    purpose: "Ghép clip có tiếng với clip không có tiếng",
    inputs: {
      sources: [
        { kind: "resource", id: importedA.resourceId },
        { kind: "resource", id: importedD.resourceId }
      ]
    }
  });
  const silentResult = await store.readResult("toolkit", silentConcat.resultId);
  assert.equal(silentResult.data.losslessFastPath, false);
  assert.deepEqual(silentResult.data.audioSynthesizedIndexes, [1]);
  assert.equal(silentResult.data.hasAudio, true);
  assert.ok(Math.abs(silentResult.data.durationSeconds - 4) <= 0.5);

  // Reformat the fast-path concat result (chained via result-as-source) to portrait.
  const reformat = await executor.execute("toolkit", {
    capability: "video.reformat",
    tool: "ffmpeg-reformat",
    purpose: "Đổi sang khung dọc cho mạng xã hội",
    inputs: {
      source: { kind: "result", id: fastConcat.resultId, file: "primary" },
      preset: "portrait"
    }
  });
  const reformatResult = await store.readResult("toolkit", reformat.resultId);
  assert.deepEqual(reformatResult.data.targetResolution, { width: 1080, height: 1920 });
  assert.deepEqual(reformatResult.inputResults, [fastConcat.resultId]);

  // Thumbnail the reformatted result partway through its duration.
  const thumbnail = await executor.execute("toolkit", {
    capability: "video.thumbnail",
    tool: "ffmpeg-thumbnail",
    purpose: "Trích ảnh đại diện",
    inputs: {
      source: { kind: "result", id: reformat.resultId, file: "primary" },
      atSeconds: 1
    }
  });
  const thumbnailResult = await store.readResult("toolkit", thumbnail.resultId);
  assert.equal(thumbnailResult.files[0].mediaType, "image");
  assert.deepEqual(thumbnailResult.data.resolution, { width: 1080, height: 1920 });
  assert.equal(thumbnailResult.files[0].available, true);

  // A single source is rejected before any output is produced.
  const outputsBeforeFailure = await store.readRuns("toolkit");
  await assert.rejects(
    executor.execute("toolkit", {
      capability: "video.concat",
      tool: "ffmpeg-concat",
      purpose: "Thiếu clip thứ hai",
      inputs: { sources: [{ kind: "resource", id: importedA.resourceId }] }
    }),
    /ít nhất 2 sources/
  );
  const runsAfterFailure = await store.readRuns("toolkit");
  assert.equal(runsAfterFailure.length, outputsBeforeFailure.length + 1);
  assert.equal(runsAfterFailure[0].status, "failed");
});
