import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFfmpegAudioOverlay,
  FfmpegAudioOverlayToolError
} from "../src/tools/ffmpeg-audio-overlay.js";

function fakeStore({ videoHasAudio }) {
  return {
    async resolveMediaSource(_projectId, source) {
      if (source.kind === "resource" && source.id === "resource-video") {
        return {
          filePath: "video.mp4",
          mediaType: "video",
          itemName: "video.mp4",
          trace: { kind: "resource", id: "resource-video" },
          inputResources: ["resource-video"],
          inputResults: []
        };
      }
      return {
        filePath: "music.mp3",
        mediaType: "audio",
        itemName: "music.mp3",
        trace: { kind: "resource", id: "resource-audio" },
        inputResources: ["resource-audio"],
        inputResults: []
      };
    }
  };
}

function makeExecuteCommand({ videoDuration, videoHasAudio, outputHasAudio = true }) {
  const calls = [];
  const executeCommand = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "-version") return { stdout: command + " version 8.1.2" };
    if (command === "ffprobe") {
      const target = args.at(-1);
      if (target === "video.mp4") {
        return {
          stdout: JSON.stringify({
            format: { duration: String(videoDuration) },
            streams: [
              { codec_type: "video" },
              ...(videoHasAudio ? [{ codec_type: "audio" }] : [])
            ]
          })
        };
      }
      if (target === "music.mp3") {
        return {
          stdout: JSON.stringify({
            format: { duration: "10" },
            streams: [{ codec_type: "audio" }]
          })
        };
      }
      return {
        stdout: JSON.stringify({
          format: { duration: String(videoDuration) },
          streams: [
            { codec_type: "video" },
            ...(outputHasAudio ? [{ codec_type: "audio" }] : [])
          ]
        })
      };
    }
    await writeFile(args.at(-1), "rendered");
    return { stdout: "", stderr: "" };
  };
  return { executeCommand, calls };
}

test("audio overlay mixes an added track without silently halving the video's own audio", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-audio-overlay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { executeCommand, calls } = makeExecuteCommand({ videoDuration: 5, videoHasAudio: true });
  const tool = createFfmpegAudioOverlay({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: {
      video: { kind: "resource", id: "resource-video" },
      audio: { kind: "resource", id: "resource-audio" },
      audioVolume: 0.3
    },
    outputWorkspace: { temporaryDirectory: directory, projectRelativeDirectory: "outputs/run-1" },
    store: fakeStore({ videoHasAudio: true })
  });
  const execution = await tool.execute({ ...prepared.runtime, availability: { executableVersion: "8.1.2" } });
  const result = tool.createResult({ prepared, execution });

  assert.equal(result.data.mode, "mix");
  assert.equal(result.data.duckApplied, false);
  const ffmpegCall = calls.find(([command, args]) => command === "ffmpeg" && args[0] !== "-version");
  const filterComplex = ffmpegCall[1][ffmpegCall[1].indexOf("-filter_complex") + 1];
  assert.ok(filterComplex.includes("amix=inputs=2"));
  assert.ok(filterComplex.includes("normalize=0"), "amix must disable normalize or the video's own audio is silently halved");
});

test("audio overlay ducks the added track using the video's own audio as the key", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-audio-overlay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { executeCommand, calls } = makeExecuteCommand({ videoDuration: 5, videoHasAudio: true });
  const tool = createFfmpegAudioOverlay({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: {
      video: { kind: "resource", id: "resource-video" },
      audio: { kind: "resource", id: "resource-audio" },
      mode: "duck"
    },
    outputWorkspace: { temporaryDirectory: directory, projectRelativeDirectory: "outputs/run-1" },
    store: fakeStore({ videoHasAudio: true })
  });
  const execution = await tool.execute({ ...prepared.runtime, availability: { executableVersion: "8.1.2" } });
  const result = tool.createResult({ prepared, execution });

  assert.equal(result.data.duckApplied, true);
  const ffmpegCall = calls.find(([command, args]) => command === "ffmpeg" && args[0] !== "-version");
  const filterComplex = ffmpegCall[1][ffmpegCall[1].indexOf("-filter_complex") + 1];
  assert.ok(filterComplex.includes("sidechaincompress"));
  assert.ok(filterComplex.includes("asplit=2"), "the speech key must be split before reuse in ffmpeg's filtergraph");
});

test("audio overlay falls back to mix when duck is requested but the video has no audio", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-audio-overlay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { executeCommand } = makeExecuteCommand({ videoDuration: 5, videoHasAudio: false });
  const tool = createFfmpegAudioOverlay({ executeCommand });
  const prepared = await tool.prepare({
    projectId: "demo",
    inputs: {
      video: { kind: "resource", id: "resource-video" },
      audio: { kind: "resource", id: "resource-audio" },
      mode: "duck"
    },
    outputWorkspace: { temporaryDirectory: directory, projectRelativeDirectory: "outputs/run-1" },
    store: fakeStore({ videoHasAudio: false })
  });
  const execution = await tool.execute({ ...prepared.runtime, availability: { executableVersion: "8.1.2" } });
  const result = tool.createResult({ prepared, execution });

  assert.equal(result.data.duckApplied, false);
});

test("audio overlay rejects non-video/non-audio sources and oversized fades", async () => {
  const tool = createFfmpegAudioOverlay();
  const base = {
    projectId: "demo",
    outputWorkspace: { temporaryDirectory: "temporary", projectRelativeDirectory: "outputs/run-1" }
  };
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: {
        video: { kind: "resource", id: "resource-audio" },
        audio: { kind: "resource", id: "resource-audio" }
      },
      store: {
        async resolveMediaSource() {
          return {
            mediaType: "audio",
            filePath: "audio.mp3",
            itemName: "audio.mp3",
            trace: { kind: "resource", id: "resource-audio" },
            inputResources: ["resource-audio"],
            inputResults: []
          };
        }
      }
    }),
    (error) => error instanceof FfmpegAudioOverlayToolError && error.code === "unsupported_input"
  );
  await assert.rejects(
    tool.prepare({
      ...base,
      inputs: {
        video: { kind: "resource", id: "resource-video" },
        audio: { kind: "resource", id: "resource-audio" },
        fadeInSeconds: 20
      },
      store: fakeStore({ videoHasAudio: true })
    }),
    (error) => error instanceof FfmpegAudioOverlayToolError && error.code === "invalid_input"
  );
});
