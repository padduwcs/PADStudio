import assert from "node:assert/strict";
import test from "node:test";
import { reviewInspectionLabel } from "../ui/review-inspection.js";

test("observer distinguishes sampled Agent evidence from confirmed human review", () => {
  const agent = reviewInspectionLabel({ inspection: {
    visual: { method: "motion_samples" }, audio: { method: "analysis_only" },
    limitations: ["Only the opening and transitions were inspected."]
  } });
  assert.match(agent, /đoạn chuyển động mẫu/);
  assert.match(agent, /chỉ phân tích tiếng\/ASR/);
  assert.match(agent, /Only the opening and transitions/);
  assert.doesNotMatch(agent, /người dùng xác nhận/);
  assert.match(reviewInspectionLabel({ attestation: { watchedFull: true, listenedFull: true } }), /người dùng xác nhận xem\/nghe đầy đủ/);
  assert.match(reviewInspectionLabel({ attestation: { watchedFull: true, listenedFull: false } }), /tiếng không áp dụng/);
});
