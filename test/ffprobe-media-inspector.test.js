import assert from "node:assert/strict";
import test from "node:test";
import {
  createFfprobeMediaInspector,
  FfprobeToolError
} from "../src/tools/ffprobe-media-inspector.js";

const probeOutput = {
  format: {
    format_name: "mov,mp4",
    format_long_name: "QuickTime / MOV",
    duration: "2.500",
    size: "2048",
    bit_rate: "6553",
    start_time: "0.000"
  },
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      pix_fmt: "yuv420p",
      avg_frame_rate: "30/1"
    },
    {
      index: 1,
      codec_type: "audio",
      codec_name: "aac",
      sample_rate: "48000",
      channels: 2,
      channel_layout: "stereo"
    }
  ]
};

test("ffprobe tool validates a project resource and normalizes probe output", async () => {
  const calls = [];
  const tool = createFfprobeMediaInspector({
    command: "custom-ffprobe",
    async executeCommand(command, args) {
      calls.push([command, args]);
      if (args[0] === "-version") {
        return { stdout: "ffprobe version 8.1.2-full\n", stderr: "" };
      }
      return { stdout: JSON.stringify(probeOutput), stderr: "" };
    }
  });
  const store = {
    async resolveInputResourceItem() {
      return {
        resourceId: "resource-1",
        itemPath: "clip.mp4",
        itemName: "clip.mp4",
        mediaType: "video",
        filePath: "C:\\project\\inputs\\clip.mp4"
      };
    }
  };

  const availability = await tool.checkAvailability();
  const prepared = await tool.prepare({
    store,
    projectId: "demo",
    inputs: { resourceId: "resource-1" }
  });
  const execution = await tool.execute({ ...prepared.runtime, availability });
  const result = tool.createResult({ prepared, execution });

  assert.equal(availability.status, "available");
  assert.equal(availability.executableVersion, "8.1.2-full");
  assert.equal(execution.data.format.durationSeconds, 2.5);
  assert.equal(execution.data.format.sizeBytes, 2048);
  assert.deepEqual(
    execution.data.streams.map((stream) => [stream.type, stream.codec]),
    [["video", "h264"], ["audio", "aac"]]
  );
  assert.equal(execution.data.streams[0].width, 1920);
  assert.equal(execution.data.streams[1].sampleRate, 48000);
  assert.deepEqual(result.inputResources, ["resource-1"]);
  assert.equal(result.data.source.itemPath, "clip.mp4");
  assert.equal(result.verification.status, "passed");
  assert.equal(calls[1][0], "custom-ffprobe");
  assert.deepEqual(calls[1][1].slice(0, 6), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams"
  ]);
});

test("ffprobe tool reports a missing executable without pretending to be available", async () => {
  const tool = createFfprobeMediaInspector({
    async executeCommand() {
      const error = new Error("spawn ffprobe ENOENT");
      error.code = "ENOENT";
      throw error;
    }
  });
  const availability = await tool.checkAvailability();
  assert.equal(availability.status, "unavailable");
  assert.match(availability.reason, /Không tìm thấy ffprobe/);
});

test("ffprobe tool rejects unsupported input and malformed output", async () => {
  const unsupported = createFfprobeMediaInspector();
  await assert.rejects(
    unsupported.prepare({
      projectId: "demo",
      inputs: { resourceId: "resource-1", typo: true },
      store: { async resolveInputResourceItem() {} }
    }),
    (error) => error instanceof FfprobeToolError && error.code === "invalid_input"
  );

  const malformed = createFfprobeMediaInspector({
    async executeCommand() {
      return { stdout: "not-json", stderr: "" };
    }
  });
  await assert.rejects(
    malformed.execute({
      filePath: "C:\\project\\inputs\\clip.mp4",
      availability: { status: "available" }
    }),
    (error) => error instanceof FfprobeToolError && error.code === "invalid_output"
  );

  const malformedStream = createFfprobeMediaInspector({
    async executeCommand() {
      return { stdout: JSON.stringify({ format: {}, streams: [null] }), stderr: "" };
    }
  });
  await assert.rejects(
    malformedStream.execute({
      filePath: "C:\\project\\inputs\\clip.mp4",
      availability: { status: "available" }
    }),
    (error) => error instanceof FfprobeToolError && error.code === "invalid_output"
  );
});
