import assert from "node:assert/strict";
import test from "node:test";
import { parseDeliveryProbe } from "../src/production/delivery-readiness.js";
import { acceptanceResolutionIds, pendingFeedbackForResult } from "../src/production/acceptance-readiness.js";

test("delivery probe parsing exposes the video and audio streams, duration and frame rate", () => {
  const media = parseDeliveryProbe({
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.000" },
    streams: [
      { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1080, height: 1920, avg_frame_rate: "30000/1001" },
      { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 }
    ]
  });
  assert.equal(media.video.codec_name, "h264");
  assert.equal(media.audio.codec_name, "aac");
  assert.equal(media.durationSeconds, 12);
  assert.ok(Math.abs(media.fps - 29.97) < 0.001);

  const text = parseDeliveryProbe(JSON.stringify({ format: { duration: "bad" }, streams: [] }));
  assert.equal(text.video, null);
  assert.equal(text.durationSeconds, null);
  assert.equal(text.fps, null);
  assert.throws(() => parseDeliveryProbe("[]"), /invalid media description/);
  assert.throws(() => parseDeliveryProbe(null), /invalid media description/);
});

test("acceptance resolves pending feedback for the same sequence and rejects feedback from another one", () => {
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
  assert.deepEqual(pendingFeedbackForResult(context, { id: "x", data: {} }), [], "a Result outside any sequence has no pending feedback");
});
