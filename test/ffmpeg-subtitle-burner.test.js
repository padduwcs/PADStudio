import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFfmpegSubtitleBurner,
  FfmpegSubtitleBurnToolError
} from "../src/tools/ffmpeg-subtitle-burner.js";

function fakeStore(inputPath) {
  return {
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
  };
}

test("subtitle burn picks portrait styling and writes a well-formed SRT", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-subtitle-tool-"));
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
            { codec_type: "video", width: 1080, height: 1920 },
            { codec_type: "audio" }
          ]
        })
      };
    }
    await writeFile(args.at(-1), "rendered clip");
    return { stdout: "", stderr: "" };
  };
  const tool = createFfmpegSubtitleBurner({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: {
      source: { kind: "resource", id: "resource-1" },
      cues: [
        { text: "Xin chào", startSeconds: 0, endSeconds: 1.5 },
        { text: "Chào mừng bạn", startSeconds: 1.5, endSeconds: 3.9995 }
      ]
    },
    outputWorkspace: { temporaryDirectory: directory, projectRelativeDirectory: "outputs/run-1" },
    store: fakeStore(inputPath)
  });
  const srtContent = await readFile(prepared.runtime.subtitlePath, "utf8");
  assert.ok(srtContent.includes("00:00:00,000 --> 00:00:01,500"));
  assert.ok(srtContent.includes("00:00:01,500 --> 00:00:04,000"), "0.9995s must carry into the next whole second");

  const execution = await tool.execute({ ...prepared.runtime, availability: { executableVersion: "8.1.2" } });
  const result = tool.createResult({ prepared, execution });

  assert.equal(result.type, "video.captioned");
  assert.equal(result.data.orientation, "portrait");
  assert.equal(result.data.fontSize, 18);
  assert.equal(result.data.cueCount, 2);
  const ffmpegCall = calls.find(([command, args]) => command === "ffmpeg" && args[0] !== "-version");
  const filter = ffmpegCall[1][ffmpegCall[1].indexOf("-vf") + 1];
  assert.ok(filter.startsWith("subtitles=filename="));
  assert.ok(filter.includes("FontSize=18"));
  assert.ok(!filter.includes("\\\\"), "the escaped path must not double-escape existing backslashes");
});

test("subtitle burn rejects overlapping cues and cues past the source duration", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-subtitle-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tool = createFfmpegSubtitleBurner();
  const base = {
    projectId: "demo",
    outputWorkspace: { temporaryDirectory: directory, projectRelativeDirectory: "outputs/run-1" },
    store: fakeStore("input.mp4")
  };
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: {
        source: { kind: "resource", id: "resource-1" },
        cues: [
          { text: "A", startSeconds: 0, endSeconds: 2 },
          { text: "B", startSeconds: 1, endSeconds: 3 }
        ]
      }
    }),
    (error) => error instanceof FfmpegSubtitleBurnToolError && error.code === "invalid_input"
  );

  const executeCommand = async (command, args) => {
    if (args[0] === "-version") return { stdout: command + " version 8.1.2" };
    return {
      stdout: JSON.stringify({
        format: { duration: "2.0" },
        streams: [{ codec_type: "video", width: 1920, height: 1080 }]
      })
    };
  };
  const tool2 = createFfmpegSubtitleBurner({ executeCommand });
  const prepared = await tool2.prepare({
    ...base,
    inputs: {
      source: { kind: "resource", id: "resource-1" },
      cues: [{ text: "Too late", startSeconds: 1, endSeconds: 5 }]
    }
  });
  await assert.rejects(
    tool2.execute({ ...prepared.runtime, availability: {} }),
    (error) => error instanceof FfmpegSubtitleBurnToolError && error.code === "invalid_input"
  );
});
