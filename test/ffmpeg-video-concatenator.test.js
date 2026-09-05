import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFfmpegVideoConcatenator,
  FfmpegConcatToolError
} from "../src/tools/ffmpeg-video-concatenator.js";

function probeJson({ duration, width = 320, height = 180, frameRate = "25/1", hasAudio = true }) {
  const streams = [{ codec_type: "video", width, height, avg_frame_rate: frameRate, codec_name: "h264", pix_fmt: "yuv420p" }];
  if (hasAudio) streams.push({ codec_type: "audio", codec_name: "aac", sample_rate: "44100", channels: 2 });
  return JSON.stringify({ format: { duration: String(duration) }, streams });
}

function fakeStore(paths) {
  let index = 0;
  return {
    async resolveMediaSource() {
      const filePath = paths[index];
      index += 1;
      return {
        filePath,
        mediaType: "video",
        itemName: "clip-" + index + ".mp4",
        trace: { kind: "resource", id: "resource-" + index },
        inputResources: ["resource-" + index],
        inputResults: []
      };
    }
  };
}

test("video concat uses the lossless fast path when clips already match", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-concat-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clip1 = join(directory, "clip1.mp4");
  const clip2 = join(directory, "clip2.mp4");
  const temporaryOutputPath = join(directory, "clip.mp4");
  await writeFile(clip1, "a");
  await writeFile(clip2, "b");

  const probes = new Map([
    [clip1, probeJson({ duration: 2 })],
    [clip2, probeJson({ duration: 3 })],
    [temporaryOutputPath, probeJson({ duration: 5 })]
  ]);
  const calls = [];
  const executeCommand = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "-version") return { stdout: command + " version 8.1.2" };
    if (command === "ffprobe") {
      const target = args.at(-1);
      if (!probes.has(target)) throw new Error("unexpected probe target: " + target);
      return { stdout: probes.get(target) };
    }
    await writeFile(args.at(-1), "rendered");
    return { stdout: "", stderr: "" };
  };

  const tool = createFfmpegVideoConcatenator({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: {
      sources: [
        { kind: "resource", id: "resource-1" },
        { kind: "resource", id: "resource-2" }
      ]
    },
    outputWorkspace: { temporaryDirectory: directory, projectRelativeDirectory: "outputs/run-1" },
    store: fakeStore([clip1, clip2])
  });
  const execution = await tool.execute({ ...prepared.runtime, availability: { executableVersion: "8.1.2" } });
  const result = tool.createResult({ prepared, execution });

  assert.equal(result.type, "video.clip");
  assert.deepEqual(result.inputResources, ["resource-1", "resource-2"]);
  assert.equal(result.data.losslessFastPath, true);
  assert.equal(result.data.durationSeconds, 5);
  assert.equal(result.data.hasAudio, true);
  assert.deepEqual(result.data.audioSynthesizedIndexes, []);
  const ffmpegCall = calls.find(([command, args]) => command === "ffmpeg" && args[0] !== "-version");
  assert.ok(ffmpegCall[1].includes("copy"));
  assert.ok(ffmpegCall[1].includes("concat"));
});

test("video concat crossfades mismatched clips and accounts for the overlap", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-concat-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clip1 = join(directory, "clip1.mp4");
  const clip2 = join(directory, "clip2.mp4");
  const temporaryOutputPath = join(directory, "clip.mp4");
  await writeFile(clip1, "a");
  await writeFile(clip2, "b");

  const probes = new Map([
    [clip1, probeJson({ duration: 2, width: 320, height: 180 })],
    [clip2, probeJson({ duration: 3, width: 640, height: 360 })],
    [temporaryOutputPath, probeJson({ duration: 4.5, width: 320, height: 180 })]
  ]);
  const executeCommand = async (command, args) => {
    if (args[0] === "-version") return { stdout: command + " version 8.1.2" };
    if (command === "ffprobe") {
      const target = args.at(-1);
      if (!probes.has(target)) throw new Error("unexpected probe target: " + target);
      return { stdout: probes.get(target) };
    }
    await writeFile(args.at(-1), "rendered");
    return { stdout: "", stderr: "" };
  };

  const tool = createFfmpegVideoConcatenator({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: {
      sources: [
        { kind: "resource", id: "resource-1" },
        { kind: "resource", id: "resource-2" }
      ],
      transition: "crossfade",
      transitionSeconds: 0.5
    },
    outputWorkspace: { temporaryDirectory: directory, projectRelativeDirectory: "outputs/run-1" },
    store: fakeStore([clip1, clip2])
  });
  const execution = await tool.execute({ ...prepared.runtime, availability: { executableVersion: "8.1.2" } });
  const result = tool.createResult({ prepared, execution });

  assert.equal(result.data.losslessFastPath, false);
  assert.equal(result.data.transition, "crossfade");
  assert.equal(result.data.durationSeconds, 4.5);
  assert.ok(result.verification.checks.includes("audio_stream_preserved"));
});

test("video concat rejects fewer than two sources, unknown transitions and non-video input", async () => {
  const tool = createFfmpegVideoConcatenator();
  const base = {
    projectId: "demo",
    outputWorkspace: { temporaryDirectory: "temporary", projectRelativeDirectory: "outputs/run-1" }
  };
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: { sources: [{ kind: "resource", id: "resource-1" }] },
      store: fakeStore(["a"])
    }),
    (error) => error instanceof FfmpegConcatToolError && error.code === "invalid_input"
  );
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: {
        sources: [{ kind: "resource", id: "resource-1" }, { kind: "resource", id: "resource-2" }],
        transition: "dissolve"
      },
      store: fakeStore(["a", "b"])
    }),
    (error) => error instanceof FfmpegConcatToolError && error.code === "invalid_input"
  );
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: {
        sources: [{ kind: "resource", id: "resource-1" }, { kind: "resource", id: "resource-2" }],
        transitionSeconds: 0.5
      },
      store: fakeStore(["a", "b"])
    }),
    (error) => error instanceof FfmpegConcatToolError && error.code === "invalid_input"
  );
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: {
        sources: [{ kind: "resource", id: "resource-1" }, { kind: "resource", id: "resource-2" }]
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
    }),
    (error) => error instanceof FfmpegConcatToolError && error.code === "unsupported_input"
  );
});
