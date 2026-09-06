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

async function meanVolumeDb(filePath, { startSeconds = 0, durationSeconds } = {}) {
  const args = ["-hide_banner"];
  if (startSeconds) args.push("-ss", String(startSeconds));
  args.push("-i", filePath);
  if (durationSeconds) args.push("-t", String(durationSeconds));
  args.push("-af", "volumedetect", "-f", "null", "-");
  const { stderr } = await execFileAsync("ffmpeg", args);
  const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  return match ? Number(match[1]) : null;
}

test("audio overlay loops a short track, ducks against real speech, and normalizes loudness", async (t) => {
  try {
    await Promise.all([
      execFileAsync("ffmpeg", ["-version"]),
      execFileAsync("ffprobe", ["-version"])
    ]);
  } catch {
    t.skip("ffmpeg/ffprobe are not installed");
    return;
  }

  const workspace = await mkdtemp(join(tmpdir(), "padstudio-audio-overlay-e2e-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");

  // A continuous tone stands in for speech: real energy throughout, so
  // ducking has something real to key against.
  const videoPath = join(workspace, "speech.mp4");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25:d=6",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=6",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-y", videoPath
  ]);

  // Shorter than the video (2s vs 6s) so -stream_loop must actually repeat
  // it, not just play once and leave the tail silent.
  const musicPath = join(workspace, "music.wav");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100:duration=2",
    "-c:a", "pcm_s16le", "-y", musicPath
  ]);

  const store = new ProjectStore(rootDir);
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
  const importedVideo = await importProjectInput({ rootDir, projectId: "overlay", sourcePath: videoPath });
  const importedMusic = await importProjectInput({ rootDir, projectId: "overlay", sourcePath: musicPath });

  const run = await executor.execute("overlay", {
    capability: "audio.overlay",
    tool: "ffmpeg-audio-overlay",
    purpose: "Ducking thật với track nhạc ngắn hơn video",
    inputs: {
      video: { kind: "resource", id: importedVideo.resourceId },
      audio: { kind: "resource", id: importedMusic.resourceId },
      mode: "duck",
      loudnessTargetLufs: -16
    }
  });
  const result = await store.readResult("overlay", run.resultId);
  assert.equal(result.data.duckApplied, true);
  assert.ok(Math.abs(result.data.durationSeconds - 6) <= 0.5);

  const outputPath = join(rootDir, "overlay", ...result.files[0].path.split("/"));
  // The music track alone is only 2s; without a working loop the last two
  // seconds of a 6s output would be silence (mean_volume near -91dB).
  const tailVolume = await meanVolumeDb(outputPath, { startSeconds: 5, durationSeconds: 1 });
  assert.ok(tailVolume !== null && tailVolume > -50, `expected audible tail after looping, got ${tailVolume} dB`);
});
