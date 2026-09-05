import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFfmpegVideoThumbnailer,
  FfmpegThumbnailToolError
} from "../src/tools/ffmpeg-video-thumbnailer.js";

test("ffmpeg thumbnail extracts a frame at the exact requested timestamp", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-thumbnail-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "input.mp4");
  const temporaryOutputPath = join(directory, "thumbnail.png");
  await writeFile(inputPath, "source");
  const calls = [];
  const executeCommand = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "-version") return { stdout: command + " version 8.1.2" };
    if (command === "ffprobe") {
      return {
        stdout: JSON.stringify({
          format: { duration: "4.0" },
          streams: [{ codec_type: "video", width: 320, height: 180 }]
        })
      };
    }
    await writeFile(args.at(-1), "png bytes");
    return { stdout: "", stderr: "" };
  };
  const tool = createFfmpegVideoThumbnailer({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: { source: { kind: "resource", id: "resource-1" }, atSeconds: 1.5 },
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
  const execution = await tool.execute({ ...prepared.runtime, availability: { executableVersion: "8.1.2" } });
  const result = tool.createResult({ prepared, execution });

  assert.equal(result.type, "image.thumbnail");
  assert.equal(result.files[0].mediaType, "image");
  assert.deepEqual(result.data.resolution, { width: 320, height: 180 });
  const ffmpegCall = calls.find(([command, args]) => command === "ffmpeg" && args[0] !== "-version");
  const iIndex = ffmpegCall[1].indexOf("-i");
  const ssIndex = ffmpegCall[1].indexOf("-ss");
  assert.ok(ssIndex > iIndex, "-ss must come after -i for frame-accurate seeking");
  assert.ok(ffmpegCall[1].includes("1.5"));
});

test("ffmpeg thumbnail rejects a timestamp at or beyond the source duration", async () => {
  const tool = createFfmpegVideoThumbnailer({
    executeCommand: async (command, args) => {
      if (args[0] === "-version") return { stdout: command + " version 8.1.2" };
      return {
        stdout: JSON.stringify({
          format: { duration: "3.0" },
          streams: [{ codec_type: "video", width: 320, height: 180 }]
        })
      };
    }
  });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: { source: { kind: "resource", id: "resource-1" }, atSeconds: 3 },
    outputWorkspace: { temporaryDirectory: "temporary", projectRelativeDirectory: "outputs/run-1" },
    store: {
      async resolveMediaSource() {
        return {
          filePath: "input.mp4",
          mediaType: "video",
          itemName: "input.mp4",
          trace: { kind: "resource", id: "resource-1" },
          inputResources: ["resource-1"],
          inputResults: []
        };
      }
    }
  });
  await assert.rejects(
    tool.execute({ ...prepared.runtime, availability: {} }),
    (error) => error instanceof FfmpegThumbnailToolError && error.code === "invalid_input"
  );
});
