import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFfmpegVideoTrimmer,
  FfmpegTrimToolError
} from "../src/tools/ffmpeg-video-trimmer.js";

test("ffmpeg trim resolves a managed source, re-encodes and verifies the output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-trim-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "input.mp4");
  const temporaryOutputPath = join(directory, "clip.mp4");
  await writeFile(inputPath, "source");
  const calls = [];
  const executeCommand = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "-version") {
      return { stdout: command + " version 8.1.2" };
    }
    if (command === "ffprobe") {
      const output = args.at(-1) === temporaryOutputPath;
      return {
        stdout: JSON.stringify({
          format: { duration: output ? "1.5" : "3.0" },
          streams: [
            { codec_type: "video", width: 320, height: 180, avg_frame_rate: "25/1" },
            { codec_type: "audio" }
          ]
        })
      };
    }
    await writeFile(args.at(-1), "rendered clip");
    return { stdout: "", stderr: "" };
  };
  const tool = createFfmpegVideoTrimmer({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: {
      source: { kind: "resource", id: "resource-1", itemPath: null },
      startSeconds: 0.5,
      endSeconds: 2
    },
    outputWorkspace: {
      temporaryDirectory: directory,
      projectRelativeDirectory: "outputs/run-1"
    },
    store: {
      async resolveMediaSource() {
        return {
          filePath: inputPath,
          mediaType: "video",
          itemName: "input.mp4",
          trace: { kind: "resource", id: "resource-1", itemPath: "input.mp4" },
          inputResources: ["resource-1"],
          inputResults: []
        };
      }
    }
  });
  const execution = await tool.execute({
    ...prepared.runtime,
    availability: { executableVersion: "8.1.2" }
  });
  const result = tool.createResult({ prepared, execution });

  assert.equal(result.type, "video.clip");
  assert.deepEqual(result.inputResources, ["resource-1"]);
  assert.deepEqual(result.inputResults, []);
  assert.equal(result.files[0].path, "outputs/run-1/clip.mp4");
  assert.equal(result.data.durationSeconds, 1.5);
  assert.equal(result.data.hasAudio, true);
  assert.ok(result.verification.checks.includes("audio_stream_preserved"));
  const ffmpegCall = calls.find(([command, args]) => command === "ffmpeg" && args[0] !== "-version");
  assert.ok(ffmpegCall[1].includes("libx264"));
  assert.ok(ffmpegCall[1].includes("0:a?"));
});

test("ffmpeg trim rejects loose time values and non-video sources", async () => {
  const tool = createFfmpegVideoTrimmer();
  const base = {
    projectId: "demo",
    outputWorkspace: {
      temporaryDirectory: "temporary",
      projectRelativeDirectory: "outputs/run-1"
    },
    store: {
      async resolveMediaSource() {
        return {
          mediaType: "audio",
          filePath: "audio.mp3",
          itemName: "audio.mp3",
          trace: { kind: "resource", id: "resource-1" },
          inputResources: ["resource-1"],
          inputResults: []
        };
      }
    }
  };
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: {
        source: { kind: "resource", id: "resource-1" },
        startSeconds: "0",
        endSeconds: 1
      }
    }),
    (error) => error instanceof FfmpegTrimToolError && error.code === "invalid_input"
  );
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: {
        source: { kind: "resource", id: "resource-1" },
        startSeconds: 0,
        endSeconds: 1
      }
    }),
    (error) => error instanceof FfmpegTrimToolError && error.code === "unsupported_input"
  );
});
