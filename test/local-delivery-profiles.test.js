import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_DELIVERY_PROFILES,
  createLocalDeliveryExporter
} from "../src/tools/local-delivery-exporter.js";

test("local delivery keeps the legacy profile export while discovering all catalog profiles", async () => {
  const expected = [
    "local-portrait-h264-v1",
    "local-portrait-720p24-h264-v1",
    "local-landscape-h264-v1",
    "local-square-h264-v1"
  ];
  assert.deepEqual(Object.keys(LOCAL_DELIVERY_PROFILES), expected);
  assert.equal(LOCAL_DELIVERY_PROFILES["local-portrait-h264-v1"].width, 1080);
  assert.equal(LOCAL_DELIVERY_PROFILES["local-portrait-720p24-h264-v1"].width, 720);
  assert.equal(LOCAL_DELIVERY_PROFILES["local-portrait-720p24-h264-v1"].height, 1280);
  assert.equal(LOCAL_DELIVERY_PROFILES["local-portrait-720p24-h264-v1"].fps, 24);
  assert.equal(Object.isFrozen(LOCAL_DELIVERY_PROFILES["local-portrait-h264-v1"].integratedLufs), true);

  const tool = createLocalDeliveryExporter({
    executeCommand: async () => ({ stdout: "fixture version\n", stderr: "" })
  });
  assert.deepEqual(tool.inputSchema.properties.profileId.enum, expected);
  assert.deepEqual((await tool.checkAvailability()).profiles, expected);
});

test("local delivery can consume an injected validated catalog without introducing a default", () => {
  const customProfile = {
    id: "custom-profile-v1", width: 640, height: 360, fps: 25,
    container: "mp4", videoCodec: "h264", pixelFormat: "yuv420p",
    audioCodec: "aac", sampleRate: 48000, channels: 2,
    integratedLufs: { minimum: -24, maximum: -14 },
    maximumTruePeakDbtp: -1, maximumTailSilenceSeconds: 0.75
  };
  const policyCatalog = {
    listOutputProfiles: () => [{ id: customProfile.id }],
    readOutputProfile: (id) => {
      if (id !== customProfile.id) throw new Error("unknown");
      return structuredClone(customProfile);
    }
  };
  const tool = createLocalDeliveryExporter({ policyCatalog });
  assert.deepEqual(tool.inputSchema.properties.profileId.enum, [customProfile.id]);
  assert.equal(tool.inputSchema.required.includes("profileId"), true);
});
