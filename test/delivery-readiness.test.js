import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryProfileMismatches,
  matchingDeliveryProfiles,
  parseDeliveryProbe
} from "../src/production/delivery-readiness.js";
import {
  acceptanceResolutionIds,
  deliveryProfilesForAcceptance,
  pendingFeedbackForResult
} from "../src/production/acceptance-readiness.js";

const profile = {
  id: "portrait", container: "mp4", videoCodec: "h264", pixelFormat: "yuv420p",
  width: 1080, height: 1920, fps: 30, audioCodec: "aac", sampleRate: 48000, channels: 2
};

function media(pixelFormat = "yuv420p") {
  return parseDeliveryProbe({
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.000" },
    streams: [
      { codec_type: "video", codec_name: "h264", pix_fmt: pixelFormat, width: 1080, height: 1920, avg_frame_rate: "30/1" },
      { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 }
    ]
  });
}

test("delivery readiness finds exact profiles and rejects full-range pixel formats", () => {
  assert.deepEqual(deliveryProfileMismatches(media(), profile, { expectedDurationSeconds: 12 }), []);
  assert.deepEqual(matchingDeliveryProfiles(media(), [profile]), [profile]);
  assert.deepEqual(deliveryProfileMismatches(media("yuvj420p"), profile), ["pixel_format"]);
});

test("acceptance readiness selects a deliverable profile and resolves pending feedback for the same sequence", () => {
  const result = { id: "result-new", data: { durationSeconds: 12, sequence: { key: "film" } } };
  const pending = { id: "decision-pending", resultId: "result-old", outcome: "changes_requested" };
  const unrelated = { id: "decision-other", resultId: "result-other", outcome: "changes_requested" };
  const context = {
    results: [result, { id: "result-old", data: { sequence: { key: "film" } } }, { id: "result-other", data: { sequence: { key: "other" } } }],
    decisions: [pending, unrelated]
  };
  assert.deepEqual(pendingFeedbackForResult(context, result), [pending]);
  assert.deepEqual(acceptanceResolutionIds(context, result), [pending.id]);
  assert.deepEqual(acceptanceResolutionIds(context, result, [pending.id]), [pending.id]);
  assert.throws(() => acceptanceResolutionIds(context, result, [unrelated.id]), /same sequence/);
  const catalog = {
    listOutputProfiles: () => [{ id: profile.id }],
    readOutputProfile: () => structuredClone(profile)
  };
  assert.deepEqual(deliveryProfilesForAcceptance(media(), result, catalog).map((item) => item.id), [profile.id]);
});
