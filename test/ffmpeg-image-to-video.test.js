import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFfmpegImageToVideo,
  FfmpegImageToVideoToolError
} from "../src/tools/ffmpeg-image-to-video.js";

test("image to video holds the source frame for the requested duration", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-image-to-video-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "photo.jpg");
  const temporaryOutputPath = join(directory, "clip.mp4");
  await writeFile(inputPath, "source");
  const calls = [];
  const executeCommand = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "-version") return { stdout: command + " version 8.1.2" };
    if (command === "ffprobe") {
      const output = args.at(-1) === temporaryOutputPath;
      return {
        stdout: JSON.stringify({
          format: { duration: output ? "3.0" : "0" },
          streams: [{ codec_type: "video", width: output ? 1282 : 1281, height: 720 }]
        })
      };
    }
    await writeFile(args.at(-1), "rendered clip");
    return { stdout: "", stderr: "" };
  };
  const tool = createFfmpegImageToVideo({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: { source: { kind: "resource", id: "resource-1" }, durationSeconds: 3 },
    outputWorkspace: { temporaryDirectory: directory, projectRelativeDirectory: "outputs/run-1" },
    store: {
      async resolveMediaSource() {
        return {
          filePath: inputPath,
          mediaType: "image",
          itemName: "photo.jpg",
          trace: { kind: "resource", id: "resource-1" },
          inputResources: ["resource-1"],
          inputResults: []
        };
      }
    }
  });
  const execution = await tool.execute({ ...prepared.runtime, availability: { executableVersion: "8.1.2" } });
  const result = tool.createResult({ prepared, execution });

  assert.equal(result.type, "video.clip");
  assert.equal(result.data.durationSeconds, 3);
  assert.equal(result.data.hasAudio, false);
  const ffmpegCall = calls.find(([command, args]) => command === "ffmpeg" && args[0] !== "-version");
  assert.ok(ffmpegCall[1].includes("-loop"));
  assert.ok(ffmpegCall[1].some((arg) => typeof arg === "string" && arg.includes("trunc(iw/2)*2")));
});

test("image to video builds a zoompan motion curve over the exact frame count", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-image-to-video-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "photo.jpg");
  const temporaryOutputPath = join(directory, "clip.mp4");
  await writeFile(inputPath, "source");
  const calls = [];
  const executeCommand = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "-version") return { stdout: command + " version 8.1.2" };
    if (command === "ffprobe") {
      const output = args.at(-1) === temporaryOutputPath;
      return {
        stdout: JSON.stringify({
          format: { duration: output ? "2.0" : "0" },
          streams: [{ codec_type: "video", width: 800, height: 600 }]
        })
      };
    }
    await writeFile(args.at(-1), "rendered clip");
    return { stdout: "", stderr: "" };
  };
  const tool = createFfmpegImageToVideo({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: { source: { kind: "resource", id: "resource-1" }, durationSeconds: 2, motion: "kenBurns" },
    outputWorkspace: { temporaryDirectory: directory, projectRelativeDirectory: "outputs/run-1" },
    store: {
      async resolveMediaSource() {
        return {
          filePath: inputPath,
          mediaType: "image",
          itemName: "photo.jpg",
          trace: { kind: "resource", id: "resource-1" },
          inputResources: ["resource-1"],
          inputResults: []
        };
      }
    }
  });
  const execution = await tool.execute({ ...prepared.runtime, availability: { executableVersion: "8.1.2" } });
  const result = tool.createResult({ prepared, execution });

  assert.equal(result.data.motion, "kenBurns");
  const ffmpegCall = calls.find(([command, args]) => command === "ffmpeg" && args[0] !== "-version");
  const filter = ffmpegCall[1][ffmpegCall[1].indexOf("-vf") + 1];
  assert.ok(filter.includes("zoompan"));
  // 2s at the tool's fixed 30fps is exactly 60 frames, so the last frame
  // index (on=59) must appear as the interpolation denominator.
  assert.ok(filter.includes("/59"), "the motion curve must span the exact requested frame count");
  assert.ok(!ffmpegCall[1].includes("-r"), "zoompan's own fps= already sets the frame rate");
});

test("image to video falls back to a static hold when a clip is too short to interpolate", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-image-to-video-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tool = createFfmpegImageToVideo({
    executeCommand: async (command, args) => {
      if (args[0] === "-version") return { stdout: command + " version 8.1.2" };
      if (command === "ffprobe") {
        return {
          stdout: JSON.stringify({
            format: { duration: "0.03" },
            streams: [{ codec_type: "video", width: 800, height: 600 }]
          })
        };
      }
      await writeFile(args.at(-1), "rendered clip");
      return { stdout: "", stderr: "" };
    }
  });
  // Bypass prepare()'s MIN_DURATION_SECONDS floor to exercise the totalFrames<2
  // guard directly — real callers can never reach this via the public schema,
  // but the guard exists specifically to avoid a division by zero in the
  // motion curve, so it must not silently regress.
  const execution = await tool.execute({
    inputPath: join(directory, "photo.jpg"),
    temporaryOutputPath: join(directory, "clip.mp4"),
    durationSeconds: 0.03,
    motion: "kenBurns",
    availability: {}
  });
  assert.equal(execution.effectiveMotion, "static");
});

test("image to video rejects an unsupported motion preset", async () => {
  const tool = createFfmpegImageToVideo();
  await assert.rejects(
    tool.prepare({
      projectId: "demo",
      inputs: { source: { kind: "resource", id: "resource-1" }, durationSeconds: 2, motion: "spin" },
      outputWorkspace: { temporaryDirectory: "temporary", projectRelativeDirectory: "outputs/run-1" },
      store: {
        async resolveMediaSource() {
          return {
            filePath: "photo.jpg",
            mediaType: "image",
            itemName: "photo.jpg",
            trace: { kind: "resource", id: "resource-1" },
            inputResources: ["resource-1"],
            inputResults: []
          };
        }
      }
    }),
    (error) => error instanceof FfmpegImageToVideoToolError && error.code === "invalid_input"
  );
});

test("image to video rejects out-of-range durations and non-image sources", async () => {
  const tool = createFfmpegImageToVideo();
  const base = {
    projectId: "demo",
    outputWorkspace: { temporaryDirectory: "temporary", projectRelativeDirectory: "outputs/run-1" },
    store: {
      async resolveMediaSource() {
        return {
          filePath: "photo.jpg",
          mediaType: "image",
          itemName: "photo.jpg",
          trace: { kind: "resource", id: "resource-1" },
          inputResources: ["resource-1"],
          inputResults: []
        };
      }
    }
  };
  await assert.rejects(
    tool.prepare({ ...base, inputs: { source: { kind: "resource", id: "resource-1" }, durationSeconds: 0 } }),
    (error) => error instanceof FfmpegImageToVideoToolError && error.code === "invalid_input"
  );
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: { source: { kind: "resource", id: "resource-1" }, durationSeconds: 3 },
      store: {
        async resolveMediaSource() {
          return {
            filePath: "video.mp4",
            mediaType: "video",
            itemName: "video.mp4",
            trace: { kind: "resource", id: "resource-1" },
            inputResources: ["resource-1"],
            inputResults: []
          };
        }
      }
    }),
    (error) => error instanceof FfmpegImageToVideoToolError && error.code === "unsupported_input"
  );
});
