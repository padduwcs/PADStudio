import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createExternalGeneratedMedia } from "../src/tools/external-generated-media.js";

test("external generated media preserves provenance and managed lineage", async () => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-generated-"));
  const temporaryDirectory = join(root, "tmp"); await mkdir(temporaryDirectory);
  const sourcePath = join(root, "source.png"); await writeFile(sourcePath, "fake-png");
  const calls = [];
  const tool = createExternalGeneratedMedia({ executeCommand: async (command, args) => {
    calls.push({ command, args });
    if (command === "ffprobe") return { stdout: JSON.stringify({ format: {}, streams: [{ codec_type: "video", codec_name: "png" }] }) };
    return { stdout: "ffmpeg version test" };
  } });
  const prepared = await tool.prepare({
    projectId: "demo", store: { resolveMediaSource: async () => ({ filePath: sourcePath, mediaType: "image", itemName: "source.png", inputResources: ["resource-1"], inputResults: [] }) },
    inputs: { source: { kind: "resource", id: "resource-1" }, mediaType: "image", name: "Key visual", generation: { provider: "Example", model: "image-v1", prompt: "A careful key visual", seed: 42, rightsBasis: "Owner account terms reviewed" } },
    outputWorkspace: { temporaryDirectory, projectRelativeDirectory: "outputs/run-1" }
  });
  const execution = await tool.execute({ ...prepared.runtime, availability: { executableVersion: "ffmpeg test" } });
  const result = tool.createResult({ prepared, execution });
  assert.equal(result.type, "media.generated");
  assert.deepEqual(result.inputResources, ["resource-1"]);
  assert.equal(result.data.generation.provider, "Example");
  assert.equal(result.data.generation.seed, 42);
  assert.equal(result.files[0].sha256.length, 64);
  assert.equal(calls.some((call) => call.command === "ffprobe"), true);
});

test("external generated media rejects a declared type mismatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-generated-")); const temporaryDirectory = join(root, "tmp"); await mkdir(temporaryDirectory);
  const sourcePath = join(root, "source.mp3"); await writeFile(sourcePath, "fake-audio");
  const tool = createExternalGeneratedMedia({ executeCommand: async (command) => command === "ffprobe"
    ? { stdout: JSON.stringify({ format: {}, streams: [{ codec_type: "audio" }] }) } : { stdout: "ffmpeg test" } });
  const prepared = await tool.prepare({ projectId: "demo", store: { resolveMediaSource: async () => ({ filePath: sourcePath, mediaType: "audio", itemName: "source.mp3", inputResources: ["r"], inputResults: [] }) },
    inputs: { source: { kind: "resource", id: "r" }, mediaType: "audio", name: "Music", generation: { provider: "P", model: "M", prompt: "music", rightsBasis: "terms" } },
    outputWorkspace: { temporaryDirectory, projectRelativeDirectory: "outputs/run-1" } });
  prepared.runtime.mediaType = "video";
  await assert.rejects(() => tool.execute({ ...prepared.runtime, availability: {} }), /declared type/);
});
