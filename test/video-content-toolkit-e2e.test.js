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

test("image, concat, audio overlay and subtitle tools chain into one finished video", async (t) => {
  try {
    await Promise.all([
      execFileAsync("ffmpeg", ["-version"]),
      execFileAsync("ffprobe", ["-version"])
    ]);
  } catch {
    t.skip("ffmpeg/ffprobe are not installed");
    return;
  }

  const workspace = await mkdtemp(join(tmpdir(), "padstudio-content-toolkit-e2e-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");

  const photoPath = join(workspace, "photo.png");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=orange:s=640x480",
    "-frames:v", "1", "-y", photoPath
  ]);

  const videoPath = join(workspace, "clip.mp4");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25:d=2",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=2",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-y", videoPath
  ]);

  const musicPath = join(workspace, "music.wav");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100:duration=10",
    "-c:a", "pcm_s16le", "-y", musicPath
  ]);

  const store = new ProjectStore(rootDir);
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });

  const importedPhoto = await importProjectInput({ rootDir, projectId: "content", sourcePath: photoPath });
  const importedVideo = await importProjectInput({ rootDir, projectId: "content", sourcePath: videoPath });
  const importedMusic = await importProjectInput({ rootDir, projectId: "content", sourcePath: musicPath });

  // 1. Turn the still photo into a silent 2s clip.
  const imageToVideo = await executor.execute("content", {
    capability: "image.to-video",
    tool: "ffmpeg-image-to-video",
    purpose: "Mở đầu bằng ảnh chụp",
    inputs: { source: { kind: "resource", id: importedPhoto.resourceId }, durationSeconds: 2 }
  });
  const imageToVideoResult = await store.readResult("content", imageToVideo.resultId);
  assert.equal(imageToVideoResult.data.hasAudio, false);

  // 2. Concat the silent image-clip with a real audio+video clip of a
  // different resolution -> forces the normalize path and must synthesize
  // silent audio for the first (image-derived) segment.
  const concat = await executor.execute("content", {
    capability: "video.concat",
    tool: "ffmpeg-concat",
    purpose: "Ghép ảnh mở đầu với cảnh quay",
    inputs: {
      sources: [
        { kind: "result", id: imageToVideo.resultId, file: "primary" },
        { kind: "resource", id: importedVideo.resourceId }
      ]
    }
  });
  const concatResult = await store.readResult("content", concat.resultId);
  assert.equal(concatResult.data.losslessFastPath, false);
  assert.deepEqual(concatResult.data.audioSynthesizedIndexes, [0]);
  assert.ok(Math.abs(concatResult.data.durationSeconds - 4) <= 0.5);

  // 3. Layer background music under the assembled video.
  const overlay = await executor.execute("content", {
    capability: "audio.overlay",
    tool: "ffmpeg-audio-overlay",
    purpose: "Thêm nhạc nền",
    inputs: {
      video: { kind: "result", id: concat.resultId, file: "primary" },
      audio: { kind: "resource", id: importedMusic.resourceId },
      audioVolume: 0.4
    }
  });
  const overlayResult = await store.readResult("content", overlay.resultId);
  assert.equal(overlayResult.data.mode, "mix");
  assert.ok(Math.abs(overlayResult.data.durationSeconds - concatResult.data.durationSeconds) <= 0.5);

  // 4. Burn captions onto the final assembly.
  const subtitles = await executor.execute("content", {
    capability: "subtitle.burn",
    tool: "ffmpeg-subtitle-burn",
    purpose: "Ghim phụ đề",
    inputs: {
      source: { kind: "result", id: overlay.resultId, file: "primary" },
      cues: [
        { text: "Chào mừng", startSeconds: 0, endSeconds: 1.8 },
        { text: "Video giới thiệu", startSeconds: 1.8, endSeconds: 3.6 }
      ]
    }
  });
  const subtitlesResult = await store.readResult("content", subtitles.resultId);
  assert.equal(subtitlesResult.type, "video.captioned");
  assert.equal(subtitlesResult.data.orientation, "landscape");
  assert.equal(subtitlesResult.data.cueCount, 2);
  assert.equal(subtitlesResult.data.hasAudio, true);
  assert.equal(subtitlesResult.files[0].available, true);
  assert.deepEqual(subtitlesResult.inputResults, [overlay.resultId]);
});
