import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createFfmpegSubtitleBurner } from "../src/tools/ffmpeg-subtitle-burner.js";

const execFileAsync = promisify(execFile);

test("subtitle burn survives a single quote in the project path", async (t) => {
  try {
    await Promise.all([
      execFileAsync("ffmpeg", ["-version"]),
      execFileAsync("ffprobe", ["-version"])
    ]);
  } catch {
    t.skip("ffmpeg/ffprobe are not installed");
    return;
  }

  const base = await mkdtemp(join(tmpdir(), "padstudio-subtitle-quote-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  // A literal apostrophe in an ancestor directory name is the exact case
  // escapeSubtitlesFilterPath exists to survive: without escaping it, the
  // quote would end the subtitles filter's quoted filename early and ffmpeg
  // would fail to parse the rest of force_style as a stray filter option.
  const directory = join(base, "Duc's Project", "outputs", "run-1");
  await mkdir(directory, { recursive: true });

  const inputPath = join(directory, "input.mp4");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25:d=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", inputPath
  ]);

  const tool = createFfmpegSubtitleBurner();
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: {
      source: { kind: "resource", id: "resource-1" },
      cues: [{ text: "Xin chào", startSeconds: 0, endSeconds: 1 }]
    },
    outputWorkspace: { temporaryDirectory: directory, projectRelativeDirectory: "outputs/run-1" },
    store: {
      async resolveMediaSource() {
        return {
          filePath: inputPath,
          mediaType: "video",
          itemName: "input.mp4",
          trace: { kind: "resource", id: "resource-1" },
          inputResources: ["resource-1"],
          inputResults: []
        };
      }
    }
  });
  const execution = await tool.execute({ ...prepared.runtime, availability: {} });
  assert.equal(execution.verification.status, "passed");
});
