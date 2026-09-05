import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFfmpegVideoReformatter,
  FfmpegReformatToolError
} from "../src/tools/ffmpeg-video-reformatter.js";

test("ffmpeg reformat pads a landscape source into a portrait preset", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-reformat-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "input.mp4");
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
          format: { duration: "4.0" },
          streams: [
            {
              codec_type: "video",
              width: output ? 1080 : 1920,
              height: output ? 1920 : 1080
            },
            { codec_type: "audio" }
          ]
        })
      };
    }
    await writeFile(args.at(-1), "rendered clip");
    return { stdout: "", stderr: "" };
  };
  const tool = createFfmpegVideoReformatter({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: { source: { kind: "resource", id: "resource-1" }, preset: "portrait" },
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

  assert.equal(result.type, "video.reformatted");
  assert.deepEqual(result.data.targetResolution, { width: 1080, height: 1920 });
  assert.equal(result.data.fit, "pad");
  assert.equal(result.data.hasAudio, true);
  const ffmpegCall = calls.find(([command, args]) => command === "ffmpeg" && args[0] !== "-version");
  assert.ok(ffmpegCall[1].some((arg) => typeof arg === "string" && arg.includes("pad=1080:1920")));
});

test("ffmpeg reformat rejects mixing preset with explicit size and unknown presets", async () => {
  const tool = createFfmpegVideoReformatter();
  const base = {
    projectId: "demo",
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
  };
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: { source: { kind: "resource", id: "resource-1" }, preset: "portrait", width: 1080, height: 1920 }
    }),
    (error) => error instanceof FfmpegReformatToolError && error.code === "invalid_input"
  );
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: { source: { kind: "resource", id: "resource-1" } }
    }),
    (error) => error instanceof FfmpegReformatToolError && error.code === "invalid_input"
  );
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: { source: { kind: "resource", id: "resource-1" }, preset: "ultrawide" }
    }),
    (error) => error instanceof FfmpegReformatToolError && error.code === "invalid_input"
  );
});
